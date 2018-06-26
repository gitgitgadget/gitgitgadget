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

    protected async updateMail2CommitRef(): Promise<string> {
        await git([
            "fetch",
            "https://github.com/gitgitgadget/git",
            "+refs/notes/mail-to-commit:refs/notes/mail-to-commit",
            "+refs/heads/pu:refs/remotes/upstream/pu",
        ], { workDir: this.mail2CommitNotes.workDir });
        return await git([
            "rev-parse",
            "--verify",
            "refs/notes/mail-to-commit",
        ], { workDir: this.workDir });
    }
}
