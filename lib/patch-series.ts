import { git, gitConfig, revParse } from "./git";
import { IPatchSeriesMetadata } from "./patch-series-metadata";
import { PatchSeriesOptions } from "./patch-series-options";
import { ProjectOptions } from "./project-options";

export interface ILogger {
    log(message: string): void;
}

export class PatchSeries {
    public static async getFromTag(options: PatchSeriesOptions,
                                   project: ProjectOptions):
        Promise<PatchSeries> {
        const latestTag: string = await this.getLatestTag(project.branchName,
            options.redo);

        const baseCommit = await revParse(project.upstreamBranch);
        if (!baseCommit) {
            throw new Error(`Cannot determine tip of ${project.basedOn}`);
        }
        const headCommit = await revParse("HEAD");
        if (!headCommit) {
            throw new Error(`Cannot determine HEAD revision`);
        }
        const metadata: IPatchSeriesMetadata = {
            baseCommit,
            baseLabel: project.upstreamBranch,
            headCommit,
            headLabel: project.branchName,
            iteration: 1,
        };
        let branchDiff: string = "";

        if (latestTag) {
            const range = latestTag + "..." + project.branchName;
            if (! await git(["rev-list", range])) {
                throw new Error("Branch " + project.branchName
                    + " was already submitted: " + latestTag);
            }

            let match = latestTag.match(/-v([1-9][0-9]*)$/);
            metadata.iteration = parseInt(match && match[1] || "0", 10) + 1;

            const tagMessage = await git(["cat-file", "tag", latestTag]);
            match = tagMessage.match(/^[\s\S]*?\n\n([\s\S]*)/);
            (match ? match[1] : tagMessage).split("\n").map((line) => {
                match = line.match(/https:\/\/public-inbox\.org\/.*\/([^\/]+)/);
                if (!match) {
                    // tslint:disable-next-line:max-line-length
                    match = line.match(/https:\/\/www\.mail-archive\.com\/.*\/([^\/]+)/);
                }
                if (!match) {
                    match = line.match(/http:\/\/mid.gmane.org\/(.*)/);
                }
                if (!match) {
                    match = line.match(/^[^ :]*: Message-ID: ([^\/]+)/);
                }
                if (match) {
                    if (metadata.referencesMessageIds) {
                        metadata.referencesMessageIds.unshift(match[1]);
                    } else {
                        metadata.referencesMessageIds = [match[1]];
                    }
                }
            });

            branchDiff = await git(["tbdiff", "--no-color", range]);
        }

        const coverLetter =
            await gitConfig(`branch.${project.branchName}.description`);

        return new PatchSeries(options, project, metadata, branchDiff,
            coverLetter);
    }

    protected static async getLatestTag(branchName: string, redo?: boolean):
        Promise<string> {
        const args: string[] = [
            "for-each-ref", "--format=%(refname)", "--sort=-taggerdate",
            "refs/tags/" + branchName + "-v*[0-9]",
        ];
        const latesttags: string[] = (await git(args)).split("\n");

        if (redo) {
            return latesttags.length > 1 ? latesttags[1] : "";
        }
        return latesttags.length > 0 ? latesttags[0] : "";
    }

    protected static splitMails(mbox: string): string[] {
        // tslint:disable-next-line:max-line-length
        const separatorRegex = /\n(?=From [0-9a-f]{40} Mon Sep 17 00:00:00 2001\n)/;
        return mbox.split(separatorRegex);
    }

    protected static insertCcAndFromLines(mails: string[], thisAuthor: string):
        void {
        mails.map((mail, i) => {
            const match = mail.match(/^([^]*?)(\n\n[^]*)$/);
            if (!match) {
                throw new Error("No header found in mail #" + i + ":\n" + mail);
            }
            let header = match[1];

            const authorMatch =
                header.match(/^([^]*\nFrom: )(.*?)(\n(?! )[^]*)$/);
            if (!authorMatch) {
                throw new Error("No From: line found in header:\n\n" + header);
            }
            if (authorMatch[2] === thisAuthor) {
                return;
            }

            header = authorMatch[1] + thisAuthor + authorMatch[3];
            const ccMatch = header.match(/^([^]*\nCc: .*?)(\n(?! )[^]*)$/);
            if (ccMatch) {
                header = ccMatch[1] + ", " + authorMatch[2] + ccMatch[2];
            } else {
                header += "\nCc: " + authorMatch[2];
            }

            mails[i] = header + "\n\nFrom: " + authorMatch[2] + match[2];
        });
    }

    protected static adjustCoverLetter(coverLetter: string): string {
        const regex =
            // tslint:disable-next-line:max-line-length
            /^([^]*?\nSubject: .* )\*\*\* SUBJECT HERE \*\*\*(?=\n)([^]*?\n\n)\*\*\* BLURB HERE \*\*\*\n\n([^]*?)\n\n([^]*)$/;
        const match = coverLetter.match(regex);
        if (!match) {
            throw new Error("Could not parse cover letter:\n\n" + coverLetter);
        }

        const subject = match[3].split(/\n(?=.)/).join("\n ");
        return match[1] + subject + match[2] + match[4];
    }

    protected static generateTagMessage(mail: string, isCoverLetter: boolean,
                                        midUrlPrefix: string,
                                        inReplyTo: string[] | undefined):
        string {
        const regex = isCoverLetter ?
            /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*-- \n/ :
            /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*---\n/;
        const match = mail.match(regex);
        if (!match) {
            throw new Error("Could not generate tag message from mail:\n\n"
                + mail);
        }

        const messageID = mail.match(/\nMessage-ID: <(.*?)>\n/i);
        let footer: string = messageID ? "Submitted-As: " + midUrlPrefix
            + messageID[1] : "";
        if (inReplyTo) {
            inReplyTo.map((id: string) => {
                footer += "\nIn-Reply-To: " + midUrlPrefix + id;
            });
        }

        // Subjects can contain continuation lines; simply strip out the new
        // line and keep only the space
        return match[2].replace(/\n */g, " ") + "\n\n" + match[3]
            + (footer ? "\n\n" + footer : "");
    }

    protected static insertLinks(tagMessage: string, url: string,
                                 tagName: string, basedOn?: string): string {
        if (!url) {
            return tagMessage;
        }

        let match = url.match(/^https?(:\/\/github\.com\/.*)/);
        if (match) {
            url = "https" + match[1];
        } else {
            match = url.match(/^(git@)?github\.com(:.*)/);
            if (match) {
                url = "https://github.com/" + match[1];
            } else {
                return tagMessage;
            }
        }

        let insert =
            "Published-As: " + url + "/releases/tag/" + tagName + "\n" +
            "Fetch-It-Via: git fetch " + url + " " + tagName + "\n";

        if (basedOn) {
            insert =
                "Based-On: " + basedOn + " at " + url + "\n" +
                "Fetch-Base-Via: git fetch " + url + " " + basedOn + "\n" +
                insert;
        }

        if (!tagMessage.match(/\n[-A-Za-z]+: [^\n]*\n$/)) {
            insert = "\n" + insert;
        }
        return tagMessage + insert;
    }

    protected static insertBranchDiff(mail: string, isCoverLetter: boolean,
                                      branchDiffHeader: string,
                                      branchDiff: string): string {
        if (!branchDiff) {
            return mail;
        }

        const regex = isCoverLetter ?
            /^([^]*?\n-- \n)([^]*)$/ :
            /^([^]*?\n---\n(?:\n[A-Za-z:]+ [^]*?\n\n)?)([^]*)$/;
        const match = mail.match(regex);
        if (!match) {
            throw new Error("Failed to find branch-diff insertion "
                + "point for\n\n" + mail);
        }

        // split the branch-diff and prefix with a space
        return match[1] + "\n" + (branchDiffHeader ?
            branchDiffHeader + "\n" : "")
            + branchDiff.replace(/(^|\n(?!$))/g, "$1 ") + "\n" + match[2];
    }

    public readonly options: PatchSeriesOptions;
    public readonly project: ProjectOptions;
    public readonly metadata: IPatchSeriesMetadata;
    public readonly branchDiff: string;
    public readonly coverLetter?: string;

    protected constructor(options: PatchSeriesOptions, project: ProjectOptions,
                          metadata: IPatchSeriesMetadata, branchDiff: string,
                          coverLetter?: string) {
        this.options = options;
        this.project = project;
        this.metadata = metadata;
        this.branchDiff = branchDiff;
        this.coverLetter = coverLetter;
    }

    public subjectPrefix(): string {
        if (this.metadata.iteration === 1) {
            return this.options.rfc ? "PATCH/RFC" : "";
        } else {
            return `PATCH${this.options.rfc ?
                "/RFC" : ""} v${this.metadata.iteration}`;
        }
    }

    public async generateAndSend(logger: ILogger): Promise<void> {
        if (this.options.dryRun) {
            logger.log("Dry-run " + this.project.branchName
                + " v" + this.metadata.iteration);
        } else {
            logger.log("Submitting " + this.project.branchName
                + " v" + this.metadata.iteration);
        }

        logger.log("Generating mbox");
        const mbox = await this.generateMBox();
        const mails: string[] = PatchSeries.splitMails(mbox);

        const ident = await git(["var", "GIT_AUTHOR_IDENT"]);
        const match = ident.match(/.*>/);
        const thisAuthor = match && match[0];
        if (!thisAuthor) {
            throw new Error("Could not determine author ident from " + ident);
        }

        logger.log("Adding Cc: and explicit From: lines for other authors, "
            + "if needed");
        await PatchSeries.insertCcAndFromLines(mails, thisAuthor);
        if (mails.length > 1) {
            logger.log("Fixing Subject: line of the cover letter");
            mails[0] = await PatchSeries.adjustCoverLetter(mails[0]);
        }

        logger.log("Generating tag message");
        let tagMessage =
            await PatchSeries.generateTagMessage(mails[0], mails.length > 1,
                this.project.midUrlPrefix,
                this.metadata.referencesMessageIds);
        const url =
            await gitConfig(`remote.${this.project.publishToRemote}.url`);
        const tagName =
            `${this.project.branchName}-v${this.metadata.iteration}`;

        logger.log("Inserting links");
        tagMessage = await PatchSeries.insertLinks(tagMessage, url, tagName,
            this.project.basedOn);

        if (this.options.dryRun) {
            logger.log("Would generate tag " + tagName
                + " with message:\n\n"
                + tagMessage.split("\n").map((line: string) => {
                    return "    " + line;
                }).join("\n"));
        } else {
            logger.log("Generating tag object");
            await this.generateTagObject(tagName, tagMessage);
        }

        logger.log("Inserting branch-diff");
        if (this.branchDiff) {
            mails[0] = PatchSeries.insertBranchDiff(mails[0], mails.length > 1,
                `Branch - diff vs v${this.metadata.iteration - 1}: `,
                this.branchDiff);
        }

        if (this.options.dryRun) {
            logger.log("Would send this mbox:\n\n"
                + mbox.split("\n").map((line) => {
                    return "    " + line;
                }).join("\n"));
        } else {
            logger.log("Calling the `send-mbox` alias");
            await this.sendMBox(mails.join("\n"));
        }

        logger.log("Publishing branch and tag");
        await this.publishBranch(tagName);
    }

    protected async generateMBox(): Promise<string> {
        const commitRange = this.project.upstreamBranch + ".."
            + this.project.branchName;
        if (!this.coverLetter && 1 < parseInt(await git(["rev-list", "--count",
            commitRange]), 10)) {
            throw new Error("Branch " + this.project.branchName
                + " needs a description");
        }

        const args = ["format-patch", "--thread", "--stdout",
            "--add-header=Fcc: Sent",
            "--add-header=Content-Type: text/plain; charset=UTF-8",
            "--add-header=Content-Transfer-Encoding: 8bit",
            "--add-header=MIME-Version: 1.0",
            "--base", this.project.upstreamBranch, this.project.to];
        this.project.cc.map((email) => { args.push("--cc=" + email); });
        if (this.metadata.referencesMessageIds) {
            this.metadata.referencesMessageIds.map((email) => {
                args.push("--in-reply-to=" + email);
            });
        }
        const subjectPrefix = this.subjectPrefix();
        if (subjectPrefix) {
            args.push("--subject-prefix=" + subjectPrefix);
        }
        if (this.coverLetter) {
            args.push("--cover-letter");
        }
        if (this.options.patience) {
            args.push("--patience");
        }

        args.push(commitRange);

        return await git(args);
    }

    protected async generateTagObject(tagName: string, tagMessage: string):
        Promise<void> {
        const args = ["tag", "-F", "-", "-a"];
        if (this.options.redo) {
            args.push("-f");
        }
        args.push(tagName);
        await git(args, { stdin: tagMessage });
    }

    protected async sendMBox(mbox: string): Promise<void> {
        await git(["send-mbox"], { stdin: mbox });
    }

    protected async publishBranch(tagName: string): Promise<void> {
        if (!this.project.publishToRemote || this.options.dryRun) {
            return;
        }

        if (this.options.redo) {
            tagName = "+" + tagName;
        }
        await git(["push", this.project.publishToRemote, "+"
            + this.project.branchName, tagName]);
    }
}
