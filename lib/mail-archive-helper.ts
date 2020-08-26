import { createHash } from "crypto";
import * as libqp from "libqp";
import { git, revParse } from "./git";
import { GitNotes } from "./git-notes";
import { GitHubGlue } from "./github-glue";
import { IMailMetadata } from "./mail-metadata";
import { IParsedMBox, parseMBox,
    parseMBoxMessageIDAndReferences } from "./send-mail";

const stateKey = "git@vger.kernel.org <-> GitGitGadget";
const replyToThisURL =
    "https://github.com/gitgitgadget/gitgitgadget/wiki/ReplyToThis";

export interface IGitMailingListMirrorState {
    latestRevision?: string;
}

export class MailArchiveGitHelper {
    public static async get(gggNotes: GitNotes, mailArchiveGitDir: string,
                            githubGlue: GitHubGlue):
        Promise<MailArchiveGitHelper> {
        const state: IGitMailingListMirrorState =
            await gggNotes.get<IGitMailingListMirrorState>(stateKey) || {};
        return new MailArchiveGitHelper(gggNotes, mailArchiveGitDir, githubGlue,
                                        state);
    }

    /**
     * Returns the object name Git would generate if the key (plus a trailing
     * newline) were fed to `git hash-object`.
     *
     * @param key the content to hash (a newline is automatically appended)
     * @returns the object name
     */
    public static hashKey(key: string): string {
        const hash = createHash("sha1", { encoding: "utf8" });
        hash.update(`blob ${Buffer.byteLength(key) + 1}`);
        hash.update(`\0${key}\n`);
        return hash.digest("hex");
    }

    public static mbox2markdown(mbox: IParsedMBox): string {
        let body = mbox.body;

        for (const header of mbox.headers!) {
            if (header.key === "Content-Transfer-Encoding") {
                const value = header.value.toLowerCase();
                if (value === "base64") {
                    body = Buffer.from(body, "base64").toString();
                } else if (value === "quoted-printable") {
                    const buffer = libqp.decode(body);
                    body = buffer.toString("utf-8");
                }
            }
        }

        if (!body.length) {
            return "";
        }

        const wrap = "``````````\n";
        return `${wrap}${body}${body.endsWith("\n") ? "" : "\n"}${wrap}`;
    }

    protected readonly state: IGitMailingListMirrorState;
    protected readonly gggNotes: GitNotes;
    protected readonly mailArchiveGitDir: string;
    protected readonly githubGlue: GitHubGlue;

    protected constructor(gggNotes: GitNotes, mailArchiveGitDir: string,
                          githubGlue: GitHubGlue,
                          state: IGitMailingListMirrorState) {
        this.gggNotes = gggNotes;
        this.mailArchiveGitDir = mailArchiveGitDir;
        this.githubGlue = githubGlue;
        this.state = state;
    }

    public async processMails(prFilter?: (pullRequestURL: string) => boolean):
        Promise<boolean> {
        const keys: Set<string> = new Set<string>();
        (await git(["ls-tree", "-r", `${this.gggNotes.notesRef}:`],
                   { workDir: this.gggNotes.workDir })).split("\n")
                .map((line: string) => {
                    keys.add(line.substr(53).replace(/\//g, ""));
                });
        const seen = (messageID: string): boolean => {
            return keys.has(MailArchiveGitHelper.hashKey(messageID));
        };

        const mboxHandler = async (mbox: string): Promise<void> => {
                const parsedMbox = await parseMBox(mbox, true);
                if (!parsedMbox.headers) {
                    throw new Error(`Could not parse ${mbox}`);
                }
                const parsed =
                    await parseMBoxMessageIDAndReferences(parsedMbox);
                if (seen(parsed.messageID)) {
                    console.log(`Already handled: ${parsed.messageID}`);
                    return;
                }
                let pullRequestURL: string | undefined;
                let originalCommit: string | undefined;
                let issueCommentId: number | undefined;
                for (const reference of parsed.references.filter(seen)) {
                    const data =
                        await this.gggNotes.get<IMailMetadata>(reference);
                    if (data && data.pullRequestURL) {
                        if (prFilter && !prFilter(data.pullRequestURL)) {
                            continue;
                        }
                        /* Cover letters were recorded with their tip commits */
                        const commit = reference.match(/^pull/) ?
                            undefined : data.originalCommit;
                        if (!pullRequestURL ||
                            (!originalCommit && commit) ||
                            (!issueCommentId && data.issueCommentId)) {
                            pullRequestURL = data.pullRequestURL;
                            issueCommentId = data.issueCommentId;
                            originalCommit = commit;
                        }
                    }
                }
                if (!pullRequestURL) {
                    return;
                }
                console.log(`Message-ID ${parsed.messageID
                            } (length ${mbox.length
                            }) for PR ${pullRequestURL
                            }, commit ${originalCommit
                            }, comment ID: ${issueCommentId}`);

                const archiveURL = `https://lore.kernel.org/git/${
                    parsed.messageID}`;
                const header = `[On the Git mailing list](${archiveURL}), ` +
                    (parsedMbox.from ?
                     parsedMbox.from.replace(/ *<.*>/, "") : "Somebody") +
                     ` wrote ([reply to this](${replyToThisURL})):\n\n`;
                const comment = header +
                    MailArchiveGitHelper.mbox2markdown(parsedMbox);

                if (issueCommentId) {
                    await this.githubGlue.addPRCommentReply(pullRequestURL,
                                                            issueCommentId,
                                                            comment);
                } else if (originalCommit) {
                    const result = await this.githubGlue
                        .addPRCommitComment(pullRequestURL, originalCommit,
                                            this.gggNotes.workDir, comment);
                    issueCommentId = result.id;
                } else {
                    /*
                     * We will not use the ID of this comment, as it is an
                     * issue comment, really, not a Pull Request comment.
                     */
                    await this.githubGlue
                        .addPRComment(pullRequestURL, comment);
                }

                await this.githubGlue.addPRCc(pullRequestURL,
                                              parsedMbox.from || "");

                await this.gggNotes.set(parsed.messageID, {
                    issueCommentId,
                    messageID: parsed.messageID,
                    originalCommit,
                    pullRequestURL,
                } as IMailMetadata);

                /* It is now known */
                keys.add(MailArchiveGitHelper.hashKey(parsed.messageID));
            };

        let buffer = "";
        let counter = 0;
        const lineHandler = async (line: string): Promise<void> => {
            if (line.startsWith("@@ ")) {
                const match = line.match(/^@@ -(\d+,)?\d+ \+(\d+,)?(\d+)?/);
                if (match) {
                    if (counter) {
                        console.log(`Oops: unprocessed buffer ${buffer}`);
                    }
                    counter = parseInt(match[3], 10);
                    buffer = "";
                }
            } else if (counter && line.match(/^[ +]/)) {
                buffer += line.substr(1) + "\n";
                if (--counter) {
                    return;
                }
                try {
                    await mboxHandler(buffer);
                } catch (reason) {
                    console.log(`${reason}: skipping`);
                }
            }
        };

        if (!this.state.latestRevision) {
            /*
             * This is the commit in lore.kernel/git that is *just* before the
             * first ever GitGitGadget mail sent to the Git mailing list.
             */
            this.state.latestRevision =
                "3b38d8d206c64bf3dc873ba8ae9dbd48ed43f612";
        } else if (this.state.latestRevision ===
            "205655703b0501ef14e0f0dddf8e57bb726fae97") {
            this.state.latestRevision =
                "26674e9a36ae1871f69197798d30f6d3d2af7a56";
        } else if (await revParse(this.state.latestRevision,
                                  this.mailArchiveGitDir) === undefined) {
            const publicInboxGitDir = process.env.PUBLIC_INBOX_DIR;
            if (publicInboxGitDir === undefined) {
                throw new Error(`Commit ${this.state.latestRevision
                                } not found; need PUBLIC_INBOX_DIR`);
            }
            let commitDiff =
                await git(["show", this.state.latestRevision, "--"],
                          { workDir: publicInboxGitDir });
            if (!commitDiff) {
                throw new Error(`Could not find ${this.state.latestRevision
                                } in ${publicInboxGitDir}`);
            }
            const match = commitDiff.match(/\n\+(Message-ID: [^\n]*)/);
            if (!match) {
                throw new Error(`Could not find Message-ID in ${commitDiff}`);
            }
            let commit = "HEAD";
            for (;;) {
                commit = await git(["log", "-1", "--format=%H", `-S${match[1]}`,
                                    commit, "--"],
                                   { workDir: this.mailArchiveGitDir});
                if (!commit) {
                    throw new Error(`Could not find ${this.state.latestRevision
                                }'s equivalent in ${this.mailArchiveGitDir}`);
                }
                commitDiff = await git(["show", commit, "--"],
                                       {workDir: this.mailArchiveGitDir});
                if (commitDiff.indexOf(`\n+${match[1]}\n`) >= 0) {
                    break;
                }
                commit += "^"; /* continue search with the parent commit */
            }
            this.state.latestRevision = commit;
        }

        const head = await revParse("master", this.mailArchiveGitDir);
        if (this.state.latestRevision === head) {
            return false;
        }

        const range = `${this.state.latestRevision}..${head}`;
        console.log(`Handling commit range ${range}`);
        await git(["log", "-p", "-U99999", "--reverse", range],
                  { lineHandler, workDir: this.mailArchiveGitDir });

        this.state.latestRevision = head;
        await this.gggNotes.set(stateKey, this.state, true);

        return true;
    }
}
