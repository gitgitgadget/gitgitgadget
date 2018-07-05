import { git } from "./git";
import { GitNotes } from "./git-notes";
import { GitHubGlue } from "./github-glue";
import { MailCommitMapping } from "./mail-commit-mapping";
import { IMailMetadata } from "./mail-metadata";

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
