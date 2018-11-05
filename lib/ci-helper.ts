import { commitExists, git } from "./git";
import { GitNotes } from "./git-notes";
import { GitGitGadget, IGitGitGadgetOptions } from "./gitgitgadget";
import { GitHubGlue } from "./github-glue";
import { MailCommitMapping } from "./mail-commit-mapping";
import { IMailMetadata } from "./mail-metadata";
import { IPatchSeriesMetadata } from "./patch-series-metadata";

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
    protected testing: boolean;
    private gggNotesUpdated: boolean;
    private mail2CommitMapUpdated: boolean;

    public constructor(workDir?: string) {
        this.workDir = workDir;
        this.notes = new GitNotes(workDir);
        this.gggNotesUpdated = false;
        this.mail2commit = new MailCommitMapping(this.notes.workDir);
        this.mail2CommitMapUpdated = false;
        this.github = new GitHubGlue(workDir);
        this.testing = false;
    }

    /*
     * Given an commit that was contributed as a patch via GitGitGadget (i.e.
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
     * Given a Message-Id, identify the upstream commit (if any), and if there
     * is one, and if it was not yet recorded in GitGitGadget's metadata, record
     * it and create a GitHub Commit Status.
     *
     * @returns `true` iff the metadata had to be updated
     */
    public async updateCommitMapping(messageID: string):
        Promise<boolean> {
        await this.maybeUpdateGGGNotes();
        const mailMeta: IMailMetadata | undefined =
            await this.notes.get<IMailMetadata>(messageID);
        if (!mailMeta) {
            throw new Error(`No metadata found for ${messageID}`);
        }

        await this.maybeUpdateMail2CommitMap();
        const upstreamCommit =
            await this.mail2commit.getGitGitCommitForMessageId(messageID);
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

        if (!this.testing && mailMeta.pullRequestURL) {
            await this.github.annotateCommit(mailMeta.originalCommit,
                upstreamCommit);
        }

        return true;
    }

    public async updateCommitMappings(): Promise<boolean> {
        const options = await this.getGitGitGadgetOptions();
        if (!options) {
            throw new Error(`There were no GitGitGadget options to be found?`);
        }
        if (!options.activeMessageIDs) {
            throw new Error(`No active Message-IDs?`);
        }

        let result: boolean = false;
        for (const messageID in options.activeMessageIDs) {
            if (options.activeMessageIDs.hasOwnProperty(messageID)) {
                if (await this.updateCommitMapping(messageID)) {
                    console.log(`Updated mapping for ${messageID}`);
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

        const tipCommitInGitGit =
            await this.identifyUpstreamCommit(prMeta.headCommit);
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
            await git([
                "for-each-ref",
                `--points-at=${tipCommitInGitGit}`,
                "--format=%(refname)",
                "refs/remotes/gitster/",
            ], { workDir: this.workDir });
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
        const revs = await git([
            "rev-list",
            "--ancestry-path",
            "--parents",
            `${integratedCommit}..upstream/${upstreamBranch}`,
        ], { workDir: this.workDir });
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
        const revs = await git([
            "rev-list",
            `${prMeta.baseCommit}..${prMeta.headCommit}`,
        ], {
                workDir: this.workDir,
            });
        return revs.split(/\s+/);
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
