import { randomBytes } from "crypto";
import { isDirectory } from "./fs-util.js";
import { git, gitConfig } from "./git.js";
import { GitNotes } from "./git-notes.js";
import { IGitHubUser, IPullRequestInfo } from "./github-glue.js";
import { PatchSeries, SendFunction } from "./patch-series.js";
import { IPatchSeriesMetadata } from "./patch-series-metadata.js";
import { PatchSeriesOptions } from "./patch-series-options.js";
import { IConfig } from "./project-config.js";
import {
    ISMTPOptions,
    parseHeadersAndSendMail,
    parseMBox,
    sendMail,
    sendReplyMail,
    validateSMTPOptions,
} from "./send-mail.js";
import { IMailMetadata } from "./mail-metadata.js";

export interface IGitGitGadgetOptions {
    allowedUsers: string[];

    // maps to upstreamBranch (or empty)
    openPRs?: { [pullRequestURL: string]: string };

    // maps to the original commit
    activeMessageIDs?: { [messageID: string]: string };
}

export function createReplyMessageID(parentMessageID: string): string {
    const idPrefix = parentMessageID
        .slice(0, parentMessageID.lastIndexOf("@"))
        .replace(/[^a-zA-Z0-9.-]/g, "-")
        .slice(0, 80);
    const timestamp = Math.floor(Date.now() / 1000);
    const random = randomBytes(16).toString("hex");
    return `reply.${idPrefix}.${timestamp}.${random}.gitgitgadget@gmail.com`;
}

export async function getVar(key: string, configDir: string | undefined): Promise<string | undefined> {
    const keyPrefix = "gitgitgadget";
    const envVar = `${keyPrefix}_${key}`.toUpperCase();
    return process.env[envVar] ? process.env[envVar] : await gitConfig(`${keyPrefix}.${key}`, configDir);
}

/**
 * The central class of the GitHub App.
 */
export class GitGitGadget {
    public static async getWorkDir(gitGitGadgetDir: string): Promise<string> {
        const workDir = await getVar("workDir", gitGitGadgetDir);
        if (!workDir) {
            throw new Error("Could not find GitGitGadget's work tree");
        }
        return workDir;
    }

    public static async get(
        config: IConfig,
        gitGitGadgetDir: string,
        workDir?: string,
        publishTagsAndNotesToRemote?: string,
        notesPushToken?: string,
        smtpOptions?: ISMTPOptions,
    ): Promise<GitGitGadget> {
        if (!workDir) {
            workDir = await this.getWorkDir(gitGitGadgetDir);
        }

        if (!publishTagsAndNotesToRemote) publishTagsAndNotesToRemote = await getVar("publishRemote", gitGitGadgetDir);
        if (!publishTagsAndNotesToRemote) {
            throw new Error("No remote to which to push configured");
        }

        // Initialize the worktree if necessary
        if (!(await isDirectory(workDir))) {
            await git(["init", "--bare", workDir]);
        }

        // Always fetch the Git notes first thing
        await git(
            [
                "fetch",
                "--no-tags",
                publishTagsAndNotesToRemote,
                "--",
                `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`,
            ],
            { workDir },
        );

        const notes = new GitNotes(workDir);

        if (!smtpOptions) {
            const smtpUser = await getVar("smtpUser", gitGitGadgetDir);
            const smtpHost = await getVar("smtpHost", gitGitGadgetDir);
            const smtpPass = await getVar("smtpPass", gitGitGadgetDir);
            const smtpOpts = await getVar("smtpOpts", gitGitGadgetDir);

            if (smtpUser && smtpHost && smtpPass) smtpOptions = { smtpHost, smtpOpts, smtpPass, smtpUser };
            else if (smtpUser || smtpHost || smtpPass) {
                const missing: string[] = [
                    smtpUser ? "" : "smtpUser",
                    smtpHost ? "" : "smtpHost",
                    smtpPass ? "" : "smtpPass",
                ].filter((e) => e);
                throw new Error(`Partial SMTP configuration detected (${missing.join(", ")} missing)`);
            }
        }

        const [options, allowedUsers] = await GitGitGadget.readOptions(notes);

        return new GitGitGadget(
            config,
            notes,
            options,
            allowedUsers,
            smtpOptions,
            publishTagsAndNotesToRemote,
            notesPushToken,
        );
    }

    protected static async readOptions(notes: GitNotes): Promise<[IGitGitGadgetOptions, Set<string>]> {
        const defaultOptions: IGitGitGadgetOptions = { allowedUsers: [] };

        const options: IGitGitGadgetOptions = (await notes.get<IGitGitGadgetOptions>("")) ?? defaultOptions;

        const allowedUsers = new Set<string>(options.allowedUsers);

        return [options, allowedUsers];
    }

    public readonly config: IConfig;
    public readonly workDir: string;
    public readonly notes: GitNotes;
    protected options: IGitGitGadgetOptions;
    protected allowedUsers: Set<string>;

    protected readonly smtpOptions?: ISMTPOptions;

    protected readonly publishTagsAndNotesToRemote: string;
    private readonly publishToken: string | undefined;

    protected constructor(
        config: IConfig,
        notes: GitNotes,
        options: IGitGitGadgetOptions,
        allowedUsers: Set<string>,
        smtpOptions: ISMTPOptions | undefined,
        publishTagsAndNotesToRemote: string,
        publishToken?: string,
    ) {
        if (!notes.workDir) {
            throw new Error("Could not determine Git worktree");
        }
        this.config = config;
        this.workDir = notes.workDir;
        this.notes = notes;
        this.options = options;
        this.allowedUsers = allowedUsers;

        this.smtpOptions = smtpOptions;

        this.publishTagsAndNotesToRemote = publishTagsAndNotesToRemote;
        this.publishToken = publishToken;
    }

    public isUserAllowed(user: string): boolean {
        return this.allowedUsers.has(user);
    }

    public async allowUser(vouchingUser: string, user: string): Promise<boolean> {
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

    public async denyUser(vouchingUser: string, user: string): Promise<boolean> {
        await this.fetchAndReReadOptions();
        if (!this.isUserAllowed(vouchingUser)) {
            throw new Error(`User ${vouchingUser} lacks permission for this.`);
        }

        if (!this.allowedUsers.delete(user)) {
            return false;
        }
        for (let i = 0; i < this.options.allowedUsers.length; i++) {
            if (this.options.allowedUsers[i] === user) {
                this.options.allowedUsers.splice(i, 1);
                break;
            }
        }

        await this.notes.set("", this.options, true);
        await this.pushNotesRef();
        return true;
    }

    // Send emails only to the user
    public async preview(pr: IPullRequestInfo, userInfo: IGitHubUser): Promise<IPatchSeriesMetadata | undefined> {
        const smtpOptions = this.smtpOptions;
        if (!smtpOptions) {
            throw new Error("No SMTP options configured");
        }
        if (!userInfo.email) {
            throw new Error(`No email in user info for ${userInfo.login}`);
        }
        const email = userInfo.email;

        const send = async (mail: string): Promise<string> => {
            const mbox = await parseMBox(mail);
            mbox.cc = [];
            mbox.to = email;
            console.log(mbox);
            return await sendMail(mbox, smtpOptions);
        };

        return await this.genAndSend(pr, userInfo, { noUpdate: true }, send);
    }

    // Send emails out for review
    public async submit(pr: IPullRequestInfo, userInfo: IGitHubUser): Promise<IPatchSeriesMetadata | undefined> {
        const smtpOptions = this.smtpOptions;
        if (!smtpOptions) {
            throw new Error("No SMTP options configured");
        }
        const send = async (mail: string): Promise<string> => {
            return await parseHeadersAndSendMail(mail, smtpOptions);
        };

        return await this.genAndSend(pr, userInfo, {}, send);
    }

    /** Send a reply to a mail recorded as part of this PR. */
    public async reply(
        pullRequestURL: string,
        pullRequestAuthor: string,
        author: string,
        commentID: number,
        messageID: string,
        body: string,
        originalMail: import("./send-mail.js").IParsedMBox,
    ): Promise<string> {
        if (author.toLowerCase() !== pullRequestAuthor.toLowerCase()) {
            throw new Error("Only the owner of a PR can reply to the mailing list");
        }
        if (!this.smtpOptions) throw new Error("No SMTP options configured");
        if (
            this.smtpOptions.smtpUser.toLowerCase() !== this.config.mail.smtpUser.toLowerCase() ||
            this.smtpOptions.smtpHost.toLowerCase() !== this.config.mail.smtpHost.toLowerCase()
        ) {
            throw new Error("SMTP must use the configured GitGitGadget account and host");
        }
        validateSMTPOptions(this.smtpOptions);
        if (!body.trim()) throw new Error("Reply text is required after /reply <message-id>");
        if (body.length > 10_000) throw new Error("Reply text exceeds 10000 characters");
        if (!/^[^<>\s]+@[^<>\s]+$/.test(messageID)) throw new Error("Invalid Message-ID");
        const recipient =
            this.config.project?.to || (this.config.repo.name === "git" ? "git@vger.kernel.org" : undefined);
        if (!recipient) throw new Error("No mailing list recipient is configured");
        const target = await this.notes.get<IMailMetadata>(messageID);
        if (!target || target.pullRequestURL !== pullRequestURL) {
            throw new Error("That mail is not recorded as part of this pull request");
        }
        if (originalMail.messageId?.replace(/^<|>$/g, "") !== messageID) {
            throw new Error("The mailing-list archive did not return the requested email");
        }
        const key = `reply-command:${commentID}`;
        const previous = await this.notes.get<{ status: string; messageID?: string }>(key);
        if (previous) {
            if (previous.status === "sent" && previous.messageID) return previous.messageID;
            throw new Error("This reply command has already been processed; check the mailing-list archive");
        }
        const outboundID = createReplyMessageID(messageID);
        await this.notes.set(key, { status: "sending", messageID: outboundID }, false);
        await this.notes.set(
            outboundID,
            {
                messageID: outboundID,
                pullRequestURL,
            } satisfies IMailMetadata,
            false,
        );
        await this.pushNotesRef();
        try {
            await sendReplyMail(originalMail, body.replace(/\r/g, "").trim(), this.smtpOptions, {
                author,
                from: this.config.mail.smtpUser,
                list: recipient,
                messageID: outboundID,
                sender: this.config.mail.sender,
            });
        } catch (error) {
            await this.notes.set(key, { status: "uncertain", messageID: outboundID }, true);
            await this.pushNotesRef();
            throw error;
        }
        await this.notes.set(key, { status: "sent", messageID: outboundID }, true);
        await this.pushNotesRef();
        return outboundID;
    }

    protected async updateNotesAndPullRef(
        repositoryOwner: string,
        pullRequestNumber: number,
        additionalRef?: string,
    ): Promise<string> {
        const pullRequestRef = `refs/pull/${pullRequestNumber}/head`;
        const pullRequestMerge = `refs/pull/${pullRequestNumber}/merge`;
        const args = [
            "fetch",
            "--no-tags",
            this.publishTagsAndNotesToRemote,
            "--",
            `+${this.notes.notesRef}:${this.notes.notesRef}`,
        ];

        args.push(
            ...this.config.repo.trackingBranches.map(
                (branch) => `+refs/heads/${branch}:refs/remotes/upstream/${branch}`,
            ),
        );

        const prArgs = [`+${pullRequestRef}:${pullRequestRef}`, `+${pullRequestMerge}:${pullRequestMerge}`];
        if (additionalRef) {
            args.push(`+${additionalRef}:${additionalRef}`);
        }
        if (repositoryOwner === this.config.repo.owner) {
            args.push(...prArgs);
        } else {
            await git(
                ["fetch", "--no-tags", `https://github.com/${repositoryOwner}/${this.config.repo.name}`, ...prArgs],
                {
                    workDir: this.workDir,
                },
            );
        }
        await git(args, { workDir: this.workDir });

        // re-read options
        [this.options, this.allowedUsers] = await GitGitGadget.readOptions(this.notes);

        return pullRequestRef;
    }

    protected async fetchAndReReadOptions(): Promise<void> {
        await git(
            [
                "fetch",
                "--no-tags",
                this.publishTagsAndNotesToRemote,
                "--",
                `+${GitNotes.defaultNotesRef}:${GitNotes.defaultNotesRef}`,
            ],
            { workDir: this.workDir },
        );
        [this.options, this.allowedUsers] = await GitGitGadget.readOptions(this.notes);
    }

    protected async pushNotesRef(): Promise<void> {
        await this.notes.push(this.publishTagsAndNotesToRemote, this.publishToken);

        // re-read options
        [this.options, this.allowedUsers] = await GitGitGadget.readOptions(this.notes);
    }

    // Finish the job for preview and submit
    protected async genAndSend(
        pr: IPullRequestInfo,
        userInfo: IGitHubUser,
        options: PatchSeriesOptions,
        send: SendFunction,
    ): Promise<IPatchSeriesMetadata | undefined> {
        // get metadata in work repo
        const metadata = await this.notes.get<IPatchSeriesMetadata>(pr.pullRequestURL);
        const previousTag = metadata && metadata.latestTag ? `refs/tags/${metadata.latestTag}` : undefined;
        // update work repo from base
        await this.updateNotesAndPullRef(pr.baseOwner, pr.number, previousTag);
        options.rfc = pr.draft ?? false;

        const series = await PatchSeries.getFromNotes(
            this.config,
            this.notes,
            pr.pullRequestURL,
            pr.title,
            pr.body,
            pr.baseLabel,
            pr.baseCommit,
            pr.headLabel,
            pr.headCommit,
            options,
            userInfo.name,
            userInfo.email,
        );

        const patchSeriesMetadata = await series.generateAndSend(
            console,
            send,
            this.publishTagsAndNotesToRemote,
            pr.pullRequestURL,
            new Date(),
            this.publishToken,
        );
        if (!options.noUpdate) {
            await this.pushNotesRef();
        }
        return patchSeriesMetadata;
    }
}
