import { git } from "./git.js";
import { GitNotes } from "./git-notes.js";
import { IConfig, getConfig } from "./project-config.js";

export class MailCommitMapping {
    public readonly config: IConfig = getConfig();
    public readonly workDir?: string;
    public readonly mail2CommitNotes: GitNotes;

    public constructor(workDir?: string) {
        this.workDir = workDir;
        this.mail2CommitNotes = new GitNotes(workDir, "refs/notes/mail-to-commit");
    }

    public async getGitGitCommitForMessageId(messageID: string): Promise<string | undefined> {
        return await this.mail2CommitNotes.getString(messageID);
    }

    public async updateMail2CommitAndBranches(): Promise<void> {
        return await this.update(true, true, true);
    }

    public async updateMail2CommitRef(): Promise<void> {
        return await this.update(true);
    }

    private async update(
        includeNotesRef?: boolean,
        includeUpstreamBranches?: boolean,
        includeGitsterBranches?: boolean,
    ): Promise<void> {
        const refs: string[] = [];
        if (includeNotesRef) {
            refs.push("refs/notes/mail-to-commit:refs/notes/mail-to-commit");
        }
        if (includeUpstreamBranches) {
            for (const ref of this.config.repo.trackingBranches) {
                refs.push(`+refs/heads/${ref}:refs/remotes/upstream/${ref}`);
            }
        }
        if (includeGitsterBranches && this.config.repo.maintainerBranch) {
            refs.push(`+refs/heads/*:refs/remotes/${this.config.repo.maintainerBranch}/*`);
        }
        if (refs.length) {
            console.log(`Updating mail-to-commit/refs: ${refs.join(", ")}`);
            await git(
                [
                    "fetch",
                    "--no-tags",
                    `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`,
                    ...refs,
                ],
                {
                    workDir: this.workDir,
                },
            );
        }
    }
}
