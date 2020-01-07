import * as fs from "fs";
import * as util from "util";
import { commitExists, git } from "./git";
import { GitNotes } from "./git-notes";
import { GitGitGadget, IGitGitGadgetOptions } from "./gitgitgadget";
import { GitHubGlue, IGitHubUser, IPullRequestInfo } from "./github-glue";
import { MailArchiveGitHelper } from "./mail-archive-helper";
import { MailCommitMapping } from "./mail-commit-mapping";
import { IMailMetadata } from "./mail-metadata";
import { IPatchSeriesMetadata } from "./patch-series-metadata";

const readFile = util.promisify(fs.readFile);
type CommentFunction = (comment: string) => Promise<void>;

/*
 * This class offers functions to support the operations we want to perform from
 * automated builds, e.g. identify corresponding commits in git.git,
 * corresponding branches in https://github.com/gitster/git, identify which
 * git.git branches integrated said branch already (if any), and via which merge
 * commit.
 */
export class CIHelper {
    public readonly workDir?: string;
    public readonly notes: GitNotes;
    protected readonly mail2commit: MailCommitMapping;
    protected readonly github: GitHubGlue;
    protected readonly gggConfigDir: string;
    protected commit2mailNotes: GitNotes | undefined;
    protected testing: boolean;
    private gggNotesUpdated: boolean;
    private mail2CommitMapUpdated: boolean;

    public constructor(workDir?: string, skipUpdate?: boolean,
                       gggConfigDir = ".") {
        this.gggConfigDir = gggConfigDir;
        this.workDir = workDir;
        this.notes = new GitNotes(workDir);
        this.gggNotesUpdated = !!skipUpdate;
        this.mail2commit = new MailCommitMapping(this.notes.workDir);
        this.mail2CommitMapUpdated = !!skipUpdate;
        this.github = new GitHubGlue(workDir);
        this.testing = false;
    }

    /*
     * Given a commit that was contributed as a patch via GitGitGadget (i.e.
     * a commit with a Message-ID recorded in `refs/notes/gitgitgadget`),
     * identify the commit (if any) in `git.git`.
     */
    public async identifyUpstreamCommit(originalCommit: string):
        Promise<string | undefined> {
        await this.maybeUpdateMail2CommitMap();
        const messageId = await
            this.getMessageIdForOriginalCommit(originalCommit);
        if (!messageId) {
            return undefined;
        }
        return await this.mail2commit.getGitGitCommitForMessageId(messageId);
    }

    /**
     * Given an original commit that was contributed as a patch via
     * GitGitGadget (i.e. a commit with a Message-ID recorded in
     * `refs/notes/gitgitgadget`), and the (known and verified) commit in
     * `git.git`, update the `refs/notes/mail-to-commit` ref accordingly.
     * This is sometimes needed when the automated job fails to identify
     * the correct commit.
     *
     * @param originalCommit the original, contributed commit
     * @param gitGitCommit the corresponding commit in git.git
     */
    public async setUpstreamCommit(originalCommit: string,
                                   gitGitCommit: string): Promise<void> {
        await this.maybeUpdateMail2CommitMap();
        if (!this.commit2mailNotes) {
            this.commit2mailNotes = new GitNotes(this.mail2commit.workDir,
                                                 "refs/notes/commit-to-mail");
            await this.commit2mailNotes.update();
        }
        const messageId = await
            this.getMessageIdForOriginalCommit(originalCommit);
        if (!messageId) {
            return undefined;
        }
        await this.mail2commit.mail2CommitNotes.setString(messageId,
                                                          gitGitCommit, true);
        await this.commit2mailNotes.appendCommitNote(gitGitCommit, messageId);
    }

    /**
     * Given a Message-Id, identify the upstream commit (if any), and if there
     * is one, and if it was not yet recorded in GitGitGadget's metadata, record
     * it and create a GitHub Commit Status.
     *
     * @returns `true` iff the metadata had to be updated
     */
    public async updateCommitMapping(messageID: string,
                                     upstreamCommit?: string):
        Promise<boolean> {
        await this.maybeUpdateGGGNotes();
        const mailMeta: IMailMetadata | undefined =
            await this.notes.get<IMailMetadata>(messageID);
        if (!mailMeta) {
            throw new Error(`No metadata found for ${messageID}`);
        }
        if (upstreamCommit === undefined) {
            await this.maybeUpdateMail2CommitMap();
            upstreamCommit =
                await this.mail2commit.getGitGitCommitForMessageId(messageID);
        }
        if (!upstreamCommit || upstreamCommit === mailMeta.commitInGitGit) {
                return false;
        }
        mailMeta.commitInGitGit = upstreamCommit;
        if (!mailMeta.originalCommit) {
            mailMeta.originalCommit =
                await this.getOriginalCommitForMessageId(messageID);
            if (!mailMeta.originalCommit) {
                throw new Error(`No original commit found for ${messageID}`);
            }
        }
        await this.notes.set(messageID, mailMeta, true);

        if (!this.testing && mailMeta.pullRequestURL &&
            mailMeta.pullRequestURL
            .startsWith("https://github.com/gitgitgadget/") ) {
            await this.github.annotateCommit(mailMeta.originalCommit,
                                             upstreamCommit, "gitgitgadget");
        }

        return true;
    }

    public async updateCommitMappings(): Promise<boolean> {
        if (!this.gggNotesUpdated) {
            await git(["fetch", "https://github.com/gitgitgadget/git",
                       `+refs/notes/gitgitgadget:refs/notes/gitgitgadget`,
                       `+refs/heads/maint:refs/remotes/upstream/maint`,
                       `+refs/heads/pu:refs/remotes/upstream/pu`],
                      { workDir: this.workDir });
            this.gggNotesUpdated = true;
        }

        const options = await this.getGitGitGadgetOptions();
        if (!options) {
            throw new Error(`There were no GitGitGadget options to be found?`);
        }
        if (!options.openPRs) {
            return false;
        }

        const commitsInPu: Set<string> = new Set<string>(
            (await git(["rev-list", "--no-merges",
                        "^refs/remotes/upstream/maint~100",
                        "refs/remotes/upstream/pu"],
                       { workDir: this.workDir })).split("\n"),
        );
        let result: boolean = false;
        for (const pullRequestURL of Object.keys(options.openPRs)) {
            const info = await this.getPRMetadata(pullRequestURL);
            if (info === undefined || info.latestTag === undefined ||
                info.baseCommit === undefined ||
                info.headCommit === undefined || info.baseLabel === undefined ||
                info.baseLabel.match(/^gitgitgadget:git-gui\//)) {
                continue;
            }
            const messageID =
                await this.getMessageIdForOriginalCommit(info.headCommit);
            if (!messageID) {
                continue;
            }
            const meta = await this.getMailMetadata(messageID);
            if (!meta || meta.commitInGitGit !== undefined) {
                if (!meta || commitsInPu.has(meta.commitInGitGit!)) {
                    continue;
                }
                console.log(`Upstream commit ${meta.commitInGitGit} for ${
                    info.headCommit} of ${
                    info.pullRequestURL} no longer found in pu`);
                meta.commitInGitGit = undefined;
                result = true;
            }

            const out = await git(["-c", "core.abbrev=40", "range-diff", "-s",
                                   info.baseCommit, info.headCommit,
                                   "refs/remotes/upstream/pu"],
                                  { workDir: this.workDir });
            for (const line of out.split("\n")) {
                const match =
                    line.match(/^[^:]*: *([^ ]*) [!=][^:]*: *([^ ]*)/);
                if (!match) {
                    continue;
                }
                const messageID2 = match[1] === info.headCommit ? messageID :
                    await this.getMessageIdForOriginalCommit(match[1]);
                if (messageID2 === undefined) {
                    continue;
                }
                if (await this.updateCommitMapping(messageID2, match[2])) {
                    result = true;
                }
            }
        }
        return result;
    }

    /**
     * Process all open PRs.
     *
     * @returns true if `refs/notes/gitgitgadget` was updated (and needs to
     * be pushed)
     */
    public async handleOpenPRs(): Promise<boolean> {
        const options = await this.getGitGitGadgetOptions();
        if (!options) {
            throw new Error(`There were no GitGitGadget options to be found?`);
        }
        if (!options.openPRs) {
            return false;
        }
        let result: boolean = false;
        let optionsUpdated: boolean = false;
        for (const pullRequestURL in options.openPRs) {
            if (!options.openPRs.hasOwnProperty(pullRequestURL)) {
                continue;
            }
            console.log(`Handling ${pullRequestURL}`);
            const [notesUpdated, optionsUpdated2] =
                await this.handlePR(pullRequestURL, options);
            if (notesUpdated) {
                result = true;
            }
            if (optionsUpdated2) {
                optionsUpdated = true;
            }
        }

        if (optionsUpdated) {
            await this.notes.set("", options, true);
            result = true;
        }

        return result;
    }

    /**
     * Handles one PR, i.e. looks whether an upstream commit has been
     * created/updated that corresponds to the tip commit of the PR, whether it
     * got its own branch in gitster/git, whether it has been integrated into
     * any upstream branch, whether it was kicked out of a branch, etc, and
     * updates the PR on GitHub accordingly (labels, add a comment to inform the
     * user, close the PR, etc).
     *
     * @param {string} pullRequestURL the PR to handle
     * @param {IGitGitGadgetOptions} options the GitGitGadget options which may
     * need to be updated.
     *
     * @returns two booleans; the first is `true` if there were updates that
     * require `refs/notes/gitgitgadget` to be pushed. The second is `true`
     * if the `options` were updated.
     */
    public async handlePR(pullRequestURL: string,
                          options?: IGitGitGadgetOptions):
        Promise<[boolean, boolean]> {
        await this.maybeUpdateGGGNotes();
        await this.maybeUpdateMail2CommitMap();

        let updateOptionsInRef: boolean;
        if (options) {
            updateOptionsInRef = false;
        } else {
            options = await this.getGitGitGadgetOptions();
            if (!options) {
                throw new Error("GitGitGadgetOptions not set?!?!?");
            }
            updateOptionsInRef = true;
        }

        const prMeta =
            await this.notes.get<IPatchSeriesMetadata>(pullRequestURL);
        if (!prMeta || !prMeta.coverLetterMessageId) {
            return [false, false];
        }

        const headMessageID =
            await this.getMessageIdForOriginalCommit(prMeta.headCommit);
        const headMeta = headMessageID &&
            await this.getMailMetadata(headMessageID);
        const tipCommitInGitGit = headMeta && headMeta.commitInGitGit;
        if (!tipCommitInGitGit) {
            return [false, false];
        }

        let notesUpdated = false;
        if (tipCommitInGitGit !== prMeta.tipCommitInGitGit) {
            prMeta.tipCommitInGitGit = tipCommitInGitGit;
            notesUpdated = true;
        }

        // Identify branch in gitster/git
        let gitsterBranch: string | undefined =
            await git(["for-each-ref", `--points-at=${tipCommitInGitGit}`,
                       "--format=%(refname)", "refs/remotes/gitster/"],
                      { workDir: this.workDir });
        if (gitsterBranch) {
            const newline = gitsterBranch.indexOf("\n");
            if (newline > 0) {
                const comment2 = `Found multiple candidates in gitster/git:\n${
                    gitsterBranch};\n\nUsing the first one.`;
                const url2 =
                    await this.github.addPRComment(pullRequestURL, comment2);
                console.log(`Added comment about ${gitsterBranch}: ${url2}`);

                gitsterBranch = gitsterBranch.substr(0, newline);
            }
            gitsterBranch =
                gitsterBranch.replace(/^refs\/remotes\/gitster\//, "");

            const comment = `This branch is now known as [\`${gitsterBranch
                }\`](https://github.com/gitster/git/commits/${gitsterBranch}).`;
            if (prMeta.branchNameInGitsterGit !== gitsterBranch) {
                prMeta.branchNameInGitsterGit = gitsterBranch;
                notesUpdated = true;

                const url =
                    await this.github.addPRComment(pullRequestURL, comment);
                console.log(`Added comment about ${gitsterBranch}: ${url}`);
            }
        }

        let closePR: string | undefined;
        const prLabelsToAdd = [];
        for (const branch of ["pu", "next", "master", "maint"]) {
            const mergeCommit =
                await this.identifyMergeCommit(branch, tipCommitInGitGit);
            if (!mergeCommit) {
                continue;
            }

            if (branch === "master" || branch === "maint") {
                closePR = mergeCommit;
            }

            if (!prMeta.mergedIntoUpstream) {
                prMeta.mergedIntoUpstream = {};
            }
            if (prMeta.mergedIntoUpstream[branch] !== mergeCommit) {
                prMeta.mergedIntoUpstream[branch] = mergeCommit;
                notesUpdated = true;

                // Add label on GitHub
                prLabelsToAdd.push(branch);

                // Add comment on GitHub
                const comment = `This patch series was integrated into ${branch
                    } via https://github.com/git/git/commit/${mergeCommit}.`;
                const url =
                    await this.github.addPRComment(pullRequestURL, comment);
                console.log(`Added comment about ${branch}: ${url}`);
            }
        }

        if (prLabelsToAdd.length) {
            await this.github.setPRLabels(pullRequestURL, prLabelsToAdd);
        }

        let optionsUpdated = false;
        if (closePR) {
            if (options.openPRs) {
                delete options.openPRs[pullRequestURL];
                optionsUpdated = true;
            }
            // Remove items from activeMessageIDs
            if (options.activeMessageIDs) {
                for (const rev of await this.getOriginalCommitsForPR(prMeta)) {
                    const messageID = await this.notes.getLastCommitNote(rev);
                    delete options.activeMessageIDs[messageID];
                }
                optionsUpdated = true;
            }

            await this.github.closePR(pullRequestURL, closePR);
        }

        if (notesUpdated) {
            await this.notes.set(pullRequestURL, prMeta, true);
        }

        if (optionsUpdated && updateOptionsInRef) {
            await this.notes.set("", options, true);
        }

        return [notesUpdated, optionsUpdated];
    }

    public async getMessageIdForOriginalCommit(commit: string):
        Promise<string | undefined> {
        await this.maybeUpdateGGGNotes();
        return await this.notes.getLastCommitNote(commit);
    }

    public async getOriginalCommitForMessageId(messageID: string):
        Promise<string | undefined> {
        await this.maybeUpdateGGGNotes();
        const note = await this.notes.get<IMailMetadata>(messageID);
        return note ? note.originalCommit : undefined;
    }

    /*
     * Given a branch and a commit, identify the merge that integrated that
     * commit into that branch.
     */
    public async identifyMergeCommit(upstreamBranch: string,
                                     integratedCommit: string):
        Promise<string | undefined> {
        const revs =
            await git(["rev-list", "--ancestry-path", "--parents",
                       `${integratedCommit}..upstream/${upstreamBranch}`],
                      { workDir: this.workDir });
        if (revs === "") {
            return undefined;
        }

        let commit = integratedCommit;

        // Was it integrated via a merge?
        let match = revs.match(`(^|\n)([^ ]+) ([^\n]+) ${commit}`);
        if (!match) {
            // Look for a descendant that *was* integrated via a merge
            for (; ;) {
                match = revs.match(`(^|\n)([^ ]+) ${commit}(\n|$)`);
                if (!match) {
                    // None found, return the original commit
                    return integratedCommit;
                }
                commit = match[2];
                match = revs.match(`(^|\n)([^ ]+) ([^\n]+) ${commit}`);
                if (match) {
                    // found a merge!
                    break;
                }
            }
        }

        for (; ;) {
            commit = match[2];
            // was this merge integrated via another merge?
            match = revs.match(`(^|\n)([^ ]+) ([^\n]+) ${commit}`);
            if (!match) {
                return commit;
            }
        }
    }

    public async getGitGitGadgetOptions(): Promise<IGitGitGadgetOptions> {
        await this.maybeUpdateGGGNotes();
        const options = await this.notes.get<IGitGitGadgetOptions>("");
        if (options === undefined) {
            throw new Error("No GitGitGadgetOptions?!?!?");
        }
        return options;
    }

    public async getPRMetadata(pullRequestURL: string):
        Promise<IPatchSeriesMetadata | undefined> {
        await this.maybeUpdateGGGNotes();
        return this.notes.get<IPatchSeriesMetadata>(pullRequestURL);
    }

    public async getMailMetadata(messageID: string):
        Promise<IMailMetadata | undefined> {
        await this.maybeUpdateGGGNotes();
        return this.notes.get<IMailMetadata>(messageID);
    }

    public async getOriginalCommitsForPR(prMeta: IPatchSeriesMetadata):
        Promise<string[]> {
        if (!this.workDir) {
            throw new Error(`Need a workDir`);
        }
        if (!await commitExists(prMeta.headCommit, this.workDir)) {
            if (!prMeta.pullRequestURL) {
                throw new Error(`Require URL in ${
                    JSON.stringify(prMeta, null, 4)}`);
            }
            if (!prMeta.latestTag) {
                throw new Error(`Cannot fetch commits without tag`);
            }
            const [owner, repo, nr] =
                GitGitGadget.parsePullRequestURL(prMeta.pullRequestURL);
            const fetchURL = `https://github.com/${owner}/${repo}`;
            const fetchRef = `refs/pull/${nr}/head`;
            await git(["fetch", fetchURL, fetchRef, prMeta.latestTag], {
                workDir: this.workDir,
            });
        }
        const revs = await git(["rev-list",
                                `${prMeta.baseCommit}..${prMeta.headCommit}`],
                               { workDir: this.workDir });
        return revs.split(/\s+/);
    }

    /**
     * Retrieves comments on PRs and handles `/submit` and friends.
     *
     * @param commentID the ID of the PR comment to handle
     */
    public async handleComment(repositoryOwner: string, commentID: number):
        Promise<void> {
        const comment =
            await this.github.getPRComment(repositoryOwner, commentID);
        const match = comment.body.match(/^\s*(\/[-a-z]+)(\s+(.*?))?\s*$/);
        if (!match) {
            console.log(`Not a command; doing nothing: '${comment.body}'`);
            return; /* nothing to do */
        }
        const command = match[1];
        const argument = match[3];

        const pullRequestURL = `https://github.com/${
            repositoryOwner}/git/pull/${comment.prNumber}`;
        console.log(`Handling command ${command} with argument ${argument} at ${
            pullRequestURL}#issuecomment-${commentID}`);

        const addComment = async (body: string) => {
            console.log(`Adding comment to ${pullRequestURL}:\n${body}`);
            await this.github.addPRComment(pullRequestURL, body);
        };

        try {
            const gitGitGadget = await GitGitGadget.get(this.gggConfigDir,
                                                        this.workDir);
            if (!gitGitGadget.isUserAllowed(comment.author)) {
                throw new Error(`User ${
                    comment.author} is not permitted to use GitGitGadget`);
            }

            const getPRAuthor = async (): Promise<string> => {
                const pr = await this.github.getPRInfo(repositoryOwner,
                                                       comment.prNumber);
                return pr.author;
            };

            if (command === "/submit") {
                if (argument && argument !== "") {
                    throw new Error(`/submit does not accept arguments ('${
                        argument}')`);
                }

                const pr = await this.getPRInfo(comment.prNumber,
                                                pullRequestURL);
                if (pr.author !== comment.author) {
                    throw new Error("Only the owner of a PR can submit it!");
                }

                const userInfo = await this.getUserInfo(comment.author);

                const commitOkay = await this.checkCommits(pr, addComment);

                if (commitOkay) {
                    const extraComment = userInfo.email === null ?
                        ( `\n\nWARNING: ${comment.author} has no public email` +
                        " address set on GitHub" ) : "";

                    const coverMid = await gitGitGadget.submit(pr, userInfo);
                    await addComment(`Submitted as [${
                        coverMid}](https://lore.kernel.org/git/${coverMid})${
                            extraComment}`);
                }

            } else if (command === "/preview") {
                if (argument && argument !== "") {
                    throw new Error(`/preview does not accept arguments ('${
                        argument}')`);
                }

                const pr = await this.getPRInfo(comment.prNumber,
                                                pullRequestURL);
                const userInfo = await this.getUserInfo(comment.author);

                if (!userInfo.email) {
                    throw new Error(`Could not determine public email of ${
                        comment.author}`);
                }

                const commitOkay = await this.checkCommits(pr, addComment);

                if (commitOkay) {
                    const coverMid = await gitGitGadget.preview(pr, userInfo);
                    await addComment(`Preview email sent as ${coverMid}`);
                }

            } else if (command === "/allow") {
                const accountName = argument || await getPRAuthor();
                let extraComment = "";
                try {
                    const userInfo = await this.github.getGitHubUserInfo(
                        accountName);
                    if (userInfo.email === null) {
                        extraComment = `\n\nWARNING: ${
                            accountName} has no public email address` +
                            " set on GitHub";
                    }
                } catch (reason) {
                    throw new Error(`User ${
                        accountName} is not a valid GitHub username.`);
                }

                if (await gitGitGadget.allowUser(comment.author, accountName)) {
                    await addComment(`User ${
                        accountName} is now allowed to use GitGitGadget.${
                        extraComment}`);
                } else {
                    await addComment(`User ${
                        accountName} already allowed to use GitGitGadget.`);
                }
            } else if (command === "/disallow") {
                const accountName = argument || await getPRAuthor();

                if (await gitGitGadget.denyUser(comment.author, accountName)) {
                    await addComment(`User ${accountName
                        } is no longer allowed to use GitGitGadget.`);
                } else {
                    await addComment(`User ${
                        accountName} already not allowed to use GitGitGadget.`);
                }
            } else if (command === "/test") {
                await addComment(`Received test '${argument}'`);
            } else {
                console.log(`Ignoring unrecognized command ${command} in ${
                    pullRequestURL}#issuecomment-${commentID}`);
            }
        } catch (e) {
            await addComment(e.toString());
        }
    }

    public async checkCommits(pr: IPullRequestInfo,
                              addComment: CommentFunction):
        Promise<boolean> {
        const maxCommits = 30;
        if (pr.commits && pr.commits > maxCommits) {
            addComment(`The pull request has ${pr.commits
                       } commits.  The max allowed is ${maxCommits
                       }.  Please split the patch series into multiple pull ${
                       ""}requests. Also consider squashing related commits.`);
            return false;
        }

        return true;
    }

    public async handlePush(repositoryOwner: string, prNumber: number) {
        const pr = await this.github.getPRInfo(repositoryOwner, prNumber);
        const pullRequestURL = `https://github.com/${repositoryOwner
                                }/git/pull/${prNumber}`;

        const addComment = async (body: string) => {
            console.log(`Adding comment to ${pullRequestURL}:\n${body}`);
            await this.github.addPRComment(pullRequestURL, body);
        };

        const gitGitGadget = await GitGitGadget.get(this.gggConfigDir,
                                                    this.workDir);
        if (!pr.hasComments && !gitGitGadget.isUserAllowed(pr.author)) {
            const welcome = (await readFile("res/WELCOME.md")).toString()
                    .replace(/\${username}/g, pr.author);
            this.github.addPRComment(pullRequestURL, welcome);
        }

        const commitOkay = await this.checkCommits(pr, addComment);

        if (!commitOkay) {          // make check fail to get user attention
            throw new Error("Failing check due to commit linting errors.");
        }
    }

    public async handleNewMails(mailArchiveGitDir: string,
                                onlyPRs?: Set<number>): Promise<boolean> {
        await git(["fetch"], { workDir: mailArchiveGitDir });
        const prFilter = !onlyPRs ? undefined :
            (pullRequestURL: string): boolean => {
                const match = pullRequestURL.match(/.*\/(\d+)$/);
                return !match ? false : onlyPRs.has(parseInt(match[1], 10));
            };
        await this.maybeUpdateGGGNotes();
        const mailArchiveGit =
            await MailArchiveGitHelper.get(this.notes, mailArchiveGitDir,
                                           this.github);
        return await mailArchiveGit.processMails(prFilter);
    }

    private async getPRInfo(prNumber: number, pullRequestURL: string):
        Promise<IPullRequestInfo> {
        const [owner] =
                GitGitGadget.parsePullRequestURL(pullRequestURL);
        const pr = await this.github.getPRInfo(owner, prNumber);

        if (!pr.baseLabel || !pr.baseCommit ||
            !pr.headLabel || !pr.headCommit) {
            throw new Error(`Could not determine PR details for ${
                pullRequestURL}`);
        }

        if (!pr.title || !pr.body) {
            throw new Error("Ignoring PR with empty title and/or body");
        }

        if (!pr.mergeable) {
            throw new Error("Refusing to submit a patch series "
                + "that does not merge cleanly.");
        }

        return pr;
    }

    private async getUserInfo(author: string): Promise<IGitHubUser> {
        const userInfo = await this.github.getGitHubUserInfo(author);
        if (!userInfo.name) {
            throw new Error(`Could not determine full name of ${author}`);
        }

        return userInfo;
    }

    private async maybeUpdateGGGNotes(): Promise<void> {
        if (!this.gggNotesUpdated) {
            await this.notes.update();
            this.gggNotesUpdated = true;
        }
    }

    private async maybeUpdateMail2CommitMap(): Promise<void> {
        if (!this.mail2CommitMapUpdated) {
            await this.mail2commit.updateMail2CommitAndBranches();
            this.mail2CommitMapUpdated = true;
        }
    }
}
