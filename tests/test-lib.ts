import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as util from "util";
import { isDirectory, isFile } from "../lib/fs-util.js";
import { git, IGitOptions, revParse } from "../lib/git.js";
const dirName = path.dirname(fileURLToPath(import.meta.url));

const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const realpath = util.promisify(fs.realpath);
const rmdir = util.promisify(fs.rmdir);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

export async function removeRecursively(directory: string): Promise<void> {
    if (!(await isDirectory(directory))) {
        await unlink(directory);
    } else {
        const items = await readdir(directory);
        for (const name of items) {
            await removeRecursively(`${directory}/${name}`);
        }
        await rmdir(directory);
    }
}

export interface ITestCommitOptions {
    workDir: string;
    author?: string;
    committer?: string;
}

export class TestRepo {
    public readonly workDir: string;
    public readonly options: ITestCommitOptions;
    protected testTickEpoch = 1234567890;

    public constructor(options: ITestCommitOptions) {
        this.workDir = options.workDir;
        this.options = options;
    }

    public async commit(message: string, fileName?: string, contents?: string): Promise<string> {
        const [, gitOpts] = this.parseOptionsForCommit(this.options);

        if (!fileName) {
            fileName = `${message}.t`;
        }

        const fPath = path.dirname(`${this.workDir}/${fileName}`);
        if (fPath !== this.workDir) {
            await mkdir(fPath, { recursive: true });
        }

        await writeFile(`${this.workDir}/${fileName}`, contents || message);
        await git(["add", "--", fileName], gitOpts);
        await git(["commit", "-m", message, "--", fileName], gitOpts);
        const result = await revParse("HEAD", this.workDir);
        if (!result) {
            throw new Error(`Could not commit ${message}?!?`);
        }
        return result;
    }

    public async merge(message: string, mergeHead: string): Promise<string> {
        const [, gitOpts] = this.parseOptionsForCommit(this.options);
        await git(["merge", "-m", message, "--", mergeHead], gitOpts);
        const result = await revParse("HEAD", this.workDir);
        if (!result) {
            throw new Error(`Could not commit ${message}?!?`);
        }
        return result;
    }

    public async git(args: string[]): Promise<string> {
        return await git(args, { workDir: this.workDir });
    }

    public async newBranch(name: string): Promise<string> {
        return await this.git(["checkout", "-b", name]);
    }

    public async revParse(rev: string): Promise<string> {
        const result = await revParse(rev, this.workDir);
        if (!result) {
            throw new Error(`Could not parse '${rev}'`);
        }
        return result;
    }

    protected testTick(): number {
        return (this.testTickEpoch += 60);
    }

    protected parseOptionsForCommit(options: ITestCommitOptions): [number, IGitOptions] {
        const tick = this.testTick();
        const gitOpts = {
            env: {
                GIT_AUTHOR_DATE: `${tick} +0000`,
                GIT_COMMITTER_DATE: `${tick} +0000`,
            },
            workDir: options.workDir,
        };

        if (options.committer) {
            const match = options.committer.match(/^(.*?)\s*<(.*)>$/);
            if (match) {
                Object.assign(gitOpts.env, {
                    GIT_COMMITTER_EMAIL: match[2],
                    GIT_COMMITTER_NAME: match[1],
                });
            }
        }

        if (options.author) {
            const match = options.author.match(/^(.*?)\s*<(.*)>$/);
            if (match) {
                Object.assign(gitOpts.env, {
                    GIT_AUTHOR_EMAIL: match[2],
                    GIT_AUTHOR_NAME: match[1],
                });
            }
            if (!options.committer) {
                const match2 = options.author.match(/^(.*)<(.*)>$/);
                if (match2) {
                    Object.assign(gitOpts.env, {
                        GIT_COMMITTER_EMAIL: match2[2],
                        GIT_COMMITTER_NAME: match2[1],
                    });
                }
            }
        }

        return [tick, gitOpts];
    }
}

export async function testCreateRepo(name: string, suffix?: string): Promise<TestRepo> {
    let tmp = `${dirName}/../.test-dir/`;
    if (!(await isDirectory(tmp))) {
        await mkdir(tmp, { recursive: true });
    }
    tmp = await realpath(tmp);

    const match = name.match(/^(.*[\\/])?(.*?)(\.test)?\.ts$/);
    if (match) {
        name = `trash directory.${match[2]}`;
    }
    if (suffix) {
        name += suffix;
    }

    const dir = `${tmp}/${name}`;
    if (await isDirectory(dir)) {
        await removeRecursively(dir);
        if (await isDirectory(dir)) {
            throw new Error(`rm -rf ${dir} failed!`);
        }
    }

    await git(["init", dir]);

    process.env.HOME = tmp;
    if (!(await isFile(`${tmp}/.gitconfig`))) {
        try {
            await git(["config", "--global", "user.name", "Test User"]);
            await git(["config", "--global", "user.email", "user@example.com"]);
        } catch (e) {
            const error = e as Error;
            if (!error.message.match(/File exists/)) {
                throw error
            }
        }
    }
    const user = await git(["config", "user.name"], { workDir: dir });
    if (user !== "Test User") {
        throw new Error(`Whoops. '${user}'`);
    }
    const opts = {
        env: {
            GIT_AUTHOR_DATE: "123457689 +0000",
            GIT_COMMITTER_DATE: "123457689 +0000",
        },
        workDir: dir,
    };
    await git(["commit-tree", "-m", "Test commit", "4b825dc642cb6eb9a060e54bf8d69288fbee4904"], opts);
    const gitOpts: ITestCommitOptions = { workDir: dir };

    return new TestRepo(gitOpts);
}
