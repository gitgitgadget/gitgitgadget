import { emptyBlobName, git, revParse } from "./git";
import { fromJSON, toJSON } from "./json-util";

export class GitNotes {
    public static readonly defaultNotesRef = "refs/notes/gitgitgadget";
    public readonly workDir?: string;
    public readonly notesRef: string;

    public constructor(workDir?: string, notesRef?: string) {
        this.workDir = workDir;
        this.notesRef = notesRef || GitNotes.defaultNotesRef;
    }

    public async get<T>(key: string): Promise<T | undefined> {
        const json = await this.getString(key);
        if (json === undefined) {
            return undefined;
        }
        return fromJSON(json);
    }

    public async getString(key: string): Promise<string | undefined> {
        const obj = await this.key2obj(key);
        try {
            return await this.notes("show", obj);
        } catch (reason) {
            return undefined;
        }
    }

    public async set<T>(key: string, value: T, force?: boolean): Promise<void> {
        return await this.setString(key, toJSON(value), force);
    }

    public async setString(key: string, value: string, force?: boolean):
        Promise<void> {
        const obj = await this.key2obj(key);
        if (obj !== emptyBlobName &&
            !await revParse(`${obj}^{blob}`, this.workDir)) {
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
        if (force) {
            await this.notes("add", "-f", "-m", value, obj);
        } else {
            await this.notes("add", "-m", value, obj);
        }
    }

    public async appendCommitNote(commit: string, note: string):
        Promise<string> {
        return await this.notes("append", "-m", note, commit);
    }

    public async getCommitNotes(commit: string): Promise<string> {
        return await this.notes("show", commit);
    }

    public async getLastCommitNote(commit: string): Promise<string> {
        const notes = await this.getCommitNotes(commit);
        return notes.replace(/^[^]*\n\n/, "");
    }

    protected async key2obj(key: string): Promise<string> {
        if (!key) {
            return emptyBlobName;
        }
        return await git(["hash-object", "--stdin"], {
            stdin: `${key}\n`,
            workDir: this.workDir,
        });
    }

    protected async notes(...args: string[]): Promise<string> {
        return await git(["notes", `--ref=${this.notesRef}`, ...args], {
            workDir: this.workDir,
        });
    }
}
