import { git } from "./git";
import { GitNotes } from "./git-notes";

export class MailCommitMapping {
    public readonly workDir?: string;
    public readonly mail2CommitNotes: GitNotes;

    public constructor(workDir?: string) {
        this.workDir = workDir;
        this.mail2CommitNotes = new GitNotes(workDir,
            "refs/notes/mail-to-commit");
    }

    public async getGitGitCommitForMessageId(messageID: string):
        Promise<string | undefined> {
        return await this.mail2CommitNotes.getString(messageID);
    }

    public async updateMail2CommitAndBranches(): Promise<void> {
        return await this.update(true, true, true);
    }

    public async updateMail2CommitRef(): Promise<void> {
        return await this.update(true);
    }

    private async update(includeNotesRef?: boolean,
                         includeUpstreamBranches?: boolean,
                         includeGitsterBranches?: boolean): Promise<void> {
        const refs = [];
        if (includeNotesRef) {
            refs.push("refs/notes/mail-to-commit:refs/notes/mail-to-commit");
        }
        if (includeUpstreamBranches) {
            for (const ref of ["pu", "next", "master", "maint"]) {
                refs.push(`+refs/heads/${ref}:refs/remotes/upstream/${ref}`);
            }
        }
        if (includeGitsterBranches) {
            refs.push("+refs/heads/*:refs/remotes/gitster/*");
        }
        if (refs.length) {
            await git([
                "fetch",
                "https://github.com/gitgitgadget/git",
                ...refs,
            ], { workDir: this.workDir });
        }
    }
}
