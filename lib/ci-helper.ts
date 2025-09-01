import * as core from "@actions/core";
import * as fs from "fs";
import * as os from "os";
import * as util from "util";
import { spawnSync } from "child_process";
import addressparser from "nodemailer/lib/addressparser/index.js";
import path from "path";
import { ILintError, LintCommit } from "./commit-lint.js";
import { commitExists, git, emptyTreeName, revParse } from "./git.js";
import { GitNotes } from "./git-notes.js";
import { GitGitGadget, IGitGitGadgetOptions } from "./gitgitgadget.js";
import { getConfig } from "./gitgitgadget-config.js";
import { GitHubGlue, IGitHubUser, IPRComment, IPRCommit, IPullRequestInfo, RequestError } from "./github-glue.js";
import { toPrettyJSON } from "./json-util.js";
import { MailArchiveGitHelper } from "./mail-archive-helper.js";
import { MailCommitMapping } from "./mail-commit-mapping.js";
import { IMailMetadata } from "./mail-metadata.js";
import { IPatchSeriesMetadata } from "./patch-series-metadata.js";
import { IConfig, getExternalConfig, setConfig } from "./project-config.js";
import { getPullRequestKeyFromURL, pullRequestKey } from "./pullRequestKey.js";
import { ISMTPOptions } from "./send-mail.js";
import { fileURLToPath } from "url";

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
    public readonly config: IConfig;
    public readonly workDir: string;
    public readonly notes: GitNotes;
    public readonly urlBase: string;
    public readonly urlRepo: string;
    protected readonly mail2commit: MailCommitMapping;
    protected readonly github: GitHubGlue;
    protected readonly gggConfigDir: string;
    protected commit2mailNotes: GitNotes | undefined;
    protected testing: boolean;
    private gggNotesUpdated: boolean;
    private mail2CommitMapUpdated: boolean;
    private notesPushToken: string | undefined;
    private smtpOptions?: ISMTPOptions;
    protected maxCommitsExceptions: string[];
    protected mailingListMirror: string | undefined;

    public static async getConfig(configFile?: string): Promise<IConfig> {
        return configFile ? await getExternalConfig(configFile) : getConfig();
    }

    public constructor(workDir: string = "git.git", config?: IConfig, skipUpdate?: boolean, gggConfigDir = ".") {
        this.config = config !== undefined ? setConfig(config) : getConfig();
        this.gggConfigDir = gggConfigDir;
        this.workDir = workDir;
        this.notes = new GitNotes(workDir);
        this.gggNotesUpdated = !!skipUpdate;
        this.mail2commit = new MailCommitMapping(this.notes.workDir);
        this.mail2CommitMapUpdated = !!skipUpdate;
        this.github = new GitHubGlue(workDir, this.config.repo.owner, this.config.repo.name);
        this.testing = false;
        this.maxCommitsExceptions = this.config.lint?.maxCommitsIgnore || [];
        this.urlBase = `https://github.com/${this.config.repo.owner}/`;
        this.urlRepo = `${this.urlBase}${this.config.repo.name}/`;
    }

    public async setupGitHubAction(setupOptions?: {
        needsMailingListMirror?: boolean;
        needsUpstreamBranches?: boolean;
        needsMailToCommitNotes?: boolean;
    }): Promise<void> {
        // help dugite realize where `git` is...
        const gitExecutable = os.type() === "Windows_NT" ? "git.exe" : "git";
        const stripSuffix = `bin${path.sep}${gitExecutable}`;
        for (const gitPath of (process.env.PATH || "/")
            .split(path.delimiter)
            .map((p) => path.normalize(`${p}${path.sep}${gitExecutable}`))
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            .filter((p) => p.endsWith(`${path.sep}${stripSuffix}`) && fs.existsSync(p))) {
            process.env.LOCAL_GIT_DIRECTORY = gitPath.substring(0, gitPath.length - stripSuffix.length);
            // need to override GIT_EXEC_PATH, so that Dugite can find the `git-remote-https` executable,
            // see https://github.com/desktop/dugite/blob/v2.7.1/lib/git-environment.ts#L44-L64
            // Also: We cannot use `await git(["--exec-path"]);` because that would use Dugite, which would
            // override `GIT_EXEC_PATH` and then `git --exec-path` would report _that_...
            process.env.GIT_EXEC_PATH = spawnSync(gitPath, ["--exec-path"]).stdout.toString("utf-8").trimEnd();
            break;
        }

        // configure the Git committer information
        process.env.GIT_CONFIG_PARAMETERS = [
            process.env.GIT_CONFIG_PARAMETERS,
            "'user.name=GitGitGadget'",
            "'user.email=gitgitgadget@gmail.com'",
        ]
            .filter((e) => e)
            .join(" ");

        // get the access tokens via the inputs of the GitHub Action
        this.setAccessToken(this.config.repo.owner, core.getInput("pr-repo-token"));
        this.setAccessToken(this.config.repo.baseOwner, core.getInput("upstream-repo-token"));
        if (this.config.repo.testOwner) {
            this.setAccessToken(this.config.repo.testOwner, core.getInput("test-repo-token"));
        }

        // set the SMTP options
        try {
            const options = {
                smtpUser: core.getInput("smtp-user"),
                smtpHost: core.getInput("smtp-host"),
                smtpPass: core.getInput("smtp-pass"),
                smtpOpts: core.getInput("smtp-opts"),
            };
            if (options.smtpUser && options.smtpHost && options.smtpPass) {
                this.setSMTPOptions(options);
            }
        } catch (e) {
            // Ignore, for now
        }

        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (!fs.existsSync(this.workDir)) await git(["init", "--bare", "--initial-branch", "unused", this.workDir]);
        for (const [key, value] of [
            ["gc.auto", "0"],
            ["remote.origin.url", `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`],
            ["remote.origin.promisor", "true"],
            ["remote.origin.partialCloneFilter", "blob:none"],
            ["remote.upstream.url", `https://github.com/${this.config.repo.baseOwner}/${this.config.repo.name}`],
            ["remote.upstream.promisor", "true"],
            ["remote.upstream.partialCloneFilter", "blob:none"],
        ]) {
            await git(["config", key, value], { workDir: this.workDir });
        }
        console.time("fetch Git notes");
        const notesRefs = [GitNotes.defaultNotesRef];
        if (setupOptions?.needsMailToCommitNotes) {
            notesRefs.push("refs/notes/mail-to-commit", "refs/notes/commit-to-mail");
        }
        await git(
            [
                "fetch",
                "--filter=blob:limit=1g", // let's fetch the notes with all of their blobs
                "--no-tags",
                "origin",
                "--depth=1",
                ...notesRefs.map((ref) => `+${ref}:${ref}`),
            ],
            {
                workDir: this.workDir,
            },
        );
        console.timeEnd("fetch Git notes");
        this.gggNotesUpdated = true;
        if (setupOptions?.needsUpstreamBranches) {
            console.time("fetch upstream branches");
            await git(
                [
                    "fetch",
                    "origin",
                    "--no-tags",
                    "--depth=500",
                    "--filter=blob:limit=1g",
                    ...this.config.repo.trackingBranches.map(
                        (name) => `+refs/heads/${name}:refs/remotes/upstream/${name}`,
                    ),
                ],
                {
                    workDir: this.workDir,
                },
            );
            console.timeEnd("fetch upstream branches");
            console.time("get open PR head commits");
            const openPRCommits = (
                await Promise.all(
                    this.config.repo.owners.map(async (repositoryOwner) => {
                        return await this.github.getOpenPRs(repositoryOwner);
                    }),
                )
            )
                .flat()
                .map((pr) => pr.headCommit);
            console.timeEnd("get open PR head commits");
            console.time("fetch open PR head commits");
            await git(["fetch", "--no-tags", "origin", "--filter=blob:limit=1g", ...openPRCommits], {
                workDir: this.workDir,
            });
            console.timeEnd("fetch open PR head commits");
        }
        // "Unshallow" the refs by fetching the shallow commits with a tree-less filter.
        // This is needed because Git will otherwise fall over left and right when trying
        // to determine merge bases with really old branches.
        const unshallow = async (workDir: string) => {
            console.time(`Making ${workDir} non-shallow`);
            console.log(await git(["fetch", "--filter=tree:0", "origin", "--unshallow"], { workDir }));
            console.timeEnd(`Making ${workDir} non-shallow`);
        };
        await unshallow(this.workDir);

        if (setupOptions?.needsMailingListMirror) {
            this.mailingListMirror = "mailing-list-mirror.git";
            const epoch = this.config.mailrepo.public_inbox_epoch ?? 1;

            // eslint-disable-next-line security/detect-non-literal-fs-filename
            if (!fs.existsSync(this.mailingListMirror)) {
                await git(["init", "--bare", "--initial-branch", this.config.mailrepo.branch, this.mailingListMirror]);
            }

            // First fetch from GitGitGadget's mirror, which supports partial clones
            for (const [key, value] of [
                ["remote.mirror.url", this.config.mailrepo.mirrorURL || this.config.mailrepo.url],
                ["remote.mirror.promisor", "true"],
                ["remote.mirror.partialCloneFilter", "blob:none"],
            ]) {
                await git(["config", key, value], { workDir: this.mailingListMirror });
            }
            console.time("fetch mailing list mirror");
            await git(
                [
                    "-c",
                    "remote.mirror.promisor=false", // let's fetch the mails with all of their contents
                    "fetch",
                    "mirror",
                    `--depth=${setupOptions?.needsMailToCommitNotes ? 5000 : 50}`,
                    "+REF:REF".replace("REF", this.config.mailrepo.mirrorRef || `refs/heads/lore-${epoch}`),
                ],
                {
                    workDir: this.mailingListMirror,
                },
            );
            console.timeEnd("fetch mailing list mirror");

            // Now update the head branch from the authoritative repository
            console.time(`update from ${this.config.mailrepo.url}`);
            await git(["config", "remote.origin.url", `${this.config.mailrepo.url.replace(/\/*$/, "")}/${epoch}`], {
                workDir: this.mailingListMirror,
            });
            await git(
                [
                    "fetch",
                    "origin",
                    `+refs/heads/${this.config.mailrepo.branch}:refs/heads/${this.config.mailrepo.branch}`,
                ],
                {
                    workDir: this.mailingListMirror,
                },
            );
            console.timeEnd(`update from ${this.config.mailrepo.url}`);
            await unshallow(this.mailingListMirror);
        }
    }

    public parsePRCommentURLInput(): { owner: string; repo: string; prNumber: number; commentId: number } {
        const prCommentUrl = core.getInput("pr-comment-url");
        const [, owner, repo, prNumber, commentId] =
            prCommentUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#issuecomment-(\d+)$/) || [];
        if (!this.config.repo.owners.includes(owner) || repo !== this.config.repo.name) {
            throw new Error(`Invalid PR comment URL: ${prCommentUrl}`);
        }
        return { owner, repo, prNumber: parseInt(prNumber, 10), commentId: parseInt(commentId, 10) };
    }

    public parsePRURLInput(): { owner: string; repo: string; prNumber: number } {
        const prCommentUrl = core.getInput("pr-url");

        const [, owner, repo, prNumber] =
            prCommentUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/) || [];
        if (!this.config.repo.owners.includes(owner) || repo !== this.config.repo.name) {
            throw new Error(`Invalid PR comment URL: ${prCommentUrl}`);
        }
        return { owner, repo, prNumber: parseInt(prNumber, 10) };
    }

    public setAccessToken(repositoryOwner: string, token: string): void {
        this.github.setAccessToken(repositoryOwner, token);
        if (this.config.repo.owner === repositoryOwner) {
            this.notesPushToken = token;
        }
    }

    public setSMTPOptions(smtpOptions: ISMTPOptions): void {
        this.smtpOptions = smtpOptions;
    }

    /*
     * Given a commit that was contributed as a patch via GitGitGadget (i.e.
     * a commit with a Message-ID recorded in `refs/notes/gitgitgadget`),
     * identify the commit (if any) in `git.git`.
     */
    public async identifyUpstreamCommit(originalCommit: string): Promise<string | undefined> {
        await this.maybeUpdateMail2CommitMap();
        const messageId = await this.getMessageIdForOriginalCommit(originalCommit);
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
    public async setUpstreamCommit(originalCommit: string, gitGitCommit: string): Promise<void> {
        await this.maybeUpdateMail2CommitMap();
        if (!this.commit2mailNotes) {
            this.commit2mailNotes = new GitNotes(this.mail2commit.workDir, "refs/notes/commit-to-mail");
            await this.commit2mailNotes.update(this.urlRepo);
        }
        const messageId = await this.getMessageIdForOriginalCommit(originalCommit);
        if (!messageId) {
            return undefined;
        }
        await this.mail2commit.mail2CommitNotes.setString(messageId, gitGitCommit, true);
        await this.commit2mailNotes.appendCommitNote(gitGitCommit, messageId);
    }

    /**
     * Update the `commit-to-mail` and `mail-to-commit` Git notes refs.
     */
    public async updateMailToCommitNotes(): Promise<void> {
        // We'll assume that the `commit-to-mail` and `mail-to-commit` notes refs are up to date
        const commit2MailTipCommit = await revParse("refs/notes/commit-to-mail", this.workDir);
        const dir = fileURLToPath(new URL(".", import.meta.url));
        const lookupCommitScriptPath = path.resolve(dir, "..", "script", "lookup-commit.sh");
        console.time("lookup-commit.sh");
        const lookupCommitResult = spawnSync("sh", ["-x", lookupCommitScriptPath, "--notes", "update"], {
            stdio: "inherit",
            env: {
                ...process.env,
                GITGIT_DIR: this.workDir,
                GITGIT_GIT_REMOTE: this.urlRepo,
                LORE_GIT_DIR: this.mailingListMirror,
                GITGIT_MAIL_REMOTE: this.config.mailrepo.url,
                GITGIT_MAIL_EPOCH: "1",
            },
        });
        console.timeEnd("lookup-commit.sh");
        if (lookupCommitResult.status !== 0) throw new Error("lookup-commit.sh failed");
        // If there were no updates, we are done
        if (commit2MailTipCommit === (await revParse("refs/notes/commit-to-mail", this.workDir))) return;

        const updateMailToCommitNotesScriptPath = path.resolve(dir, "..", "script", "update-mail-to-commit-notes.sh");
        console.time("update-mail-to-commit-notes.sh");
        const updateMailToCommitNotesResult = spawnSync("sh", ["-x", updateMailToCommitNotesScriptPath], {
            stdio: "inherit",
            env: {
                ...process.env,
                GITGIT_DIR: this.workDir,
                GITGIT_GIT_REMOTE: this.urlRepo,
            },
        });
        console.timeEnd("update-mail-to-commit-notes.sh");
        if (updateMailToCommitNotesResult.status !== 0) throw new Error("update-mail-to-commit-notes.sh failed");

        const mail2commitNotes = new GitNotes(this.workDir, "refs/notes/mail-to-commit");
        await mail2commitNotes.push(this.urlRepo, this.notesPushToken);
        const commit2MailNotes = new GitNotes(this.workDir, "refs/notes/commit-to-mail");
        await commit2MailNotes.push(this.urlRepo, this.notesPushToken);

        const commit2MailTipPatch = await git(["show", "refs/notes/commit-to-mail"], { workDir: this.workDir });
        // Any unhandled commit will get annotated with "no match"
        // To list all of them, the tip commit's diff is parsed and the commit hash is
        // extracted from the "filename" on the `+++ b/` line.
        const noMatch = commit2MailTipPatch
            .split("\ndiff --git ")
            .filter((d) => d.endsWith("+no match"))
            .map((d) => d.split("\n+++ b/")[1].split("\n")[0].replace("/", ""));
        if (noMatch.length) throw new Error(`Could not find mail(s) for: ${noMatch.join("\n")}`);
    }

    /**
     * Given a Message-Id, identify the upstream commit (if any), and if there
     * is one, and if it was not yet recorded in GitGitGadget's metadata, record
     * it and create a GitHub Commit Status.
     *
     * @returns `true` if the metadata had to be updated
     */
    public async updateCommitMapping(messageID: string, upstreamCommit?: string): Promise<boolean> {
        await this.maybeUpdateGGGNotes();
        const mailMeta: IMailMetadata | undefined = await this.notes.get<IMailMetadata>(messageID);
        if (!mailMeta) {
            throw new Error(`No metadata found for ${messageID}`);
        }
        if (upstreamCommit === undefined) {
            await this.maybeUpdateMail2CommitMap();
            upstreamCommit = await this.mail2commit.getGitGitCommitForMessageId(messageID);
        }
        if (!upstreamCommit || upstreamCommit === mailMeta.commitInGitGit) {
            return false;
        }
        mailMeta.commitInGitGit = upstreamCommit;
        if (!mailMeta.originalCommit) {
            const originalCommit = await this.getOriginalCommitForMessageId(messageID);
            if (!originalCommit) {
                throw new Error(`No original commit found for ${messageID}`);
            }
            mailMeta.originalCommit = originalCommit;
        }
        await this.notes.set(messageID, mailMeta, true);

        if (!this.testing && mailMeta.pullRequestURL && mailMeta.pullRequestURL.startsWith(this.urlBase)) {
            await this.github.annotateCommit(
                mailMeta.originalCommit,
                upstreamCommit,
                this.config.repo.owner,
                this.config.repo.baseOwner,
            );
        }

        return true;
    }

    public async updateCommitMappings(): Promise<boolean> {
        if (!this.gggNotesUpdated) {
            const args: string[] = [];

            args.push(
                ...this.config.repo.branches.map((branch) => `+refs/heads/${branch}:refs/remotes/upstream/${branch}`),
            );

            await git(["fetch", this.urlRepo, "--tags", "+refs/notes/gitgitgadget:refs/notes/gitgitgadget", ...args], {
                workDir: this.workDir,
            });
            this.gggNotesUpdated = true;
        }

        const options = await this.getGitGitGadgetOptions();
        if (!options.openPRs) {
            return false;
        }

        const commitsInSeen: Set<string> = new Set<string>(
            (
                await git(
                    ["rev-list", "--no-merges", "^refs/remotes/upstream/maint~100", "refs/remotes/upstream/seen"],
                    { workDir: this.workDir },
                )
            ).split("\n"),
        );
        let result = false;
        /*
         * Both `bases` and `heads` accumulate the `-p<commit-hash>` parameters
         * for the `git commit-tree` command for the two octopus merges. We
         * need to make sure that no parent is listed twice, as `git
         * commit-tree` would error out on that.
         */
        const bases = new Set<string>();
        const heads = new Set<string>();
        for (const pullRequestURL of Object.keys(options.openPRs)) {
            const info = await this.getPRMetadata(pullRequestURL);
            if (
                info === undefined ||
                info.latestTag === undefined ||
                info.baseCommit === undefined ||
                info.headCommit === undefined ||
                info.baseLabel === undefined ||
                info.baseLabel.match(/^gitgitgadget:git-gui\//)
            ) {
                continue;
            }
            const messageID = await this.getMessageIdForOriginalCommit(info.headCommit);
            if (!messageID) {
                continue;
            }
            const meta = await this.getMailMetadata(messageID);
            if (!meta) {
                continue;
            }
            if (meta.commitInGitGit !== undefined) {
                if (commitsInSeen.has(meta.commitInGitGit)) {
                    continue;
                }
                console.log(
                    `Upstream commit ${meta.commitInGitGit} for ${info.headCommit} of ${
                        info.pullRequestURL
                    } no longer found in 'seen'`,
                );
                meta.commitInGitGit = undefined;
                result = true;
            }
            bases.add(`-p${info.baseCommit}`);
            heads.add(`-p${info.headCommit}`);
        }

        if (heads.size > 0) {
            /*
             * Generate throw-away octopus merges to combine multiple commit
             * ranges into a single one.
             */
            const octopus = async (set: Set<string>): Promise<string> => {
                const array = Array.from(set);
                if (array.length === 1) {
                    return array[0];
                }
                return await git(["commit-tree", ...array, emptyTreeName, "-m", "()"], { workDir: this.workDir });
            };

            const range1 = `${await octopus(bases)}..${await octopus(heads)}`;
            const range2 = "refs/remotes/upstream/maint~100..refs/remotes/upstream/seen";
            const start = Date.now();
            const out = await git(["-c", "core.abbrev=40", "range-diff", "-s", range1, range2], {
                workDir: this.workDir,
            });
            const duration = Date.now() - start;
            if (duration > 2000)
                console.log(`warning: \`git range-diff ${range1} ${range2}\` took ${duration / 1000} seconds`);
            for (const line of out.split("\n")) {
                const match = line.match(/^[^:]*: *([^ ]*) [!=][^:]*: *([^ ]*)/);
                if (!match) {
                    continue;
                }
                const messageID2 = await this.getMessageIdForOriginalCommit(match[1]);
                if (messageID2 === undefined) {
                    continue;
                }
                if (await this.updateCommitMapping(messageID2, match[2])) {
                    result = true;
                }
            }
        }
        if (result) {
            await this.pushNotesRef();
        }
        return result;
    }

    /**
     * Process all open PRs.
     *
     * @returns true if `refs/notes/gitgitgadget` was updated
     */
    public async handleOpenPRs(): Promise<boolean> {
        const options = await this.getGitGitGadgetOptions();
        if (!options.openPRs) {
            return false;
        }
        let result = false;
        for (const pullRequestURL in options.openPRs) {
            if (!Object.prototype.hasOwnProperty.call(options.openPRs, pullRequestURL)) {
                continue;
            }
            console.log(`Handling ${pullRequestURL}`);
            const [notesUpdated, optionsUpdated] = await this.handlePR(pullRequestURL, options);
            if (notesUpdated || optionsUpdated) {
                result = true;
            }
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
    public async handlePR(pullRequestURL: string, options: IGitGitGadgetOptions): Promise<[boolean, boolean]> {
        await this.maybeUpdateGGGNotes();
        await this.maybeUpdateMail2CommitMap();

        const prMeta = await this.notes.get<IPatchSeriesMetadata>(pullRequestURL);
        if (!prMeta || !prMeta.coverLetterMessageId) {
            return [false, false];
        }

        const headMessageID = await this.getMessageIdForOriginalCommit(prMeta.headCommit);
        const headMeta = headMessageID && (await this.getMailMetadata(headMessageID));
        const tipCommitInGitGit = headMeta && headMeta.commitInGitGit;
        if (!tipCommitInGitGit) {
            return [false, false];
        }

        let notesUpdated = false;
        if (tipCommitInGitGit !== prMeta.tipCommitInGitGit) {
            prMeta.tipCommitInGitGit = tipCommitInGitGit;
            notesUpdated = true;
        }

        const prKey = getPullRequestKeyFromURL(pullRequestURL);

        // Identify branch in maintainer repo
        const maintainerBranch = `refs/remotes/${this.config.repo.maintainerBranch}/`;
        const maintainerRepo = `${this.config.repo.owner}/${this.config.repo.name}`;

        let gitsterBranch: string | undefined = await git(
            ["for-each-ref", `--points-at=${tipCommitInGitGit}`, "--format=%(refname)", maintainerBranch],
            { workDir: this.workDir },
        );
        if (gitsterBranch) {
            const newline = gitsterBranch.indexOf("\n");
            if (newline > 0) {
                const comment2 = `Found multiple candidates in ${maintainerRepo}:\n${
                    gitsterBranch
                };\n\nUsing the first one.`;
                const url2 = await this.github.addPRComment(prKey, comment2);
                console.log(`Added comment ${url2.id} about ${gitsterBranch}: ${url2.url}`);

                gitsterBranch = gitsterBranch.substring(0, newline);
            }
            gitsterBranch = gitsterBranch.substring(maintainerBranch.length);

            const comment = `This branch is now known as [\`${
                gitsterBranch
            }\`](https://github.com/${maintainerRepo}/commits/${gitsterBranch}).`;
            if (prMeta.branchNameInGitsterGit !== gitsterBranch) {
                prMeta.branchNameInGitsterGit = gitsterBranch;
                notesUpdated = true;

                const url = await this.github.addPRComment(prKey, comment);
                console.log(`Added comment ${url.id} about ${gitsterBranch}: ${url.url}`);
            }
        }

        let closePR: string | undefined;
        const prLabelsToAdd: string[] = [];
        for (const branch of this.config.repo.trackingBranches) {
            const mergeCommit = await this.identifyMergeCommit(branch, tipCommitInGitGit);
            if (!mergeCommit) {
                continue;
            }

            if (this.config.repo.closingBranches.includes(branch)) {
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
                const comment = `This patch series was integrated into ${branch} via https://github.com/${
                    this.config.repo.baseOwner
                }/${this.config.repo.name}/commit/${mergeCommit}.`;
                const url = await this.github.addPRComment(prKey, comment);
                console.log(`Added comment ${url.id} about ${branch}: ${url.url}`);
            }
        }

        if (prLabelsToAdd.length) {
            await this.github.addPRLabels(prKey, prLabelsToAdd);
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

            await this.github.closePR(prKey, closePR);
        }

        if (notesUpdated) {
            await this.notes.set(pullRequestURL, prMeta, true);
        }

        if (optionsUpdated) {
            await this.notes.set("", options, true);
        }

        if (notesUpdated || optionsUpdated) {
            await this.pushNotesRef();
        }

        return [notesUpdated, optionsUpdated];
    }

    public async getMessageIdForOriginalCommit(commit: string): Promise<string | undefined> {
        await this.maybeUpdateGGGNotes();
        return await this.notes.getLastCommitNote(commit);
    }

    public async getOriginalCommitForMessageId(messageID: string): Promise<string | undefined> {
        await this.maybeUpdateGGGNotes();
        const note = await this.notes.get<IMailMetadata>(messageID);
        return note ? note.originalCommit : undefined;
    }

    /*
     * Given a branch and a commit, identify the merge that integrated that
     * commit into that branch.
     */
    public async identifyMergeCommit(upstreamBranch: string, integratedCommit: string): Promise<string | undefined> {
        await this.maybeUpdateMail2CommitMap();

        const revs = await git(
            ["rev-list", "--ancestry-path", "--parents", `${integratedCommit}..upstream/${upstreamBranch}`],
            { workDir: this.workDir },
        );
        if (revs === "") {
            return undefined;
        }

        let commit = integratedCommit;

        // Was it integrated via a merge?
        let match = revs.match(`(^|\n)([^ ]+) ([^\n]+) ${commit}`);
        if (!match) {
            // Look for a descendant that *was* integrated via a merge
            for (;;) {
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

        for (;;) {
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

    public async getPRMetadata(pullRequestURL: string): Promise<IPatchSeriesMetadata | undefined> {
        await this.maybeUpdateGGGNotes();
        return this.notes.get<IPatchSeriesMetadata>(pullRequestURL);
    }

    public async getMailMetadata(messageID: string): Promise<IMailMetadata | undefined> {
        await this.maybeUpdateGGGNotes();
        return this.notes.get<IMailMetadata>(messageID);
    }

    public async getOriginalCommitsForPR(prMeta: IPatchSeriesMetadata): Promise<string[]> {
        if (!this.workDir) {
            throw new Error("Need a workDir");
        }
        if (!(await commitExists(prMeta.headCommit, this.workDir))) {
            if (!prMeta.pullRequestURL) {
                throw new Error(`Require URL in ${JSON.stringify(prMeta, null, 4)}`);
            }
            if (!prMeta.latestTag) {
                throw new Error("Cannot fetch commits without tag");
            }
            const prKey = getPullRequestKeyFromURL(prMeta.pullRequestURL);
            const fetchURL = `https://github.com/${prKey.owner}/${prKey.repo}`;
            const fetchRef = `refs/pull/${prKey.pull_number}/head`;
            await git(["fetch", "--no-tags", fetchURL, fetchRef, prMeta.latestTag], {
                workDir: this.workDir,
            });
        }
        const revs = await git(["rev-list", `${prMeta.baseCommit}..${prMeta.headCommit}`], { workDir: this.workDir });
        return revs.split(/\s+/);
    }

    protected warnOnMissingPublicEmail(username: string): string {
        return [
            `WARNING: ${username} has no public email address set on GitHub; `,
            "GitGitGadget needs an email address to Cc: you on your contribution, ",
            "so that you receive any feedback on the Git mailing list. ",
            "Go to https://github.com/settings/profile to make your preferred ",
            "email public to let GitGitGadget know which email address to use.",
        ].join("");
    }

    /**
     * Retrieves comments on PRs and handles `/submit` and friends.
     *
     * @param commentID the ID of the PR comment to handle
     */
    public async handleComment(repositoryOwner: string, commentID: number): Promise<void> {
        let comment: IPRComment;

        try {
            comment = await this.github.getPRComment(repositoryOwner, commentID);
        } catch (e) {
            if (e instanceof RequestError && e.status === 404) {
                console.log(`Comment ${commentID} not found; doing nothing:\n'${JSON.stringify(e, null, 2)}'`);
                return;
            } else {
                throw e;
            }
        }

        const match = comment.body.trim().match(/^(\/[-a-z]+)\s*(.*)$/);
        if (!match) {
            console.log(`Not a command; doing nothing: '${comment.body}'`);
            return; /* nothing to do */
        }
        const command = match[1];
        const argument = match[2].trim();
        const prKey = {
            owner: repositoryOwner,
            repo: this.config.repo.name,
            pull_number: comment.prNumber,
        };

        const pullRequestURL = `https://github.com/${repositoryOwner}/${
            this.config.repo.name
        }/pull/${comment.prNumber}`;
        console.log(
            `Handling command ${command} with argument ${argument} at ${pullRequestURL}#issuecomment-${commentID}`,
        );

        const addComment = async (body: string): Promise<void> => {
            const redacted = CIHelper.redactGitHubToken(body);
            console.log(`Adding comment to ${pullRequestURL}:\n${redacted}`);
            await this.github.addPRComment(prKey, redacted);
        };

        try {
            const gitGitGadget = await GitGitGadget.get(
                this.gggConfigDir,
                this.workDir,
                this.urlRepo,
                this.notesPushToken,
                this.smtpOptions,
            );
            if (!gitGitGadget.isUserAllowed(comment.author)) {
                throw new Error(`User ${comment.author} is not yet permitted to use ${this.config.app.displayName}`);
            }

            const getPRAuthor = async (): Promise<string> => {
                const pr = await this.github.getPRInfo(prKey);
                return pr.author;
            };

            if (command === "/submit") {
                if (argument && argument !== "") {
                    throw new Error(`/submit does not accept arguments ('${argument}')`);
                }

                const pr = await this.getPRInfo(prKey);
                if (pr.author !== comment.author) {
                    throw new Error("Only the owner of a PR can submit it!");
                }

                const userInfo = await this.getUserInfo(comment.author);

                const commitOkay = await this.checkCommits(pr, addComment, userInfo);

                if (commitOkay) {
                    const extraComment =
                        userInfo.email === null ? `\n\n${this.warnOnMissingPublicEmail(comment.author)}` : "";

                    const metadata = await gitGitGadget.submit(pr, userInfo);
                    const code = "\n```";
                    await addComment(
                        `Submitted as [${
                            metadata?.coverLetterMessageId
                        }](https://${this.config.mailrepo.host}/${this.config.mailrepo.name}/${
                            metadata?.coverLetterMessageId
                        })\n\nTo fetch this version into \`FETCH_HEAD\`:${
                            code
                        }\ngit fetch ${this.urlRepo} ${metadata?.latestTag}${
                            code
                        }\n\nTo fetch this version to local tag \`${metadata?.latestTag}\`:${
                            code
                        }\ngit fetch --no-tags ${this.urlRepo} tag ${metadata?.latestTag}${code}${extraComment}`,
                    );
                }
            } else if (command === "/preview") {
                if (argument && argument !== "") {
                    throw new Error(`/preview does not accept arguments ('${argument}')`);
                }

                const pr = await this.getPRInfo(prKey);
                const userInfo = await this.getUserInfo(comment.author);

                const commitOkay = await this.checkCommits(pr, addComment, userInfo);

                if (!userInfo.email) {
                    throw new Error(`Could not determine public email of ${comment.author}`);
                }

                if (commitOkay) {
                    const metadata = await gitGitGadget.preview(pr, userInfo);
                    await addComment(`Preview email sent as ${metadata?.coverLetterMessageId}`);
                }
            } else if (command === "/allow") {
                const accountName = argument || (await getPRAuthor());
                let extraComment = "";
                try {
                    const userInfo = await this.github.getGitHubUserInfo(accountName);
                    if (userInfo.email === null) {
                        extraComment = `\n\n${this.warnOnMissingPublicEmail(accountName)}`;
                    }
                } catch (reason) {
                    throw new Error(`User ${accountName} is not a valid GitHub username: ${reason}`);
                }

                if (await gitGitGadget.allowUser(comment.author, accountName)) {
                    await addComment(
                        `User ${accountName} is now allowed to use ${this.config.app.displayName}.${extraComment}`,
                    );
                } else {
                    await addComment(`User ${accountName} already allowed to use ${this.config.app.displayName}.`);
                }
            } else if (command === "/disallow") {
                const accountName = argument || (await getPRAuthor());

                if (await gitGitGadget.denyUser(comment.author, accountName)) {
                    await addComment(`User ${accountName} is no longer allowed to use ${this.config.app.displayName}.`);
                } else {
                    await addComment(`User ${accountName} already not allowed to use ${this.config.app.displayName}.`);
                }
            } else if (command === "/cc") {
                await this.handleCC(argument, prKey);
            } else if (command === "/test") {
                await addComment(`Received test '${argument}'`);
            } else {
                console.log(`Ignoring unrecognized command ${command} in ${pullRequestURL}#issuecomment-${commentID}`);
            }
        } catch (e) {
            const error = e as Error;
            await addComment(error.toString());
            // re-throw exception to avoid "succeeding" on error
            throw e;
        }
    }

    public async checkCommits(
        pr: IPullRequestInfo,
        addComment: CommentFunction,
        userInfo?: IGitHubUser,
    ): Promise<boolean> {
        let result = true;
        const maxCommits = this.config.lint.maxCommits;

        if (!this.maxCommitsExceptions.includes(pr.pullRequestURL) && pr.commits && pr.commits > maxCommits) {
            await addComment(
                [
                    `The pull request has ${pr.commits} commits. `,
                    `The max allowed is ${maxCommits}. `,
                    "Please split the patch series into multiple pull requests. ",
                    "Also consider squashing related commits.",
                ].join(""),
            );
            result = false;
        }

        const commits = await this.github.getPRCommits(pr.baseOwner, pr.number);

        const merges: string[] = [];
        for (const cm of commits) {
            if (cm.parentCount > 1) {
                merges.push(cm.commit);
            }

            if (cm.author.email.endsWith("@users.noreply.github.com")) {
                await addComment(`Invalid author email in ${cm.commit}: "${cm.author.email}"`);
                result = false;
                continue;
            }

            // Update email from git info if not already set
            if (userInfo && !userInfo.email) {
                if (userInfo.login === cm.author.login) {
                    userInfo.email = cm.author.email;
                } else if (userInfo.login === cm.committer.login) {
                    userInfo.email = cm.committer.email;
                }
            }
        }

        if (merges.length) {
            await addComment(
                `There ${
                    merges.length > 1 ? "are merge commits" : "is a merge commit"
                } in this Pull Request:\n\n    ${merges.join("\n    ")}\n\nPlease rebase the branch and force-push.`,
            );
            result = false;
        }

        // if no initial failure, run linting checks

        if (result) {
            const results = await Promise.all(
                commits.map((commit: IPRCommit) => {
                    const linter = new LintCommit(commit);
                    return linter.lint();
                }),
            );

            for (const lintError of results.filter((el) => el) as ILintError[]) {
                await addComment(lintError.message);
                if (lintError.checkFailed) {
                    result = false;
                }
            }
        }

        return result;
    }

    public static redactGitHubToken(text: string): string {
        return text.replace(/(https:\/\/)x-access-token:.*?@/g, "$1");
    }

    public async handleCC(ccSet: string, prKey: pullRequestKey): Promise<void> {
        const addresses = addressparser(ccSet, { flatten: true });

        for (const address of addresses) {
            const cc = address.name ? `${address.name} <${address.address}>` : address.address;
            await this.github.addPRCc(prKey, cc);
        }
    }

    public static async getWelcomeMessage(username: string): Promise<string> {
        const resPath = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "res", "WELCOME.md");
        return (await readFile(resPath)).toString().replace(/\${username}/g, username);
    }

    public async handlePush(repositoryOwner: string, prNumber: number): Promise<void> {
        const prKey = {
            owner: repositoryOwner,
            repo: this.config.repo.name,
            pull_number: prNumber,
        };

        const pr = await this.github.getPRInfo(prKey);

        const addComment = async (body: string): Promise<void> => {
            const redacted = CIHelper.redactGitHubToken(body);
            console.log(`Adding comment to ${pr.pullRequestURL}:\n${redacted}`);
            await this.github.addPRComment(prKey, redacted);
        };

        const gitGitGadget = await GitGitGadget.get(
            this.gggConfigDir,
            this.workDir,
            this.urlRepo,
            this.notesPushToken,
            this.smtpOptions,
        );
        if (!pr.hasComments && !gitGitGadget.isUserAllowed(pr.author)) {
            const welcome = await CIHelper.getWelcomeMessage(pr.author);
            await this.github.addPRComment(prKey, welcome);

            await this.github.addPRLabels(prKey, ["new user"]);
        }

        const commitOkay = await this.checkCommits(pr, addComment);

        if (!commitOkay) {
            // make check fail to get user attention
            throw new Error("Failing check due to commit linting errors.");
        }
    }

    public async handleNewMails(mailArchiveGitDir?: string, onlyPRs?: Set<number>): Promise<boolean> {
        if (!mailArchiveGitDir) {
            mailArchiveGitDir = this.mailingListMirror;
            if (!mailArchiveGitDir) {
                throw new Error("No mail archive directory specified (forgot to run `setupGitHubAction()`?)");
            }
        }
        await git(["fetch"], { workDir: mailArchiveGitDir });
        const prFilter = !onlyPRs
            ? undefined
            : (pullRequestURL: string): boolean => {
                  const match = pullRequestURL.match(/.*\/(\d+)$/);
                  return !match ? false : onlyPRs.has(parseInt(match[1], 10));
              };
        await this.maybeUpdateGGGNotes();
        const mailArchiveGit = await MailArchiveGitHelper.get(
            this.notes,
            mailArchiveGitDir,
            this.github,
            this.config.mailrepo.branch,
        );
        if (await mailArchiveGit.processMails(prFilter)) {
            await this.pushNotesRef();
            return true;
        }
        return false;
    }

    public async updateOpenPrs(): Promise<boolean> {
        const options = await this.getGitGitGadgetOptions();
        let optionsChanged = false;

        if (!options.openPRs) {
            options.openPRs = {};
            optionsChanged = true;
        }

        if (!options.activeMessageIDs) {
            options.activeMessageIDs = {};
            optionsChanged = true;
        }

        const handledPRs = new Set<string>();
        const handledMessageIDs = new Set<string>();

        for (const repositoryOwner of this.config.repo.owners) {
            const pullRequests = await this.github.getOpenPRs(repositoryOwner);

            for (const pr of pullRequests) {
                const meta = await this.getPRMetadata(pr.pullRequestURL);

                if (!meta) {
                    console.log(`No meta found for ${pr.pullRequestURL}`);
                    continue;
                }

                const url: string = pr.pullRequestURL;
                handledPRs.add(url);

                if (meta.coverLetterMessageId && options.openPRs[url] === undefined) {
                    options.openPRs[url] = meta.coverLetterMessageId;
                    optionsChanged = true;
                }

                if (meta.baseCommit && meta.headCommit) {
                    for (const rev of await this.getOriginalCommitsForPR(meta)) {
                        const messageID = await this.notes.getLastCommitNote(rev);
                        handledMessageIDs.add(messageID);
                        if (messageID && options.activeMessageIDs[messageID] === undefined) {
                            options.activeMessageIDs[messageID] = rev;
                            optionsChanged = true;
                        }
                    }
                }
            }
        }

        for (const url in options.openPRs) {
            if (!handledPRs.has(url)) {
                delete options.openPRs[url];
                optionsChanged = true;
            }
        }

        for (const messageID in options.activeMessageIDs) {
            if (!handledMessageIDs.has(messageID)) {
                delete options.activeMessageIDs[messageID];
                optionsChanged = true;
            }
        }

        if (optionsChanged) {
            console.log(`Changed options:\n${toPrettyJSON(options)}`);
            await this.notes.set("", options, true);
            await this.pushNotesRef();
        }

        return optionsChanged;
    }

    private async getPRInfo(prKey: pullRequestKey): Promise<IPullRequestInfo> {
        const pr = await this.github.getPRInfo(prKey);

        if (!this.config.repo.owners.includes(pr.baseOwner) || pr.baseRepo !== this.config.repo.name) {
            throw new Error(`Unsupported repository: ${pr.pullRequestURL}`);
        }

        if (!pr.baseLabel || !pr.baseCommit || !pr.headLabel || !pr.headCommit) {
            throw new Error(`Could not determine PR details for ${pr.pullRequestURL}`);
        }

        if (!pr.title || (!pr.body && pr.commits !== 1)) {
            throw new Error("Ignoring PR with empty title and/or body");
        }

        if (!pr.mergeable) {
            throw new Error("Refusing to submit a patch series that does not merge cleanly.");
        }

        return pr;
    }

    private async getUserInfo(author: string): Promise<IGitHubUser> {
        const userInfo = await this.github.getGitHubUserInfo(author);
        if (!userInfo.name) {
            if (this.config.user.allowUserAsLogin) {
                userInfo.name = userInfo.login;
            } else {
                throw new Error(`Could not determine full name of ${author}`);
            }
            throw new Error(`Could not determine full name of ${author}`);
        }

        return userInfo;
    }

    private async maybeUpdateGGGNotes(): Promise<void> {
        if (!this.gggNotesUpdated) {
            await this.notes.update(this.urlRepo);
            this.gggNotesUpdated = true;
        }
    }

    private async maybeUpdateMail2CommitMap(): Promise<void> {
        if (!this.mail2CommitMapUpdated) {
            await this.mail2commit.updateMail2CommitAndBranches();
            this.mail2CommitMapUpdated = true;
        }
    }

    private async pushNotesRef(): Promise<void> {
        await this.notes.push(this.urlRepo, this.notesPushToken);
    }
}
