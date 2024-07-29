import { emptyBlobName, git, revParse } from "./git";
import { fromJSON, toJSON } from "./json-util";

export type POJO = { [name: string]: string | string[] | number | number[] | boolean | POJO };

/*
 * Represents a temporary Git index that reflects a note tip commit, ready
 * for making changes without committing them immediately.
 *
 * The purpose of this data structure is to support the `GitNotes.notesSync()`
 * method.
 */
type TemporaryNoteIndex = {
    appendNote: (oid: string, text: string) => Promise<void>,
    setTextNote: (oid: string, text: string) => Promise<void>,
    mutateObject: (oid: string, fn: (o: POJO) => void) => Promise<void>,
    writeTree: () => Promise<string>
};

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

    public async update(url: string): Promise<void> {
        if (this.notesRef === "refs/notes/gitgitgadget" ||
            this.notesRef === "refs/notes/commit-to-mail" ||
            this.notesRef === "refs/notes/mail-to-commit") {
            await git(["fetch", url,
                       `+${this.notesRef}:${this.notesRef}`],
                      { workDir: this.workDir });
        } else {
            throw new Error(`Don't know how to update ${this.notesRef}`);
        }
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

    /**
     * Replay local-first changes on top of a quite possibly changed upstream note ref tip commit.
     *
     * This is intended to help in a situation where a GitHub workflow tended to some of GitGitGadget's "household
     * chores" and updates `refs/notes/gitgitgadget` to reflect the new state, and then detects that a concurrent GitHub
     * workflow updated that state already and pushed it to the remote repository.
     *
     * To deal with that, this method will reconstruct the changes that have been made to the local-only commits, and
     * then replay them onto the upstream tip commit so that the notes ref can be pushed with the local updates
     * (fast-forwarding).
     *
     * The logic is versatile enough to replay all of the changes GitGitGadget regularly makes, but it is of course no
     * panacea: any GitHub workflow that uses this method _must_ ensure a concurrency limit (and not cancel any run that
     * is in progress to avoid losing local-only state that reflects actual changes that were made, because that would
     * potentially result e.g. in multiple identical comments being added to the PRs due to GitGitGadget "forgetting"
     * that it already added the comment).
     *
     * Note: Instead of imitating `git replay` by rebasing the individual commits, this method infers the intention of
     * the diff of the local-only changes and then applies the corresponding changes to a temporary Git index that is
     * initialized using the upstream commit. Then a proper merge commit is added to combine the diverging commit
     * histories.
     *
     * @param upstreamCommit The commit to merge (typically the just-fetched notes ref that diverges from the local
     * notes ref)
     * @returns the SHA of the merge commit to which the local notes ref was updated
     */
    public async notesSync(upstreamCommit: string): Promise<string> {
        const options = { workDir: this.workDir };
        const head = await git(["rev-parse", this.notesRef], options);
        if (head === upstreamCommit) return head;
        const mergeBases = (await git(["merge-base", "-a", head, upstreamCommit], options))
            .trim()
            .split(/\s+/);
        if (mergeBases.length !== 1)
            throw new Error(`${head}/${upstreamCommit}: single merge expected, got ${mergeBases.join(', ')}`);
        if (mergeBases[0] === head) return upstreamCommit;
        if (mergeBases[0] === upstreamCommit) return head;

        const tmpIndex = await this.makeTemporaryNotesIndex(upstreamCommit, this.workDir);

        // Need to do a 3-way merge
        // not as easy as `git merge-tree` because some file contain JSON objects that need special handling
        const diff = await git(["diff", mergeBases[0], head, "--"], options);
        const fileNameRegExp = "(?:\\/dev\\/null|[ab]\\/(.*))";
        const lineRangeRegExp = "(\\d+)(?:,(\\d+))?";
        const diffSplitRegExp = new RegExp(
            `(?:^|\\n)diff[^]*?\\n` +
            `--- ${fileNameRegExp}\\n` +
            `\\+\\+\\+ ${fileNameRegExp}\\n` +
            `@@ -${lineRangeRegExp} \\+${lineRangeRegExp}.* @@.*\\n`
        );
        const split = diff.split(diffSplitRegExp);
        for (let i = 1; i < split.length; i += 7) {
            const oid = (split[i] || split[i + 1]).replace(/\//g, '');

            const oldCount = split[i + 3] ? parseInt(split[i + 3], 10) : 1;
            const newCount = split[i + 5] ? parseInt(split[i + 5], 10) : 1;

            // is it an append?
            if (oldCount < newCount && ((newCount - oldCount) % 2) === 0) {
                const lines = split[i + 6].split(/\n/g);
                const unexpected = lines.filter((e, j) => j < oldCount ? !e.startsWith(' ') : !e.startsWith('+'));
                if (unexpected.length > 0) {
                    throw new Error(`Unexpected append lines:\n${lines.join("\n")}, unexpected: ${unexpected}`);
                }
                const appended = lines.slice(oldCount, newCount).map(e => e.replace(/^\+/, ""));
                if (!appended) throw new Error(`Not an append?\n${split[i + 6]}`);
                await tmpIndex.appendNote(oid, appended.join('\n'));
                continue;
            }

            if (newCount !== 1) throw new Error(`Modified more than a single line?\n${split[i + 6]}`);

            // does it modify an existing object?
            const modifiesObject = split[i + 6].match(/(^|\n)\+[[{"]/);

            if (!modifiesObject) {
                const text = split[i + 6].match(/(?:^|\n)\+(.*)\n?$/);
                if (!text) throw new Error(`Not a single modified line?\n${split[i + 6]}`);
                await tmpIndex.setTextNote(oid, text[1]);
                continue;
            }

            const removeAdd = split[i + 6].match(/^(?:-(.*)\n)?\+(.*)$/);
            if (!removeAdd) throw new Error(`Not a single modified line?\n${split[i + 6]}`);

            const oOld = removeAdd[1] ? fromJSON<POJO>(removeAdd[1]) : {};
            const oNew = fromJSON<POJO>(removeAdd[2]);
            const mutation = this.inferMutation(oOld, oNew);
            if (mutation !== null) await tmpIndex.mutateObject(oid, mutation);
        }

        const tree = await tmpIndex.writeTree();
        const commit = await git([
            "commit-tree", "-p", head, "-p", upstreamCommit, "-m", "Merge upstream", tree
        ], options);
        await git(["update-ref", "-m", "Merge upstream", this.notesRef, commit, head], options);
        return commit;
    }

    /**
     * Initializes a temporary Git index using a given revision (that is typically the upstream notes ref). Returns a
     * data structure to mutate that index and eventually write out a Git tree ready for committing.
     *
     * @param revision the commit from which to initialize the temporary Git index (typically the tip commit of a
     * just-fetched `refs/notes/gitgitgadget` note)
     * @param workDir the Git work-tree or bare repository to work with
     * @returns a temporary Git index structure ready to be mutated
     */
    protected async makeTemporaryNotesIndex(revision: string, workDir?: string): Promise<TemporaryNoteIndex> {
        const options = {
            env: { ...process.env },
            workDir
        };

        // read the notes into the index
        options.env.GIT_INDEX_FILE = await git(["rev-parse", "--git-path", `index.${revision}`], options);
        await git(["read-tree", revision], options);

        // determine the fan-out level
        const emptyBlobPath = await git([
            "ls-files", `${emptyBlobName.slice(0, 2)}*${emptyBlobName.slice(16)}`
        ], options);
        const cutoff = (emptyBlobPath.match(/\//g)?.length || 0) * 2 + 2;
        const oid2notesPath = cutoff < 4
            ? (oid: string) => oid
            : (oid: string) => `${oid.slice(0, cutoff).match(/../g)?.join("/")}${oid.slice(cutoff)}`;
        if (emptyBlobPath !== oid2notesPath(emptyBlobName)) {
            throw new Error(`Fan-out mis-detected: ${emptyBlobPath} != ${oid2notesPath(emptyBlobName)}`);
        }

        const get = async (oid: string): Promise<string> => {
            try {
                return await git(["cat-file", "blob", `:${oid2notesPath(oid)}`], options);
            } catch (e) {
                return "";
            }
        };


        const set = async (oid: string, text: string): Promise<void> => {
            const blob = await git(["hash-object", "-w", "--stdin"], { stdin: text, ...options });
            await git(["update-index", "--add", "--cacheinfo", `100644,${blob},${oid2notesPath(oid)}`], options);
        };

        return {
            async appendNote(oid: string, text: string): Promise<void> {
                const originalNote = await get(oid);
                await set(oid, originalNote === "" ? text : `${originalNote}\n${text}\n`);
            },
            async setTextNote(oid: string, text: string) {
                await set(oid, `${text}\n`);
            },
            async mutateObject(oid, fn: (o: POJO) => void): Promise<void> {
                const originalNote = await get(oid);
                const o = fromJSON<POJO>(originalNote || "{}");
                fn(o);
                const modifiedNote = `${toJSON(o)}\n`;
                if (originalNote !== modifiedNote) await set(oid, modifiedNote);
            },
            async writeTree(): Promise<string> {
                const out = await git(["write-tree"], options);
                return out.trim();
            }
        };
    }

    /**
     * Infers what changes there are between two versions of the same object and returns a function that would repeat
     * that mutation. This function can then be used to apply the same changes to a different version of the object.
     *
     * By preferring the local changes in case of disagreement, this function can be used to implement a strategy
     * similar to [Conflict-free replicated data
     * types](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) to allow GitGitGadget to maintain a
     * global state in the `refs/notes/gitgitgadget` note at https://github.com/gitgitgadget/git that is updated
     * concurrently by independently-operating GitHub workflows.
     *
     * @param oOld the old version of the object
     * @param oNew the new version of the object
     * @returns a function that would mutate `oOld` to look like `oNew`, ready to be applied to a different version of
     * the object
     */
    protected inferMutation(oOld: POJO, oNew: POJO): null | ((o: POJO) => void) {
        const keys = new Set<string>([...Object.keys(oOld), ...Object.keys(oNew)]);
        const mutations = new Array<(o: POJO) => void>();
        for (const key of keys) {
            const aNew = oNew[key];
            if (aNew === undefined) {
                mutations.push((o: POJO) => {
                    delete o[key];
                });
                continue;
            }

            const aOld = oOld[key];
            const isArray = Array.isArray(aOld !== undefined ? aOld : aNew);
            if (isArray) {
                if (!Array.isArray(aNew)) throw new Error(`'${key}' was an array but now is not?`);
                const itemsOld = aOld === undefined ? new Set() : new Set(aOld as string[]);

                mutations.push((o: POJO) => {
                    if (o[key] === undefined) o[key] = [];
                });

                for (const item of aNew as string[]) {
                    if (!itemsOld.has(item)) mutations.push((o: POJO) => {
                        (o[key] as string[]).push(item);
                    });
                }

                if (aOld === undefined) continue;

                const itemsNew = new Set(aNew as string[]);
                for (const item of aOld as string[]) {
                    if (!itemsNew.has(item)) mutations.push((o: POJO) => {
                        const index = (o[key] as string[]).indexOf(item);
                        if (index >= 0) (o[key] as string[]).splice(index, 1);
                    });
                }
                continue;
            }

            const isObject = "object" === typeof (aOld !== undefined ? aOld : aNew);
            if (!isObject) {
                // is a primitive value
                if (aOld !== aNew) mutations.push((o: POJO) => { o[key] = aNew; });
                continue;
            }

            // is an object
            const mutation = this.inferMutation(
                aOld === undefined ? {} : aOld as POJO,
                aNew === undefined ? {} : aNew as POJO
            );
            if (mutation === null) continue;
            mutations.push((o: POJO) => {
                if (o[key] === undefined) o[key] = {};
                mutation(o[key] as POJO);
            });
        }
        if (mutations.length === 0) return null;
        return (o: POJO) => {
            mutations.forEach(m => m(o));
        };
    }
}
