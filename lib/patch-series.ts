/* eslint-disable security/detect-unsafe-regex */
import addressparser from "nodemailer/lib/addressparser/index.js";
import mimeFuncs from "nodemailer/lib/mime-funcs/index.js";
import { commitExists, git, gitConfig, gitShortHash, revListCount, revParse } from "./git.js";
import { GitNotes } from "./git-notes.js";
import { IGitGitGadgetOptions } from "./gitgitgadget.js";
import { IMailMetadata } from "./mail-metadata.js";
import { md2text } from "./markdown-renderer.js";
import { IPatchSeriesMetadata } from "./patch-series-metadata.js";
import { PatchSeriesOptions } from "./patch-series-options.js";
import { IConfig } from "./project-config.js";
import { ProjectOptions } from "./project-options.js";
import { getPullRequestKeyFromURL } from "./pullRequestKey.js";

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
        values: ["text/plain; charset=UTF-8", 'text/plain; charset="UTF-8"', "text/plain; charset=utf-8", "text/plain"],
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

interface IRangeDiff {
    previousRange: string;
    currentRange: string;
    baseCommit: string;
    headCommit: string;
}

export class PatchSeries {
    public static async getFromNotes(
        config: IConfig,
        notes: GitNotes,
        pullRequestURL: string,
        pullRequestTitle: string,
        pullRequestBody: string,
        baseLabel: string,
        baseCommit: string,
        headLabel: string,
        headCommit: string,
        options: PatchSeriesOptions,
        senderName?: string,
        senderEmail?: string | null,
    ): Promise<PatchSeries> {
        const workDir = notes.workDir;
        if (!workDir) {
            throw new Error("Need a worktree!");
        }
        let metadata: IPatchSeriesMetadata | undefined = await notes.get<IPatchSeriesMetadata>(pullRequestURL);

        const currentRange = `${baseCommit}..${headCommit}`;
        const patchCount = await revListCount(["--no-merges", currentRange], workDir);
        if (!patchCount) {
            throw new Error(`Invalid commit range: ${currentRange}`);
        }

        let rangeDiffRanges: IRangeDiff | undefined;
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
            if (
                !options.noUpdate && // allow reprint of submitted PRs
                !(await git(["rev-list", `${metadata.headCommit}...${headCommit}`], { workDir }))
            ) {
                throw new Error(`${headCommit} was already submitted`);
            }

            const previousRange = `${metadata.baseCommit}..${metadata.headCommit}`;
            rangeDiffRanges = { previousRange, currentRange, baseCommit: metadata.baseCommit, headCommit };

            metadata.iteration++;
            metadata.baseCommit = baseCommit;
            metadata.baseLabel = baseLabel;
            metadata.headCommit = headCommit;
            metadata.headLabel = headLabel;
            if (metadata.coverLetterMessageId) {
                if (!metadata.referencesMessageIds) {
                    metadata.referencesMessageIds = [];
                }
                metadata.referencesMessageIds.push(metadata.coverLetterMessageId);
            }
            metadata.coverLetterMessageId = "not yet sent";
        }

        const indentCoverLetter = patchCount > 1 ? "" : "    ";
        const wrapCoverLetterAt = 76 - indentCoverLetter.length;

        const { basedOn, cc, coverLetter, rangeDiff } = await PatchSeries.parsePullRequest(
            workDir,
            pullRequestTitle,
            pullRequestBody,
            wrapCoverLetterAt,
            indentCoverLetter,
        );

        // if known, add submitter to email chain
        if (senderEmail) {
            cc.push(`${senderName} <${senderEmail}>`);
        }

        if (basedOn && !(await revParse(basedOn, workDir))) {
            throw new Error(`Cannot find base branch ${basedOn}`);
        }

        const publishToRemote: string | undefined = undefined;

        const project = await ProjectOptions.get(workDir, headCommit, cc, basedOn, publishToRemote, baseCommit);
        if (rangeDiff) {
            options.rangeDiff = rangeDiff;
        }

        return new PatchSeries(
            config,
            notes,
            options,
            project,
            metadata,
            rangeDiffRanges,
            patchCount,
            coverLetter,
            senderName,
        );
    }

    protected static async parsePullRequest(
        workDir: string,
        prTitle: string,
        prBody: string,
        wrapCoverLetterAtColumn: number,
        indentCoverLetter: string,
    ): Promise<{
        coverLetter: string;
        basedOn?: string;
        cc: string[];
        rangeDiff?: string;
    }> {
        // Replace \r\n with \n to simplify remaining parsing.
        // Note that md2text() in the end will do the replacement anyway.
        prBody = prBody.replace(/\r\n/g, "\n");

        // Remove template from description (if template exists)
        try {
            let prTemplate = await git(["show", "upstream/master:.github/PULL_REQUEST_TEMPLATE.md"], { workDir });
            // Depending on the core.autocrlf setting, the template may contain
            // \r\n line endings.
            prTemplate = prTemplate.replace(/\r\n/g, "\n");
            prBody = prBody.replace(prTemplate, "");
        } catch (_) {
            // Just ignore it
        }

        const { basedOn, cc, coverLetterBody, rangeDiff } = PatchSeries.parsePullRequestBody(prBody);

        const coverLetter = `${prTitle}\n${coverLetterBody.length ? `\n${coverLetterBody}` : ""}`;
        let wrappedLetter = md2text(coverLetter, wrapCoverLetterAtColumn);
        if (indentCoverLetter) {
            wrappedLetter = wrappedLetter.replace(/^/gm, indentCoverLetter);
        }

        return { basedOn, cc, coverLetter: wrappedLetter, rangeDiff };
    }

    protected static parsePullRequestBody(prBody: string): {
        coverLetterBody: string;
        basedOn?: string;
        cc: string[];
        rangeDiff?: string;
    } {
        let basedOn: string | undefined;
        const cc: string[] = [];
        let coverLetterBody = prBody.trim();
        let rangeDiff: string | undefined;

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
                                throw new Error(`Duplicate Based-On footer: ${basedOn} vs ${match2[2]}`);
                            }
                            basedOn = match2[2];
                            break;
                        case "cc:":
                            addressparser(match2[2], { flatten: true }).forEach((e: addressparser.Address) => {
                                if (e.name) {
                                    cc.push(`${e.name} <${e.address}>`);
                                } else {
                                    cc.push(e.address);
                                }
                            });
                            break;
                        case "range-diff:":
                            if (rangeDiff) {
                                throw new Error(`Duplicate Range-Diff`);
                            }
                            rangeDiff = match2[2];
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
            rangeDiff,
        };
    }

    protected static splitMails(mbox: string): string[] {
        const re = /\n(?=From [0-9a-f]{40} Mon Sep 17 00:00:00 2001\n)/;
        return mbox.split(re);
    }

    protected static cleanUpHeaders(mails: string[]): void {
        mails.map((mail: string, i: number) => {
            const endOfHeader = mail.indexOf("\n\n");
            if (endOfHeader < 0) {
                return;
            }

            let headers = mail.substring(0, endOfHeader + 1);
            singletonHeaders.forEach((header: ISingletonHeader) => {
                headers = PatchSeries.stripDuplicateHeaders(headers, header);
            });

            headers = headers.replace(/(\n|^)message-id:/gi, "$1Message-Id:").replace(/(\n|^)date:/gi, "$1Date:");

            mails[i] = headers + mail.substring(endOfHeader + 1);
        });
    }

    private static stripDuplicateHeaders(headers: string, header: ISingletonHeader): string {
        const needle = "\n" + header.key + ":";
        let offset: number;

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
        const value1 = headers.substring(endOfKey, endOfHdr).trim();

        do {
            endOfKey = offset + needle.length;
            endOfHdr = headers.indexOf("\n", endOfKey);
            const value2 = headers.substring(endOfKey, endOfHdr).trim();

            if (value1 !== value2) {
                if (0 >= header.values.indexOf(value2)) {
                    console.log(
                        `Found multiple headers where only one allowed\n    ${header.key}: ${
                            value1
                        }\n    ${header.key}: ${value2}\nProcessing headers:\n${headers}`,
                    );
                }
            }

            // substr up to \n and concat from next \n
            headers = headers.substring(0, offset) + headers.substring(endOfHdr);
            offset = headers.indexOf(needle, offset);
        } while (offset >= 0);

        return headers;
    }

    protected static encodeSender(sender: string): string {
        const encoded = mimeFuncs.encodeWords(sender);

        /* Don't quote if already quoted */
        if (encoded.startsWith('"') && encoded.match(/"\s*</)) {
            return encoded;
        }

        const match = encoded.match(/^([^<]*[()<>[\]:;@\\,."][^<]*?)(\s*)(<.*)/);
        if (!match) {
            return encoded;
        }

        return `"${match[1].replace(/["\\\\]/g, "\\$&")}"${match[2]}${match[3]}`;
    }

    protected insertCcAndFromLines(mails: string[], thisAuthor: string, senderName?: string): void {
        const isGitGitGadget = thisAuthor.match(`^${this.config.mail.author} (<.*)$`);

        mails.map((mail, i) => {
            const match = mail.match(/^([^]*?)(\n\n[^]*)$/);
            if (!match) {
                throw new Error(`No header found in mail #${i}:\n${mail}`);
            }
            let header = match[1];

            const authorMatch = header.match(/^([^]*\nFrom: )([^]*?)(\n(?![ \t])[^]*)$/);
            if (!authorMatch) {
                throw new Error("No From: line found in header:\n\n" + header);
            }

            let replaceSender = PatchSeries.encodeSender(thisAuthor);
            if (isGitGitGadget) {
                const onBehalfOf =
                    i === 0 && senderName ? PatchSeries.encodeSender(senderName) : authorMatch[2].replace(/ <.*>$/, "");
                // Special-case GitGitGadget to send from  "<author> via GitGitGadget"
                replaceSender = `"${onBehalfOf
                    .replace(/^"(.*)"$/, "$1")
                    .replace(/"/g, '\\"')} via ${this.config.mail.sender}" ${isGitGitGadget[1]}`;
            } else if (authorMatch[2] === thisAuthor) {
                return;
            }

            header = authorMatch[1] + replaceSender + authorMatch[3];
            if (mails.length > 1 && i === 0 && senderName) {
                // skip Cc:ing and From:ing in the cover letter
                mails[i] = header + match[2];
                return;
            }

            const ccMatch = header.match(/^([^]*\nCc: [^]*?)(|\n(?![ \t])[^]*)$/);
            if (ccMatch) {
                header = ccMatch[1] + ",\n    " + authorMatch[2] + ccMatch[2];
            } else {
                header += "\nCc: " + authorMatch[2];
            }

            mails[i] = header + "\n\nFrom: " + authorMatch[2] + match[2];
        });
    }

    protected static adjustCoverLetter(coverLetter: string): string {
        const regex = new RegExp(
            "^([^]*?\\nSubject: .* )" +
                "\\*\\*\\* SUBJECT HERE \\*\\*\\*" +
                "(?=\\n)([^]*?\\n\\n)" +
                "\\*\\*\\* BLURB HERE \\*\\*\\*\\n\\n" +
                "([^]*?)\\n\\n([^]*)$",
        );
        const match = coverLetter.match(regex);
        if (!match) {
            throw new Error("Could not parse cover letter:\n\n" + coverLetter);
        }

        const subject = match[3].split(/\n(?=.)/).join("\n ");
        return match[1] + subject + match[2] + match[4];
    }

    protected static generateTagMessage(
        mail: string,
        isCoverLetter: boolean,
        midUrlPrefix: string,
        inReplyTo: string[] | undefined,
    ): string {
        const regex = isCoverLetter
            ? /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*-- \n/
            : /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*---\n/;
        const match = mail.match(regex);
        if (!match) {
            throw new Error(`Could not generate tag message from mail:\n\n${mail}`);
        }

        const messageID = mail.match(/\nMessage-ID: <(.*?)>\n/i);
        let footer: string = messageID ? `Submitted-As: ${midUrlPrefix}${messageID[1]}` : "";
        if (inReplyTo) {
            inReplyTo.map((id: string) => {
                footer += "\nIn-Reply-To: " + midUrlPrefix + id;
            });
        }

        // Subjects can contain continuation lines; simply strip out the new
        // line and keep only the space
        return match[2].replace(/\n */g, " ") + `\n\n${match[3]}${footer ? `\n\n${footer}` : ""}`;
    }

    protected static insertLinks(tagMessage: string, url: string, tagName: string, basedOn?: string): string {
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

        let insert = `Published-As: ${url}/releases/tag/${tagName}\nFetch-It-Via: git fetch ${url} ${tagName}\n`;

        if (basedOn) {
            insert = `Based-On: ${basedOn} at ${url}\nFetch-Base-Via: git fetch ${url} ${basedOn}\n${insert}`;
        }

        if (!tagMessage.match(/\n[-A-Za-z]+: [^\n]*\n$/)) {
            insert = "\n" + insert;
        }
        return tagMessage + insert;
    }

    protected static insertFooters(mail: string, isCoverLetter: boolean, footers: string[]): string {
        const regex = isCoverLetter ? /^([^]*?\n)(-- \n[^]*)$/ : /^([^]*?\n---\n(?:\n[A-Za-z:]+ [^]*?\n\n)?)([^]*)$/;
        const match = mail.match(regex);
        if (!match) {
            throw new Error("Failed to find range-diff insertion point for\n\n" + mail);
        }

        const n = isCoverLetter ? "" : "\n";
        return `${match[1]}${n}${footers.join("\n")}\n${n}${match[2]}`;
    }

    protected static adjustDateHeaders(mails: string[], forceDate: Date): number {
        let count = 0;

        const time = forceDate.getTime();
        for (let i = 0, j = mails.length - 1; i < mails.length; i++, j--) {
            const mail = mails[i];

            /* Look for the date header */
            let dateOffset: number;
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
            mails[i] =
                mail.substring(0, dateOffset) +
                new Date(time - j * 1000).toUTCString().replace(/GMT$/, "+0000") +
                mail.substring(endOfLine);
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

    public readonly config: IConfig;
    public readonly notes: GitNotes;
    public readonly options: PatchSeriesOptions;
    public readonly project: ProjectOptions;
    public readonly metadata: IPatchSeriesMetadata;
    public readonly rangeDiff: IRangeDiff | undefined;
    public readonly coverLetter?: string;
    public readonly senderName?: string;
    public readonly patchCount: number;

    protected constructor(
        config: IConfig,
        notes: GitNotes,
        options: PatchSeriesOptions,
        project: ProjectOptions,
        metadata: IPatchSeriesMetadata,
        rangeDiff: IRangeDiff | undefined,
        patchCount: number,
        coverLetter?: string,
        senderName?: string,
    ) {
        this.config = config;
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
        return `${this.options.noUpdate ? "PREVIEW" : "PATCH"}${
            this.options.rfc ? "/RFC" : ""
        }${this.metadata.iteration > 1 ? ` v${this.metadata.iteration}` : ""}`;
    }

    public async generateAndSend(
        logger: ILogger,
        send?: SendFunction,
        publishTagsAndNotesToRemote?: string,
        pullRequestURL?: string,
        forceDate?: Date,
        publishToken?: string,
    ): Promise<IPatchSeriesMetadata | undefined> {
        let globalOptions: IGitGitGadgetOptions | undefined;
        if (this.options.dryRun) {
            logger.log(`Dry-run ${this.project.branchName} v${this.metadata.iteration}`);
        } else {
            logger.log(`Submitting ${this.project.branchName} v${this.metadata.iteration}`);
            globalOptions = await this.notes.get<IGitGitGadgetOptions>("");
        }

        logger.log("Generating mbox");
        const mbox = await this.generateMBox();
        const mails: string[] = PatchSeries.splitMails(mbox);
        PatchSeries.cleanUpHeaders(mails);

        const ident = await git(["var", "GIT_AUTHOR_IDENT"], {
            workDir: this.project.workDir,
        });
        const match = ident.match(/.*>/);
        const thisAuthor = match && match[0];
        if (!thisAuthor) {
            throw new Error("Could not determine author ident from " + ident);
        }

        logger.log("Adding Cc: and explicit From: lines for other authors, if needed");
        this.insertCcAndFromLines(mails, thisAuthor, this.senderName);
        if (mails.length > 1) {
            if (this.coverLetter) {
                const match2 = mails[0].match(/^([^]*?\n\*\*\* BLURB HERE \*\*\*\n\n)([^]*)/);
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
            const mid = coverMid;

            const tsMatch = coverMid.match(/cover\.([0-9]+)\./);
            const timeStamp = tsMatch ? tsMatch[1] : `${Date.now()}`;
            const emailMatch = thisAuthor.match(/<(.*)>/);
            if (!emailMatch) {
                throw new Error(`Could not parse email of '${thisAuthor}`);
            }
            const email = emailMatch[1];

            const prMatch = this.metadata.pullRequestURL.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
            if (prMatch) {
                const infix = this.metadata.iteration > 1 ? `.v${this.metadata.iteration}` : "";
                const repoInfix = prMatch[1] === this.config.repo.owner ? prMatch[2] : `${prMatch[1]}.${prMatch[2]}`;
                const newCoverMid = `pull.${prMatch[3]}${infix}.${repoInfix}.${timeStamp}.${email}`;
                mails.map((value: string, index: number): void => {
                    // cheap replace-all
                    mails[index] = value.split(mid).join(newCoverMid);
                });
                coverMid = newCoverMid;
            }
        }
        this.metadata.coverLetterMessageId = coverMid;

        logger.log("Generating tag message");
        let tagMessage = PatchSeries.generateTagMessage(
            mails[0],
            mails.length > 1,
            this.project.midUrlPrefix,
            this.metadata.referencesMessageIds,
        );
        let tagName: string | undefined;
        if (!this.metadata.pullRequestURL) {
            tagName = `${this.project.branchName}-v${this.metadata.iteration}`;
        } else {
            const prKey = getPullRequestKeyFromURL(this.metadata.pullRequestURL);
            const branch = this.metadata.headLabel.replace(/:/g, "/");
            const tagPrefix = prKey.owner === this.config.repo.owner ? "pr-" : `pr-${prKey.owner}-`;
            tagName = `${tagPrefix}${prKey.pull_number}/${branch}-v${this.metadata.iteration}`;
        }

        this.metadata.latestTag = tagName;

        if (this.project.publishToRemote) {
            const url = await gitConfig(`remote.${this.project.publishToRemote}.url`, this.project.workDir);
            if (!url) {
                throw new Error(`remote ${this.project.publishToRemote} lacks URL`);
            }

            logger.log("Inserting links");
            tagMessage = PatchSeries.insertLinks(tagMessage, url, tagName, this.project.basedOn);
        }

        if (this.options.noUpdate) {
            logger.log(
                `Would generate tag ${tagName} with message:\n\n ${tagMessage
                    .split("\n")
                    .map((line: string) => {
                        return "    " + line;
                    })
                    .join("\n")}`,
            );
        } else {
            logger.log("Generating tag object");
            await this.generateTagObject(tagName, tagMessage);
        }

        const footers: string[] = [];

        if (pullRequestURL) {
            const prefix = `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`;
            const tagName2 = encodeURIComponent(tagName);
            footers.push(`Published-As: ${prefix}/releases/tag/${tagName2}`);
            footers.push(`Fetch-It-Via: git fetch ${prefix} ${tagName}`);
            footers.push(`Pull-Request: ${pullRequestURL}`);
        }

        if (this.rangeDiff) {
            if (footers.length > 0) {
                footers.push(""); // empty line
            }

            if (this.options.rangeDiff && this.options.rangeDiff.toLowerCase() === "false") {
                const getRange = (range: string): string => {
                    const hashes = range.match(/([a-z,0-9]+?)(\.+)([a-z,0-9]+)/);
                    if (hashes) {
                        return `${gitShortHash(hashes[1])}${hashes[2]}${gitShortHash(hashes[3])}`;
                    } else {
                        throw Error(`Range parse failed for ${range}`);
                    }
                };

                footers.push(`Contributor requested no range-diff. You can review it using these commands:
   git fetch https://github.com/gitgitgadget/git ${gitShortHash(this.rangeDiff.baseCommit)} ${gitShortHash(
       this.rangeDiff.headCommit,
   )}
   git range-diff <options> ${getRange(this.rangeDiff.previousRange)} ${getRange(this.rangeDiff.currentRange)}`);
            } else {
                const rangeDiff = await git(
                    [
                        "range-diff",
                        "--no-color",
                        "--creation-factor=95",
                        this.rangeDiff.previousRange,
                        this.rangeDiff.currentRange,
                    ],
                    { workDir: this.project.workDir },
                );
                // split the range-diff and prefix with a space
                footers.push(
                    `Range-diff vs v${this.metadata.iteration - 1}:\n\n${rangeDiff.replace(/(^|\n(?!$))/g, "$1 ")}\n`,
                );
            }
        }

        logger.log("Inserting footers");
        if (footers.length > 0) {
            mails[0] = PatchSeries.insertFooters(mails[0], mails.length > 1, footers);
        }

        /*
         * Finally, *after* inserting the range-diff and the footers (if any),
         * insert the cover letter into single-patch submissions.
         */
        if (mails.length === 1 && this.coverLetter) {
            if (this.patchCount !== 1) {
                throw new Error(`Patch count mismatch: ${mails.length} vs ${this.patchCount}`);
            }
            // Need to insert it into the first mail
            const splitAtTripleDash = mails[0].match(/([^]*?\n---\n)([^]*)$/);
            if (!splitAtTripleDash) {
                throw new Error(`No \`---\` found in\n${mails[0]}`);
            }
            console.log(`Insert cover letter into\n${mails[0]}\nwith match:`);
            console.log(splitAtTripleDash);
            mails[0] = splitAtTripleDash[1] + this.coverLetter + "\n" + splitAtTripleDash[2];
            console.log(mails[0]);
        }

        logger.log("Adjusting Date headers");
        if (forceDate) {
            PatchSeries.adjustDateHeaders(mails, forceDate);
        }

        if (this.options.dryRun) {
            logger.log(
                `Would send this mbox:\n\n${mbox
                    .split("\n")
                    .map((line) => {
                        return "    " + line;
                    })
                    .join("\n")}`,
            );
        } else if (send) {
            for (const mail of mails) {
                await send(mail);
            }
        } else {
            logger.log("Calling the `send-mbox` alias");
            await this.sendMBox(mails.join("\n"));
        }

        if (this.options.noUpdate) return this.metadata;

        logger.log("Updating the mail metadata");
        let isCoverLetter: boolean = mails.length > 1;
        for (const mail of mails) {
            const messageID = mail.match(/\nMessage-ID: <(.*?)>\n/i);
            if (messageID) {
                let originalCommit: string | undefined;
                let firstPatchLine: number | undefined;
                if (isCoverLetter) {
                    isCoverLetter = false;
                } else {
                    const commitMatch = mail.match(/^From ([0-9a-f]{40}) /);
                    if (commitMatch) {
                        originalCommit = commitMatch[1];
                    }
                    const revLine = mail.match(/\n@@ -(\d+),/);
                    if (revLine) {
                        firstPatchLine = parseInt(revLine[1], 10);
                    }
                }

                const mid = messageID[1];
                const mailMeta = {
                    messageID: mid,
                    originalCommit,
                    pullRequestURL: this.metadata.pullRequestURL,
                    firstPatchLine,
                } as IMailMetadata;
                await this.notes.set(mid, mailMeta, true);
                if (globalOptions && originalCommit && this.metadata.pullRequestURL) {
                    if (!globalOptions.activeMessageIDs) {
                        globalOptions.activeMessageIDs = {};
                    }
                    globalOptions.activeMessageIDs[mid] = originalCommit;
                }

                if (originalCommit && (await commitExists(originalCommit, this.project.workDir))) {
                    await this.notes.appendCommitNote(originalCommit, mid);
                }
            }
        }

        if (globalOptions && this.metadata.pullRequestURL) {
            if (!globalOptions.openPRs) {
                globalOptions.openPRs = {};
            }
            globalOptions.openPRs[this.metadata.pullRequestURL] = coverMid || "";
            await this.notes.set("", globalOptions, true);
        }

        if (!this.options.dryRun) {
            const key = this.metadata.pullRequestURL || this.project.branchName;
            await this.notes.set(key, this.metadata, true);
        }

        if (publishTagsAndNotesToRemote) {
            if (this.options.dryRun) {
                logger.log("Would publish tag");
            } else {
                const auth = [];
                if (publishToken) {
                    auth.push(
                        "-c",
                        [
                            `http.extraheader=Authorization:`,
                            `Basic`,
                            Buffer.from(`x-access-token:${publishToken}`).toString("base64"),
                        ].join(" "),
                    );
                }

                logger.log("Publishing tag");
                await git([...auth, "push", publishTagsAndNotesToRemote, `refs/tags/${tagName}`], {
                    workDir: this.notes.workDir,
                });
            }
        }

        return this.metadata;
    }

    protected async generateMBox(): Promise<string> {
        const mergeBase = await git(["merge-base", this.project.baseCommit, this.project.branchName], {
            workDir: this.project.workDir,
        });
        const args = [
            "format-patch",
            "--thread",
            "--stdout",
            `--signature=${this.config.repo.owner}`,
            "--add-header=Fcc: Sent",
            "--base",
            mergeBase,
            this.project.to,
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
        if (this.patchCount > 1) {
            if (!this.coverLetter) {
                throw new Error(`Branch ${this.project.branchName} needs a description`);
            }
            args.push("--cover-letter");
        }
        if (this.options.patience) {
            args.push("--patience");
        }

        args.push(`${this.project.baseCommit}..${this.project.branchName}`);

        return await git(args, { workDir: this.project.workDir });
    }

    protected async generateTagObject(tagName: string, tagMessage: string): Promise<void> {
        const args = ["tag", "-F", "-", "-a"];
        if (this.options.redo) {
            args.push("-f");
        }
        args.push(tagName);
        args.push(this.metadata.headCommit);
        await git(args, { stdin: tagMessage, workDir: this.project.workDir });
    }

    protected async sendMBox(mbox: string): Promise<void> {
        await git(["send-mbox"], { stdin: mbox, workDir: this.project.workDir });
    }
}
