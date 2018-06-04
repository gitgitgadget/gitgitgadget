import { gitConfig } from "./git";
import { GitNotes } from "./git-notes";
import { PatchSeries } from "./patch-series";
import { ISMTPOptions, parseHeadersAndSendMail } from "./send-mail";

export interface IGitGitGadgetOptions {
    allowedUsers: string[];
}

/**
 * The central class of the Probot-based Web App.
 */
export class GitGitGadget {
    public static async get(workDir?: string): Promise<GitGitGadget> {
        if (!workDir) {
            workDir = await gitConfig("gitgitgadget.workDir");
            if (!workDir) {
                throw new Error(`Could not find GitGitGadget's work tree`);
            }
        }
        const notes = new GitNotes(workDir);
        let options = await notes.get<IGitGitGadgetOptions>("");
        if (options === undefined) {
            options = {
                allowedUsers: [],
            };
        }

        const smtpUser = await gitConfig("gitgitgadget.smtpUser");
        const smtpHost = await gitConfig("gitgitgadget.smtpHost");
        const smtpPass = await gitConfig("gitgitgadget.smtpPass");
        if (!smtpUser || !smtpHost || !smtpPass) {
            throw new Error(`No SMTP settings configured`);
        }

        const publishTagsAndNotesToRemote =
            await gitConfig("gitgitgadget.publishRemote");
        if (!publishTagsAndNotesToRemote) {
            throw new Error(`No remote to which to push configured`);
        }

        return new GitGitGadget(notes, options,
            smtpUser, smtpHost, smtpPass,
            publishTagsAndNotesToRemote);
    }

    protected readonly notes: GitNotes;
    protected readonly options: IGitGitGadgetOptions;
    protected readonly allowedUsers: Set<string>;

    protected readonly smtpOptions: ISMTPOptions;

    protected readonly publishTagsAndNotesToRemote: string;

    protected constructor(notes: GitNotes, options: IGitGitGadgetOptions,
                          smtpUser: string, smtpHost: string, smtpPass: string,
                          publishTagsAndNotesToRemote: string) {
        this.notes = notes;
        this.options = options;
        this.allowedUsers = new Set<string>(options.allowedUsers);

        this.smtpOptions = { smtpHost, smtpPass, smtpUser };

        this.publishTagsAndNotesToRemote = publishTagsAndNotesToRemote;
    }

    public isUserAllowed(user: string): boolean {
        return this.allowedUsers.has(user);
    }

    public async allowUser(user: string): Promise<void> {
        if (!this.isUserAllowed(user)) {
            this.allowedUsers.add(user);
            this.options.allowedUsers.push(user);
            await this.notes.set("", this.options);
        }
    }

    public async denyUser(user: string): Promise<void> {
        if (this.isUserAllowed(user)) {
            for (let i = 0; i < this.options.allowedUsers.length; i++) {
                if (this.options.allowedUsers[i] === user) {
                    this.options.allowedUsers.splice(i, 1);
                    break;
                }
            }
            this.allowedUsers.delete(user);
        }
    }

    public async submit(gitHubUser: string,
                        pullRequestURL: string, description: string,
                        baseLabel: string, baseCommit: string,
                        headLabel: string, headCommit: string):
        Promise<string | undefined> {
        if (!this.isUserAllowed(gitHubUser)) {
            throw new Error(`Permission denied for user ${gitHubUser}`);
        }
        if (!pullRequestURL
            .startsWith("https://github.com/gitgitgadget/git/pull/")) {
            throw new Error(`Unsupported repository: ${pullRequestURL}`);
        }
        const series = await PatchSeries.getFromNotes(this.notes,
            pullRequestURL, description, baseLabel, baseCommit, headLabel,
            headCommit);

        const coverMid = await series.generateAndSend(console,
            async (mail: string): Promise<string> => {
                return await parseHeadersAndSendMail(mail, this.smtpOptions);
            },
            this.publishTagsAndNotesToRemote,
        );
        return coverMid;
    }
}
