import { emptyBlobName, git, revParse } from "./git";

export class GitNotes {
    public readonly workDir?: string;
    public readonly notesRef: string;

    public constructor(workDir?: string, notesRef?: string) {
        this.workDir = workDir;
        this.notesRef = notesRef || "refs/notes/gitgitgadget";
    }

    public async get(key: string): Promise<string | undefined> {
        const obj = await git(["hash-object", "--stdin" ], {
            stdin: key,
            workDir: this.workDir,
        });
        try {
            return await this.notes("show", obj);
        } catch (reason) {
            return undefined;
        }
    }

    public async set(key: string, value: string): Promise<void> {
        const obj = await git([ "hash-object", "--stdin" ], { stdin: key });
        if (!await revParse(`${obj}^{blob}`, this.workDir)) {
            try {
                /*
                 * Annotate the notes ref's tip itself, just to make sure that
                 * there is a reachable blob that has `key` as contents.
                 */
                await this.notes("add", "-m", key, this.notesRef);
                // Remove the note to avoid clutter
                await this.notes("remove", `${this.notesRef}^`);
            } catch (reason) {
                /*
                 * Apparently there is no notes ref yet. Initialize it, by
                 * annotating the empty blob and immediately removing the note.
                 */
                await this.notes("add", "-m", key, emptyBlobName);
                await this.notes("remove", emptyBlobName);
            }
        }
        await this.notes("add", "-m", value, obj);
    }

    protected async notes(...args: string[]): Promise<string> {
        return await git(["notes", `--ref=${this.notesRef}`].concat(args), {
            workDir: this.workDir,
        });
    }
}
