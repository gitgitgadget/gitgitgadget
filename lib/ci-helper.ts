import { git } from "./git";
import { GitNotes } from "./git-notes";
import { MailCommitMapping } from "./mail-commit-mapping";

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
    private gggNotesUpdated: boolean;
    private mail2CommitMapUpdated: boolean;

    public constructor(workDir?: string) {
        this.workDir = workDir;
        this.notes = new GitNotes(workDir);
        this.gggNotesUpdated = false;
        this.mail2commit = new MailCommitMapping(this.notes.workDir);
        this.mail2CommitMapUpdated = false;
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

    public async getMessageIdForOriginalCommit(commit: string):
        Promise<string | undefined> {
        await this.maybeUpdateGGGNotes();
        return await this.notes.getLastCommitNote(commit);
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
