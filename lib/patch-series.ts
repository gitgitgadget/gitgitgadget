import addressparser = require("nodemailer/lib/addressparser");
import { encodeWords } from "nodemailer/lib/mime-funcs";
import {
    commitExists, git, gitCommandExists, gitConfig, revListCount, revParse,
} from "./git";
import { GitNotes } from "./git-notes";
import { GitGitGadget, IGitGitGadgetOptions } from "./gitgitgadget";
import { IMailMetadata } from "./mail-metadata";
import { md2text } from "./markdown-renderer";
import { IPatchSeriesMetadata } from "./patch-series-metadata";
import { PatchSeriesOptions } from "./patch-series-options";
import { ProjectOptions } from "./project-options";
import { decode } from "rfc2047";

export interface ILogger {
    log(message: string): void;
}

export type SendFunction = (mail: string) => Promise<string>;

interface ISingletonHeader {
    key: string;
    values: string[];
}

// NOTE: first values is used when emitting headers in addSingletonHeaders
// unless it is an empty string
const singletonHeaders: ISingletonHeader[] = [
    {
        key: "Content-Description",
        values: [],
    },
    {
        key: "Content-ID",
        values: [],
    },
    {
        key: "Content-Type",
        values: ["text/plain; charset=UTF-8", "text/plain; charset=\"UTF-8\"",
                 "text/plain; charset=utf-8", "text/plain"],
    },
    {
        key: "Content-Transfer-Encoding",
        values: ["8bit", "7bit"],
    },
    {
        key: "MIME-Version",
        values: ["1.0"],
    },
];

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
            throw new Error("Cannot determine HEAD revision");
        }
        const metadata: IPatchSeriesMetadata = {
            baseCommit,
            baseLabel: project.upstreamBranch,
            headCommit,
            headLabel: project.branchName,
            iteration: 1,
        };
        let rangeDiff = "";

        if (latestTag) {
            const range = latestTag + "..." + project.branchName;
            if (! await git(["rev-list", range])) {
                throw new Error(`Branch ${project.branchName
                    } was already submitted: ${latestTag}`);
            }

            let match = latestTag.match(/-v([1-9][0-9]*)$/);
            metadata.iteration = parseInt(match && match[1] || "0", 10) + 1;

            const tagMessage = await git(["cat-file", "tag", latestTag]);
            match = tagMessage.match(/^[\s\S]*?\n\n([\s\S]*)/);
            (match ? match[1] : tagMessage).split("\n").map((line) => {
                // tslint:disable-next-line:max-line-length
                match = line.match(/https:\/\/lore\.kernel\.org\/.*\/([^/]+)/);
                if (!match) {
                    // tslint:disable-next-line:max-line-length
                    match = line.match(/https:\/\/public-inbox\.org\/.*\/([^/]+)/);
                }
                if (!match) {
                    // tslint:disable-next-line:max-line-length
                    match = line.match(/https:\/\/www\.mail-archive\.com\/.*\/([^/]+)/);
                }
                if (!match) {
                    match = line.match(/http:\/\/mid.gmane.org\/(.*)/);
                }
                if (!match) {
                    match = line.match(/^[^ :]*: Message-ID: ([^/]+)/);
                }
                if (match) {
                    if (metadata.referencesMessageIds) {
                        metadata.referencesMessageIds.unshift(match[1]);
                    } else {
                        metadata.referencesMessageIds = [match[1]];
                    }
                }
            });

            if (await gitCommandExists("range-diff", project.workDir)) {
                rangeDiff = await git(["range-diff", "--creation-factor=95",
                                       "--no-color", range]);
            }
        }

        const patchCount = await revListCount(["--no-merges",
                                               `${baseCommit}..${headCommit}`],
                                              project.workDir);

        const notes =
            new GitNotes(project.workDir, "refs/notes/mail-patch-series");
        return new PatchSeries(notes, options, project, metadata, rangeDiff,
                               patchCount);
    }

    public static async getFromNotes(notes: GitNotes,
                                     pullRequestURL: string,
                                     pullRequestTitle: string,
                                     pullRequestBody: string,
                                     baseLabel: string, baseCommit: string,
                                     headLabel: string, headCommit: string,
                                     options: PatchSeriesOptions,
                                     senderName?: string,
                                     senderEmail?: string | null):
        Promise<PatchSeries> {
        const workDir = notes.workDir;
        if (!workDir) {
            throw new Error("Need a worktree!");
        }
        let metadata: IPatchSeriesMetadata | undefined =
            await notes.get<IPatchSeriesMetadata>(pullRequestURL);

        const currentRange = `${baseCommit}..${headCommit}`;
        const patchCount = await revListCount(["--no-merges", currentRange],
                                              workDir);
        if (!patchCount) {
            throw new Error(`Invalid commit range: ${currentRange}`);
        }

        let rangeDiff = "";
        if (metadata === undefined) {
            metadata = {
                baseCommit,
                baseLabel,
                coverLetterMessageId: "not yet sent",
                headCommit,
                headLabel,
                iteration: 1,
                pullRequestURL,
            };
        } else {
            if (!options.noUpdate &&   // allow reprint of submitted PRs
                !await git(["rev-list",
                            `${metadata.headCommit}...${headCommit}`],
                           { workDir })) {
                throw new Error(`${headCommit} was already submitted`);
            }

            const previousRange =
                `${metadata.baseCommit}..${metadata.headCommit}`;
            if (await gitCommandExists("range-diff", workDir)) {
                rangeDiff = await git(["range-diff", "--no-color",
                                       "--creation-factor=95",
                                       previousRange, currentRange],
                                      { workDir });
            }

            metadata.iteration++;
            metadata.baseCommit = baseCommit;
            metadata.baseLabel = baseLabel;
            metadata.headCommit = headCommit;
            metadata.headLabel = headLabel;
            if (metadata.coverLetterMessageId) {
                if (!metadata.referencesMessageIds) {
                    metadata.referencesMessageIds = [];
                }
                metadata.referencesMessageIds
                    .push(metadata.coverLetterMessageId);
            }
            metadata.coverLetterMessageId = "not yet sent";
        }

        const indentCoverLetter = patchCount > 1 ? "" : "    ";
        const wrapCoverLetterAt = 76 - indentCoverLetter.length;

        const {
            basedOn,
            cc,
            coverLetter,
        } = await PatchSeries.parsePullRequest(workDir,
                                               pullRequestTitle,
                                               pullRequestBody,
                                               wrapCoverLetterAt,
                                               indentCoverLetter);

        // if known, add submitter to email chain
        if (senderEmail) {
            cc.push(`${senderName} <${senderEmail}>`);
        }

        if (basedOn && !await revParse(basedOn, workDir)) {
            throw new Error(`Cannot find base branch ${basedOn}`);
        }

        const publishToRemote = undefined;

        const project = await ProjectOptions.get(workDir, headCommit, cc,
                                                 basedOn, publishToRemote,
                                                 baseCommit);

        return new PatchSeries(notes, options, project, metadata,
                               rangeDiff, patchCount,
                               coverLetter,
                               senderName);
    }

    protected static async parsePullRequest(workDir: string,
                                            prTitle: string,
                                            prBody: string,
                                            wrapCoverLetterAtColumn: number,
                                            indentCoverLetter: string):
    Promise <{
        coverLetter: string;
        basedOn?: string;
        cc: string[];
    }> {
        // Replace \r\n with \n to simplify remaining parsing.
        // Note that md2text() in the end will do the replacement anyway.
        prBody = prBody.replace(/\r\n/g, "\n");

        // Remove template from description (if template exists)
        try {
            let prTemplate =
                await git(["show",
                           "upstream/master:.github/PULL_REQUEST_TEMPLATE.md"],
                          { workDir });
            // Depending on the core.autocrlf setting, the template may contain
            // \r\n line endings.
            prTemplate = prTemplate.replace(/\r\n/g, "\n");
            prBody = prBody.replace(prTemplate, "");
        } catch {
            // Just ignore it
        }

        const {
            basedOn,
            cc,
            coverLetterBody,
        } = PatchSeries.parsePullRequestBody(prBody);

        const coverLetter = `${prTitle}\n${coverLetterBody.length ?
            `\n${coverLetterBody}` : ""}`;
        let wrappedLetter = md2text(coverLetter, wrapCoverLetterAtColumn);
        if (indentCoverLetter) {
            wrappedLetter = wrappedLetter.replace(/^/mg, indentCoverLetter);
        }

        return {
            basedOn,
            cc,
            coverLetter: wrappedLetter,
        };
    }

    protected static parsePullRequestBody(prBody: string): {
        coverLetterBody: string;
        basedOn?: string;
        cc: string[];
    } {
        let basedOn;
        const cc: string[] = [];
        let coverLetterBody = prBody.trim();

        // parse the footers of the pullRequestDescription
        let match = prBody.match(/^([^]+)\n\n([^]+)$/);

        if (!match && !prBody.match(/\n\n/)) {
            // handle PR descriptions that have no body, just footers
            match = prBody.match(/^()([-A-Za-z]+: [^]+)$/);
        }

        if (match) {
            coverLetterBody = match[1];
            const footer: string[] = [];
            for (const line of match[2].trimRight().split("\n")) {
                const match2 = line.match(/^([-A-Za-z]+:)\s*(.*)$/);
                if (!match2) {
                    footer.push(line);
                } else {
                    switch (match2[1].toLowerCase()) {
                        case "based-on:":
                            if (basedOn) {
                                throw new Error(`Duplicate Based-On footer: ${
                                    basedOn} vs ${match2[2]}`);
                            }
                            basedOn = match2[2];
                            break;
                        case "cc:":
                            addressparser(match2[2], { flatten: true })
                                .forEach((e: addressparser.Address) => {
                                if (e.name) {
                                    cc.push(`${e.name} <${e.address}>`);
                                } else {
                                    cc.push(e.address);
                                }
                            });
                            break;
                        default:
                            footer.push(line);
                    }
                }
            }

            if (footer.length > 0) {
                coverLetterBody += `\n\n${footer.join("\n")}`;
            }
        }
        return {
            basedOn,
            cc,
            coverLetterBody,
        };
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

    protected static removeDuplicateHeaders(mails: string[]): void {
        mails.map((mail: string, i: number) => {
            const endOfHeader = mail.indexOf("\n\n");
            if (endOfHeader < 0) {
                return;
            }

            let headers = mail.substr(0, endOfHeader + 1);
            singletonHeaders.forEach((header: ISingletonHeader) => {
                headers = PatchSeries.stripDuplicateHeaders(headers, header);
            });

            mails[i] = headers + mail.substr(endOfHeader + 1);
        });
    }

    protected static stripDuplicateHeaders(headers: string,
                                           header: ISingletonHeader): string {
        const needle = "\n" + header.key + ":";
        let offset;

        if (headers.startsWith(`${header.key}:`)) {
            offset = 0;
        } else {
            offset = headers.indexOf(needle) + 1;
            if (!offset) {
                return headers;
            }
        }

        let endOfKey = offset + needle.length - 1;
        offset = headers.indexOf(needle, endOfKey);

        if (offset < 0) {
            return headers;
        }

        // extract values to determine if they match.
        let endOfHdr = headers.indexOf("\n", endOfKey);
        const value1 = headers.substr(endOfKey, endOfHdr - endOfKey).trim();

        do {
            endOfKey = offset + needle.length;
            endOfHdr = headers.indexOf("\n", endOfKey);
            const value2 = headers.substr(endOfKey,
                                          endOfHdr - endOfKey).trim();

            if (value1 !== value2) {
                if (0 >= header.values.indexOf(value2)) {
                    console.log("Found multiple headers where only one allowed"
                        + `\n    ${header.key}: ${value1}\n    `
                        + `${header.key}: ${value2}\nProcessing headers:\n`
                        + headers);
                }
            }

            // substr up to \n and concat from next \n
            headers = headers.substr(0, offset) + headers.substr(endOfHdr);
            offset = headers.indexOf(needle, offset);
        } while (offset >= 0);

        return headers;
    }

    protected static encodeSender(sender: string): string {
        const encoded = encodeWords(sender);

        /* Don't quote if already quoted */
        if (encoded.startsWith("\"") && encoded.match(/"\s*</)) {
            return encoded;
        }

        const match =
            encoded.match(/^([^<]*[()<>[\]:;@\\,."][^<]*?)(\s*)(<.*)/);
        if (!match) {
            return encoded;
        }

        // tslint:disable-next-line:max-line-length
        return `"${match[1].replace(/["\\\\]/g, "\\$&")}"${match[2]}${match[3]}`;
    }

    protected static insertCcAndFromLines(mails: string[], thisAuthor: string,
                                          senderName?: string):
        void {
        const isGitGitGadget = thisAuthor.match(/^GitGitGadget </);

        mails.map((mail, i) => {
            const match = mail.match(/^([^]*?)(\n\n[^]*)$/);
            if (!match) {
                throw new Error("No header found in mail #" + i + ":\n" + mail);
            }
            let header = match[1];

            const authorMatch =
                header.match(/^([^]*\nFrom: )(.*?>)(\n(?![ \t])[^]*)$/s);
            if (!authorMatch) {
                throw new Error("No From: line found in header:\n\n" + header);
            }

            let replaceSender = PatchSeries.encodeSender(thisAuthor);
            if (isGitGitGadget) {
                const onBehalfOf = i === 0 && senderName ?
                    PatchSeries.encodeSender(senderName) :
                    authorMatch[2].replace(/ <.*>$/, "");
                // Special-case GitGitGadget to send from
                // "<author> via GitGitGadget"
                replaceSender = "\""
                    + onBehalfOf.replace(/^"(.*)"$/, "$1")
                                .replace(/"/g, "\\\"")
                    + " via GitGitGadget\" "
                    + thisAuthor.replace(/^GitGitGadget /, "");
            } else if (authorMatch[2] === thisAuthor) {
                return;
            }

            header = authorMatch[1] + replaceSender + authorMatch[3];
            if (mails.length > 1 && i === 0 && senderName) {
                // skip Cc:ing and From:ing in the cover letter
                mails[i] = header + match[2];
                return;
            }

            const ccMatch =
                header.match(/^([^]*\nCc: [^]*?)(|\n(?![ \t])[^]*)$/);
            if (ccMatch) {
                header = ccMatch[1] + ",\n    " + authorMatch[2] + ccMatch[2];
            } else {
                header += "\nCc: " + authorMatch[2];
            }

            mails[i] = header + "\n\nFrom: " + decode(authorMatch[2]) +
                match[2];
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
        let footer: string = messageID ? `Submitted-As: ${midUrlPrefix
            }${messageID[1]}` : "";
        if (inReplyTo) {
            inReplyTo.map((id: string) => {
                footer += "\nIn-Reply-To: " + midUrlPrefix + id;
            });
        }

        // Subjects can contain continuation lines; simply strip out the new
        // line and keep only the space
        return match[2].replace(/\n */g, " ") + `\n\n${match[3]
            }${footer ? `\n\n${footer}` : ""}`;
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
            `Published-As: ${url}/releases/tag/${tagName
            }\nFetch-It-Via: git fetch ${url} ${tagName}\n`;

        if (basedOn) {
            insert =
                `Based-On: ${basedOn} at ${url
                }\nFetch-Base-Via: git fetch ${url} ${basedOn}\n${insert}`;
        }

        if (!tagMessage.match(/\n[-A-Za-z]+: [^\n]*\n$/)) {
            insert = "\n" + insert;
        }
        return tagMessage + insert;
    }

    protected static insertFooters(mail: string, isCoverLetter: boolean,
                                   footers: string[]): string {
        const regex = isCoverLetter ?
            /^([^]*?\n)(-- \n[^]*)$/ :
            /^([^]*?\n---\n(?:\n[A-Za-z:]+ [^]*?\n\n)?)([^]*)$/;
        const match = mail.match(regex);
        if (!match) {
            throw new Error("Failed to find range-diff insertion "
                + "point for\n\n" + mail);
        }

        const n = isCoverLetter ? "" : "\n";
        return `${match[1]}${n}${footers.join("\n")}\n${n}${match[2]}`;
    }

    protected static adjustDateHeaders(mails: string[], forceDate: Date):
        number {
        let count = 0;

        const time = forceDate.getTime();
        for (let i = 0, j = mails.length - 1; i < mails.length; i++ , j--) {
            const mail = mails[i];

            /* Look for the date header */
            let dateOffset;
            if (mail.startsWith("Date: ")) {
                dateOffset = 6;
            } else {
                dateOffset = mail.indexOf("\nDate: ");
                if (dateOffset < 0) {
                    continue;
                }
                const endOfHeader = mail.indexOf("\n\n");
                if (dateOffset > endOfHeader) {
                    continue;
                }
                dateOffset += 7;
            }

            const endOfLine = mail.indexOf("\n", dateOffset);
            mails[i] = mail.substr(0, dateOffset) +
                new Date(time - j * 1000).toUTCString().replace(/GMT$/, "+0000")
                + mail.substr(endOfLine);
            count++;
        }

        return count;
    }

    protected static generateSingletonHeaders(): string[] {
        const results: string[] = [];

        for (const key of singletonHeaders) {
            if (key.values.length) {
                results.push(`--add-header=${key.key}: ${key.values[0]}`);
            }
        }

        return results;
    }

    public readonly notes: GitNotes;
    public readonly options: PatchSeriesOptions;
    public readonly project: ProjectOptions;
    public readonly metadata: IPatchSeriesMetadata;
    public readonly rangeDiff: string;
    public readonly coverLetter?: string;
    public readonly senderName?: string;
    public readonly patchCount: number;

    protected constructor(notes: GitNotes, options: PatchSeriesOptions,
                          project: ProjectOptions,
                          metadata: IPatchSeriesMetadata, rangeDiff: string,
                          patchCount: number,
                          coverLetter?: string, senderName?: string) {
        this.notes = notes;
        this.options = options;
        this.project = project;
        this.metadata = metadata;
        this.rangeDiff = rangeDiff;
        this.coverLetter = coverLetter;
        this.senderName = senderName;
        this.patchCount = patchCount;
    }

    public subjectPrefix(): string {
        return `${this.options.noUpdate ? "PREVIEW" : "PATCH"
            }${this.options.rfc ?
            "/RFC" : ""}${this.metadata.iteration > 1 ?
            ` v${this.metadata.iteration}` : ""}`;
    }

    public async generateAndSend(logger: ILogger,
                                 send?: SendFunction,
                                 publishTagsAndNotesToRemote?: string,
                                 pullRequestURL?: string,
                                 forceDate?: Date):
        Promise<string | undefined> {
        let globalOptions: IGitGitGadgetOptions | undefined;
        if (this.options.dryRun) {
            logger.log(`Dry-run ${this.project.branchName
                 } v${this.metadata.iteration}`);
        } else {
            logger.log(`Submitting ${this.project.branchName
                 } v${this.metadata.iteration}`);
            globalOptions = await this.notes.get<IGitGitGadgetOptions>("");
        }

        logger.log("Generating mbox");
        const mbox = await this.generateMBox();
        const mails: string[] = PatchSeries.splitMails(mbox);
        PatchSeries.removeDuplicateHeaders(mails);

        const ident = await git(["var", "GIT_AUTHOR_IDENT"], {
            workDir: this.project.workDir,
        });
        const match = ident.match(/.*>/);
        const thisAuthor = match && match[0];
        if (!thisAuthor) {
            throw new Error("Could not determine author ident from " + ident);
        }

        logger.log("Adding Cc: and explicit From: lines for other authors, "
            + "if needed");
        PatchSeries.insertCcAndFromLines(mails, thisAuthor, this.senderName);
        if (mails.length > 1) {
            if (this.coverLetter) {
                const match2 = mails[0].match(
                    /^([^]*?\n\*\*\* BLURB HERE \*\*\*\n\n)([^]*)/);
                if (!match2) {
                    throw new Error(`Could not find blurb in ${mails[0]}`);
                }
                mails[0] = `${match2[1]}${this.coverLetter}\n\n${match2[2]}`;
            }

            logger.log("Fixing Subject: line of the cover letter");
            mails[0] = PatchSeries.adjustCoverLetter(mails[0]);
        }

        const midMatch = mails[0].match(/\nMessage-ID: <(.*)>/i);
        let coverMid = midMatch ? midMatch[1] : undefined;

        if (this.metadata.pullRequestURL) {
            if (!coverMid) {
                throw new Error("Could not extract cover letter Message-ID");
            }

            const tsMatch = coverMid.match(/cover\.([0-9]+)\./);
            const timeStamp = tsMatch ? tsMatch[1] : `${Date.now()}`;
            const emailMatch = thisAuthor.match(/<(.*)>/);
            if (!emailMatch) {
                throw new Error(`Could not parse email of '${thisAuthor}`);
            }
            const email = emailMatch[1];

            const prMatch = this.metadata.pullRequestURL
                .match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
            if (prMatch) {
                const infix = this.metadata.iteration > 1 ?
                    `.v${this.metadata.iteration}` : "";
                const repoInfix = prMatch[1] === "gitgitgadget" ?
                    prMatch[2] : `${prMatch[1]}.${prMatch[2]}`;
                const newCoverMid =
                    `pull.${prMatch[3]}${infix}.${repoInfix}.${
                    timeStamp}.${email}`;
                mails.map((value: string, index: number): void => {
                    // cheap replace-all
                    mails[index] = value.split(coverMid!).join(newCoverMid);
                });
                coverMid = newCoverMid;
            }
        }
        this.metadata.coverLetterMessageId = coverMid;

        logger.log("Generating tag message");
        let tagMessage =
            PatchSeries.generateTagMessage(mails[0], mails.length > 1,
                                           this.project.midUrlPrefix,
                                           this.metadata.referencesMessageIds);
        let tagName;
        if (!this.metadata.pullRequestURL) {
            tagName = `${this.project.branchName}-v${this.metadata.iteration}`;
        } else {
            const [owner, , prNumber] =
                GitGitGadget.parsePullRequestURL(this.metadata.pullRequestURL);
            const branch = this.metadata.headLabel.replace(/:/g, "/");
            const tagPrefix = owner === "gitgitgadget" ? "pr-" : `pr-${owner}-`;
            tagName = `${tagPrefix}${prNumber}/${branch}-v${
                this.metadata.iteration}`;
        }
        if (this.project.publishToRemote) {
            const url =
                await gitConfig(`remote.${this.project.publishToRemote}.url`,
                                this.project.workDir);
            if (!url) {
                throw new Error(`remote ${this.project.publishToRemote
                    } lacks URL`);
            }

            logger.log("Inserting links");
            tagMessage = PatchSeries.insertLinks(tagMessage, url, tagName,
                                                 this.project.basedOn);
        }

        if (this.options.noUpdate) {
            logger.log(`Would generate tag ${tagName} with message:\n\n ${
                tagMessage.split("\n").map((line: string) => {
                    return "    " + line;
                }).join("\n")}`);
        } else {
            logger.log("Generating tag object");
            await this.generateTagObject(tagName, tagMessage);
            this.metadata.latestTag = tagName;
        }

        const footers: string[] = [];

        if (pullRequestURL) {
            const prefix = "https://github.com/gitgitgadget/git";
            const tagName2 = encodeURIComponent(tagName);
            footers.push(`Published-As: ${prefix}/releases/tag/${tagName2}`);
            footers.push(`Fetch-It-Via: git fetch ${prefix} ${tagName}`);
            footers.push(`Pull-Request: ${pullRequestURL}`);
        }

        if (this.rangeDiff) {
            if (footers.length > 0) {
                footers.push(""); // empty line
            }
            // split the range-diff and prefix with a space
            footers.push(`Range-diff vs v${this.metadata.iteration - 1}:\n\n${
                         this.rangeDiff.replace(/(^|\n(?!$))/g, "$1 ")}\n`);
        }

        logger.log("Inserting footers");
        if (footers.length > 0) {
            mails[0] = PatchSeries.insertFooters(mails[0],
                                                 mails.length > 1, footers);
        }

        /*
         * Finally, *after* inserting the range-diff and the footers (if any),
         * insert the cover letter into single-patch submissions.
         */
        if (mails.length === 1 && this.coverLetter) {
            if (this.patchCount !== 1) {
                throw new Error(`Patch count mismatch: ${mails.length} vs ${
                    this.patchCount}`);
            }
            // Need to insert it into the first mail
            const splitAtTripleDash = mails[0].match(/([^]*?\n---\n)([^]*)$/);
            if (!splitAtTripleDash) {
                throw new Error(`No \`---\` found in\n${mails[0]}`);
            }
            console.log(`Insert cover letter into\n${mails[0]}\nwith match:`);
            console.log(splitAtTripleDash);
            mails[0] = splitAtTripleDash[1] +
                this.coverLetter + "\n" + splitAtTripleDash[2];
            console.log(mails[0]);
        }

        logger.log("Adjusting Date headers");
        if (forceDate) {
            PatchSeries.adjustDateHeaders(mails, forceDate);
        }

        if (this.options.dryRun) {
            logger.log(`Would send this mbox:\n\n${
                mbox.split("\n").map((line) => {
                    return "    " + line;
                }).join("\n")}`);
        } else if (send) {
            for (const mail of mails) {
                await send(mail);
            }
        } else {
            logger.log("Calling the `send-mbox` alias");
            await this.sendMBox(mails.join("\n"));
        }

        logger.log("Updating the mail metadata");
        let isCoverLetter: boolean = mails.length > 1;
        for (const mail of mails) {
            const messageID = mail.match(/\nMessage-ID: <(.*?)>\n/i);
            if (messageID) {
                let originalCommit: string | undefined;
                if (isCoverLetter) {
                    isCoverLetter = false;
                } else {
                    const commitMatch = mail.match(/^From ([0-9a-f]{40}) /);
                    if (commitMatch) {
                        originalCommit = commitMatch[1];
                    }
                }

                const mid = messageID[1];
                const mailMeta = {
                    messageID: mid,
                    originalCommit,
                    pullRequestURL: this.metadata.pullRequestURL,
                } as IMailMetadata;
                await this.notes.set(mid, mailMeta, true);
                if (globalOptions && originalCommit &&
                    this.metadata.pullRequestURL) {
                    if (!globalOptions.activeMessageIDs) {
                        globalOptions.activeMessageIDs = {};
                    }
                    globalOptions.activeMessageIDs[mid] = originalCommit;
                }

                if (originalCommit &&
                    await commitExists(originalCommit, this.project.workDir)) {
                    await this.notes.appendCommitNote(originalCommit, mid);
                }
            }
        }

        if (globalOptions && this.metadata.pullRequestURL) {
            if (!globalOptions.openPRs) {
                globalOptions.openPRs = {};
            }
            globalOptions.openPRs[this.metadata.pullRequestURL] =
                coverMid || "";
            await this.notes.set("", globalOptions, true);
        }

        logger.log("Publishing branch and tag");
        await this.publishBranch(tagName);

        if (!this.options.dryRun) {
            const key = this.metadata.pullRequestURL || this.project.branchName;
            await this.notes.set(key, this.metadata, true);
        }

        if (!this.options.noUpdate && publishTagsAndNotesToRemote) {
            await git(["push", publishTagsAndNotesToRemote, this.notes.notesRef,
                       `refs/tags/${tagName}`],
                      { workDir: this.notes.workDir });
        }

        return this.metadata.coverLetterMessageId;
    }

    protected async generateMBox(): Promise<string> {
        const mergeBase = await git(["merge-base", this.project.baseCommit,
                                     this.project.branchName],
                                    { workDir: this.project.workDir });
        const args = [
            "format-patch", "--thread", "--stdout", "--signature=gitgitgadget",
            "--add-header=Fcc: Sent",
            "--base", mergeBase, this.project.to,
        ].concat(PatchSeries.generateSingletonHeaders());
        this.project.cc.map((email) => {
            args.push("--cc=" + PatchSeries.encodeSender(email));
        });
        if (this.metadata.referencesMessageIds) {
            this.metadata.referencesMessageIds.map((email) => {
                args.push("--in-reply-to=" + email);
            });
        }
        const subjectPrefix = this.subjectPrefix();
        if (subjectPrefix) {
            args.push("--subject-prefix=" + subjectPrefix);
        }
        if (this.patchCount > 1 ) {
            if (!this.coverLetter) {
                    throw new Error(`Branch ${this.project.branchName
                        } needs a description`);
            }
            args.push("--cover-letter");
        }
        if (this.options.patience) {
            args.push("--patience");
        }

        args.push(`${this.project.baseCommit}..${this.project.branchName}`);

        return await git(args, { workDir: this.project.workDir });
    }

    protected async generateTagObject(tagName: string, tagMessage: string):
        Promise<void> {
        const args = ["tag", "-F", "-", "-a"];
        if (this.options.redo) {
            args.push("-f");
        }
        args.push(tagName);
        args.push(this.metadata.headCommit);
        await git(args, { stdin: tagMessage, workDir: this.project.workDir });
    }

    protected async sendMBox(mbox: string): Promise<void> {
        await git(["send-mbox"], {
            stdin: mbox,
            workDir: this.project.workDir,
        });
    }

    protected async publishBranch(tagName: string): Promise<void> {
        if (!this.project.publishToRemote || this.options.noUpdate) {
            return;
        }

        if (this.options.redo) {
            tagName = "+" + tagName;
        }
        await git(["push", this.project.publishToRemote,
                   `+${this.project.branchName}`, tagName],
                  { workDir: this.project.workDir },
        );
    }
}
