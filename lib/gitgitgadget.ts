import { isDirectory } from "./fs-util";
import { git, gitConfig } from "./git";
import { GitNotes } from "./git-notes";
import { IGitHubUser, IPullRequestInfo } from "./github-glue";
import { PatchSeries, SendFunction } from "./patch-series";
import { IPatchSeriesMetadata } from "./patch-series-metadata";
import { PatchSeriesOptions } from "./patch-series-options";
import {
    ISMTPOptions, parseHeadersAndSendMail, parseMBox,
    sendMail } from "./send-mail";

export interface IGitGitGadgetOptions {
    allowedUsers: string[];

    // maps to upstreamBranch (or empty)
    openPRs?: { [pullRequestURL: string]: string };

    // maps to the original commit
    activeMessageIDs?: { [messageID: string]: string };
}

/**
 * The central class of the GitHub App.
 */
export class GitGitGadget {
    public static async getWorkDir(gitGitGadgetDir: string): Promise<string> {
        const workDir =
            await gitConfig("gitgitgadget.workDir", gitGitGadgetDir);
        if (!workDir) {
            throw new Error(`Could not find GitGitGadget's work tree`);
        }
        return workDir;
    }

    public static async get(gitGitGadgetDir: string, workDir?: string):
        Promise<GitGitGadget> {
        if (!workDir) {
            workDir = await this.getWorkDir(gitGitGadgetDir);
        }

        const publishTagsAndNotesToRemote =
            await gitConfig("gitgitgadget.publishRemote", gitGitGadgetDir);
        if (!publishTagsAndNotesToRemote) {
            throw new Error(`No remote to which to push configured`);
        }

        // Initialize the worktree if necessary
        if (!await isDirectory(workDir)) {
            await git(["init", "--bare", workDir]);
        }

        // Always fetch the Git notes first thing
        await git(["fetch", publishTagsAndNotesToRemote, "--",
                   `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`],
                  { workDir });

        const notes = new GitNotes(workDir);

        const smtpUser = await gitConfig("gitgitgadget.smtpUser",
                                         gitGitGadgetDir);
        const smtpHost = await gitConfig("gitgitgadget.smtpHost",
                                         gitGitGadgetDir);
        const smtpPass = await gitConfig("gitgitgadget.smtpPass",
                                         gitGitGadgetDir);
        const smtpOpts = await gitConfig("gitgitgadget.smtpOpts",
                                         gitGitGadgetDir);
        if (!smtpUser || !smtpHost || !smtpPass) {
            throw new Error(`No SMTP settings configured`);
        }

        const [options, allowedUsers] = await GitGitGadget.readOptions(notes);

        return new GitGitGadget(notes, options, allowedUsers,
                                { smtpHost, smtpOpts, smtpPass, smtpUser },
                                publishTagsAndNotesToRemote);
    }

    public static parsePullRequestURL(pullRequestURL: string):
        [string, string, number] {
        const match = pullRequestURL
            .match(/^https:\/\/github.com\/(.*)\/(.*)\/pull\/(\d+)$/);
        if (!match) {
            throw new Error(`Unrecognized PR URL: "${pullRequestURL}`);
        }
        const [, owner, repo, prNo] = match;
        return [owner, repo, parseInt(prNo, 10)];
    }

    protected static async readOptions(notes: GitNotes):
        Promise<[IGitGitGadgetOptions, Set<string>]> {
        let options = await notes.get<IGitGitGadgetOptions>("");
        if (options === undefined) {
            options = {
                allowedUsers: [],
            };
        }
        const allowedUsers = new Set<string>(options.allowedUsers);

        return [options, allowedUsers];
    }

    public readonly workDir: string;
    public readonly notes: GitNotes;
    protected options: IGitGitGadgetOptions;
    protected allowedUsers: Set<string>;

    protected readonly smtpOptions: ISMTPOptions;

    protected readonly publishTagsAndNotesToRemote: string;

    protected constructor(notes: GitNotes,
                          options: IGitGitGadgetOptions,
                          allowedUsers: Set<string>,
                          smtpOptions: ISMTPOptions,
                          publishTagsAndNotesToRemote: string) {
        if (!notes.workDir) {
            throw new Error(`Could not determine Git worktree`);
        }
        this.workDir = notes.workDir;
        this.notes = notes;
        this.options = options;
        this.allowedUsers = allowedUsers;

        this.smtpOptions = smtpOptions;

        this.publishTagsAndNotesToRemote = publishTagsAndNotesToRemote;
    }

    public isUserAllowed(user: string): boolean {
        return this.allowedUsers.has(user);
    }

    public async allowUser(vouchingUser: string, user: string):
        Promise<boolean> {
        await this.fetchAndReReadOptions();
        if (!this.isUserAllowed(vouchingUser)) {
            throw new Error(`User ${vouchingUser} lacks permission for this.`);
        }

        if (this.isUserAllowed(user)) {
            return false;
        }
        this.allowedUsers.add(user);
        this.options.allowedUsers.push(user);
        await this.notes.set("", this.options, true);
        await this.pushNotesRef();
        return true;
    }

    public async denyUser(vouchingUser: string, user: string):
        Promise<boolean> {
        await this.fetchAndReReadOptions();
        if (!this.isUserAllowed(vouchingUser)) {
            throw new Error(`User ${vouchingUser} lacks permission for this.`);
        }

        if (!this.isUserAllowed(user)) {
            return false;
        }
        for (let i = 0; i < this.options.allowedUsers.length; i++) {
            if (this.options.allowedUsers[i] === user) {
                this.options.allowedUsers.splice(i, 1);
                break;
            }
        }
        this.allowedUsers.delete(user);
        await this.notes.set("", this.options, true);
        await this.pushNotesRef();
        return true;
    }

    // Send emails only to the user
    public async preview(pr: IPullRequestInfo, userInfo: IGitHubUser):
        Promise<string | undefined> {

        const send = async (mail: string): Promise<string> => {
            const mbox = await parseMBox(mail);
            mbox.cc = [];
            mbox.to = userInfo.email;
            console.log(mbox);
            return await sendMail(mbox, this.smtpOptions);
        };

        return await this.genAndSend( pr, userInfo, {noUpdate: true}, send);
    }

    // Send emails out for review
    public async submit(pr: IPullRequestInfo, userInfo: IGitHubUser):
        Promise<string | undefined> {

        const send = async (mail: string): Promise<string> => {
            return await parseHeadersAndSendMail(mail, this.smtpOptions);
        };

        return await this.genAndSend(pr, userInfo, {}, send);
    }

    protected async updateNotesAndPullRef(repositoryOwner: string,
                                          pullRequestNumber: number,
                                          additionalRef?: string):
        Promise<string> {
        const pullRequestRef = `refs/pull/${pullRequestNumber}/head`;
        const pullRequestMerge = `refs/pull/${pullRequestNumber}/merge`;
        const args = [
            "fetch",
            this.publishTagsAndNotesToRemote,
            "--",
            `+${this.notes.notesRef}:${this.notes.notesRef}`,
            `+refs/heads/maint:refs/remotes/upstream/maint`,
            `+refs/heads/master:refs/remotes/upstream/master`,
            `+refs/heads/next:refs/remotes/upstream/next`,
            `+refs/heads/pu:refs/remotes/upstream/pu`,
        ];
        const prArgs = [
            `+${pullRequestRef}:${pullRequestRef}`,
            `+${pullRequestMerge}:${pullRequestMerge}`,
        ];
        if (additionalRef) {
            args.push(`+${additionalRef}:${additionalRef}`);
        }
        if (repositoryOwner === "gitgitgadget") {
            args.push(...prArgs);
        } else {
            prArgs.unshift("fetch", `https://github.com/${repositoryOwner}/git`,
                           "--");
            await git(prArgs, { workDir: this.workDir });
        }
        await git(args, { workDir: this.workDir });

        // re-read options
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);

        return pullRequestRef;
    }

    protected async fetchAndReReadOptions(): Promise<void> {
        await git(["fetch", this.publishTagsAndNotesToRemote, "--",
                   `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`],
                  { workDir: this.workDir });
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);
    }

    protected async pushNotesRef(): Promise<void> {
        await git(["push", this.publishTagsAndNotesToRemote, "--",
                   `${this.notes.notesRef}`],
                  { workDir: this.workDir });

        // re-read options
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);
    }

    // Finish the job for preview and submit
    protected async genAndSend(pr: IPullRequestInfo, userInfo: IGitHubUser,
                               options: PatchSeriesOptions,
                               send: SendFunction):
        Promise<string | undefined> {

        if (!new Set(["gitgitgadget", "dscho", "git"]).has(pr.baseOwner) ||
            pr.baseRepo !== "git") {
            throw new Error(`Unsupported repository: ${pr.pullRequestURL}`);
        }

        // get metadata in work repo
        const metadata =
            await this.notes.get<IPatchSeriesMetadata>(pr.pullRequestURL);
        const previousTag = metadata && metadata.latestTag ?
            `refs/tags/${metadata.latestTag}` : undefined;
        // update work repo from base
        await this.updateNotesAndPullRef(pr.baseOwner, pr.number, previousTag);

        // Remove template from description (if template exists)
        let prBody: string;
        try {
            let prTemplate =
                await git(["show",
                           "upstream/master:.github/PULL_REQUEST_TEMPLATE.md"],
                          { workDir: this.workDir });
            // github uses \r\n so make sure it is set
            prTemplate = prTemplate.replace(/\r?\n/g, "\r\n");
            prBody = pr.body.replace(prTemplate, "");
        } catch {
            prBody = pr.body;
        }

        if (!prBody.length) {       // reject empty description
            throw new Error("A pull request description must be provided");
        }

        const description = `${pr.title}\n\n${prBody}`;

        const series =
            await PatchSeries.getFromNotes(this.notes, pr.pullRequestURL,
                                           description, pr.baseLabel,
                                           pr.baseCommit, pr.headLabel,
                                           pr.headCommit, options,
                                           userInfo.name, userInfo.email);

        const coverMid =
            await series.generateAndSend(console, send,
                                         this.publishTagsAndNotesToRemote,
                                         pr.pullRequestURL, new Date());
        return coverMid;
    }
}
