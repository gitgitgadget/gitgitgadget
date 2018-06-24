import { isDirectory } from "./fs-util";
import { git, gitConfig } from "./git";
import { GitNotes } from "./git-notes";
import { PatchSeries } from "./patch-series";
import { IPatchSeriesMetadata } from "./patch-series-metadata";
import { ISMTPOptions, parseHeadersAndSendMail } from "./send-mail";

export interface IGitGitGadgetOptions {
    allowedUsers: string[];

    // maps to upstreamBranch (or empty)
    openPRs?: { [pullRequestURL: string]: string };

    // maps to the original commit
    activeMessageIDs?: { [messageID: string]: string };
}

/**
 * The central class of the Probot-based Web App.
 */
export class GitGitGadget {
    public static async get(gitGitGadgetDir: string, workDir?: string):
        Promise<GitGitGadget> {
        if (!workDir) {
            workDir = await gitConfig("gitgitgadget.workDir", gitGitGadgetDir);
            if (!workDir) {
                throw new Error(`Could not find GitGitGadget's work tree`);
            }
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
        await git([
            "fetch",
            publishTagsAndNotesToRemote,
            "--",
            `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`,
        ], { workDir });

        const notes = new GitNotes(workDir);

        const smtpUser = await gitConfig("gitgitgadget.smtpUser",
            gitGitGadgetDir);
        const smtpHost = await gitConfig("gitgitgadget.smtpHost",
            gitGitGadgetDir);
        const smtpPass = await gitConfig("gitgitgadget.smtpPass",
            gitGitGadgetDir);
        if (!smtpUser || !smtpHost || !smtpPass) {
            throw new Error(`No SMTP settings configured`);
        }

        const [options, allowedUsers] = await GitGitGadget.readOptions(notes);

        return new GitGitGadget(notes,
            options, allowedUsers,
            smtpUser, smtpHost, smtpPass,
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

    protected readonly workDir: string;
    protected readonly notes: GitNotes;
    protected options: IGitGitGadgetOptions;
    protected allowedUsers: Set<string>;

    protected readonly smtpOptions: ISMTPOptions;

    protected readonly publishTagsAndNotesToRemote: string;

    protected constructor(notes: GitNotes,
                          options: IGitGitGadgetOptions,
                          allowedUsers: Set<string>,
                          smtpUser: string, smtpHost: string, smtpPass: string,
                          publishTagsAndNotesToRemote: string) {
        if (!notes.workDir) {
            throw new Error(`Could not determine Git worktree`);
        }
        this.workDir = notes.workDir;
        this.notes = notes;
        this.options = options;
        this.allowedUsers = allowedUsers;

        this.smtpOptions = { smtpHost, smtpPass, smtpUser };

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

    public async submit(gitHubUser: string, gitHubUserName: string,
                        pullRequestURL: string, description: string,
                        baseLabel: string, baseCommit: string,
                        headLabel: string, headCommit: string):
        Promise<string | undefined> {
        if (!this.isUserAllowed(gitHubUser)) {
            throw new Error(`Permission denied for user ${gitHubUser}`);
        }

        const [owner, repo, pullRequestNumber] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);
        if (owner !== "gitgitgadget" || repo !== "git") {
            throw new Error(`Unsupported repository: ${pullRequestURL}`);
        }

        const metadata =
            await this.notes.get<IPatchSeriesMetadata>(pullRequestURL);
        const previousTag = metadata && metadata.latestTag ?
            `refs/tags/${metadata.latestTag}` : undefined;
        await this.updateNotesAndPullRef(pullRequestNumber, previousTag);

        const series = await PatchSeries.getFromNotes(this.notes,
            pullRequestURL, description, baseLabel, baseCommit, headLabel,
            headCommit, gitHubUserName);

        const coverMid = await series.generateAndSend(console,
            async (mail: string): Promise<string> => {
                return await parseHeadersAndSendMail(mail, this.smtpOptions);
            },
            this.publishTagsAndNotesToRemote, pullRequestURL,
            new Date(),
        );
        return coverMid;
    }

    protected async updateNotesAndPullRef(pullRequestNumber: number,
                                          additionalRef?: string):
        Promise<string> {
        if (!await isDirectory(this.workDir)) {
            await git(["init", "--bare", this.workDir]);
        }

        const pullRequestRef = `refs/pull/${pullRequestNumber}/head`;
        const args = [
            "fetch",
            this.publishTagsAndNotesToRemote,
            "--",
            `+${this.notes.notesRef}:${this.notes.notesRef}`,
            `+${pullRequestRef}:${pullRequestRef}`,
            `+refs/heads/maint:refs/remotes/upstream/maint`,
            `+refs/heads/master:refs/remotes/upstream/master`,
            `+refs/heads/next:refs/remotes/upstream/next`,
            `+refs/heads/pu:refs/remotes/upstream/pu`,
        ];
        if (additionalRef) {
            args.push(`+${additionalRef}:${additionalRef}`);
        }
        await git(args, { workDir: this.workDir });

        // re-read options
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);

        return pullRequestRef;
    }

    protected async fetchAndReReadOptions(): Promise<void> {
        await git([
            "fetch",
            this.publishTagsAndNotesToRemote,
            "--",
            `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`,
        ], { workDir: this.workDir });
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);
    }

    protected async pushNotesRef(): Promise<void> {
        await git([
            "push",
            this.publishTagsAndNotesToRemote,
            "--",
            `${this.notes.notesRef}`,
        ], { workDir: this.workDir });

        // re-read options
        [this.options, this.allowedUsers] =
            await GitGitGadget.readOptions(this.notes);
    }
}
