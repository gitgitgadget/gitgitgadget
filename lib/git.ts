import { ChildProcess } from "child_process";
import { GitProcess, IGitExecutionOptions } from "dugite";

// For convenience, let's add helpers to call Git:

export interface IGitOptions {
    lineHandler?: (line: string) => Promise<void>;
    processCallback?: (process: ChildProcess) => void;
    stdin?: string | Buffer;
    workDir?: string;
    trimTrailingNewline?: boolean; // defaults to true
    trace?: boolean;
    env?: NodeJS.ProcessEnv;
}

export const emptyBlobName = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
export const emptyTreeName = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function trimTrailingNewline(str: string): string {
    return str.replace(/\r?\n$/, "");
}

export function git(args: string[], options?: IGitOptions | undefined):
    Promise<string> {
    // allow the command to run in a bare repository
    if (options?.workDir?.endsWith(".git")) args = [`--git-dir=${options.workDir}`, ...args];

    const workDir = options && options.workDir || ".";
    if (options && options.trace) {
        process.stderr.write(`Called 'git ${args.join(" ")}' in '${workDir
                            }':\n${new Error().stack}\n`);
    }

    return new Promise<string>((resolve, reject) => {
        if (options && options.lineHandler) {
            const lineHandler = options.lineHandler;
            if (options.processCallback) {
                reject(new Error("line handler *and* process callback set"));
                return;
            }
            options.processCallback = (process: ChildProcess): void => {
                process.on("exit", (code: number, signal: string) => {
                    if (signal) {
                        reject(new Error(`Received signal ${signal}`));
                    } else if (code) {
                        reject(new Error(`Received code ${code}`));
                    }
                });
                if (!process.stdout) {
                    throw new Error(`No stdout for "git ${args.join(" ")}`);
                }
                let linePromise: Promise<void> | undefined;
                const handleLine = (line: string): boolean => {
                    try {
                        if (!linePromise) {
                            linePromise = lineHandler(line);
                        } else {
                            linePromise = linePromise.then(() => {
                                return lineHandler(line);
                            });
                        }
                        linePromise.catch((reason) => {
                            reject(reason);
                            process.kill();
                        });
                    } catch (reason) {
                        reject(reason);
                        process.kill();
                        return false;
                    }
                    return true;
                };
                let buffer = "";
                process.stdout.on("data", (chunk: string) => {
                    buffer += chunk;
                    for (;;) {
                        const eol = buffer.indexOf("\n");
                        if (eol < 0) {
                            break;
                        }
                        if (!handleLine(buffer.substring(0, eol))) {
                            return;
                        }
                        buffer = buffer.substring(eol + 1);
                    }
                });
                process.stdout.on("end", () => {
                    if (buffer.length > 0) {
                        handleLine(buffer);
                    }
                    if (linePromise) {
                        linePromise.then(() => { resolve(""); })
                            .catch((reason) => { reject(reason); });
                    } else {
                        resolve("");
                    }
                });
            };
        }

        GitProcess.exec(args, workDir, options as IGitExecutionOptions)
        .then((result) => {
            if (result.exitCode) {
                reject(new Error(`git ${args.join(" ")
                                } failed: ${result.exitCode
                                },\n${result.stderr}`));
                return;
            }
            if (options && options.trace) {
                process.stderr.write(`Output of 'git ${args.join(" ")
                                    }':\nstderr: ${result.stderr
                                    }\nstdout: ${result.stdout}\n`);
            }
            if (!options?.lineHandler) { // let callback resolve the promise
                resolve(!options || options.trimTrailingNewline === false ?
                        result.stdout : trimTrailingNewline(result.stdout));
            }
        }).catch((reason) => {
            reject(reason);
        });
    });
}

/**
 * Call `git rev-parse --verify` to verify an object name.
 *
 * Note that it will *always* return the argument back to the user if it is
 * a hex string of length 40. This is consistent with `rev-parse`. To
 * verify objects by full SHA-1, you have to add `^{blob}` or similar.
 *
 * @param { string } argument the name referring to a Git object
 * @param { string | undefined } workDir
 *    the working directory in which to run `git rev-parse`
 * @returns { string | undefined } the full SHA-1, or undefined
 */
export async function revParse(argument: string, workDir?: string):
    Promise<string | undefined> {
    const result = await GitProcess.exec(["rev-parse", "--verify", "-q",
                                          argument],
                                         workDir || ".");
    return result.exitCode ? undefined : trimTrailingNewline(result.stdout);
}

/**
 * Call `git rev-list --count` to count objects in a commit range.
 *
 * @param { string[] } rangeArgs the arguments to pass to `git rev-list`
 * @param { string | undefined } workDir
 *    the working directory in which to run `git rev-parse`
 * @returns number the number of commits in the commit range
 */
export async function revListCount(rangeArgs: string | string[],
                                   workDir = "."):
    Promise<number> {
    const gitArgs: string[] = ["rev-list", "--count"];
    if (typeof(rangeArgs) === "string") {
        gitArgs.push(rangeArgs);
    } else {
        gitArgs.push(...rangeArgs);
    }
    const result = await GitProcess.exec(gitArgs, workDir);
    if (result.exitCode) {
        throw new Error(`Could not determine count for ${
            rangeArgs}: ${result.stderr}`);
    }
    return parseInt(result.stdout, 10);
}

/**
 * Determine whether a certain commit exists
 *
 * @param {string} commit the name of the commit
 * @param {string} workDir the Git worktree where to look
 * @returns {boolean} whether the commit exists
 */
export async function commitExists(commit: string, workDir: string):
    Promise<boolean> {
    return await revParse(`${commit}^{commit}`, workDir) !== undefined;
}

export async function gitConfig(key: string, workDir?: string):
    Promise<string | undefined> {
    const result = await GitProcess.exec(["config", key], workDir || ".");
    if (result.exitCode !== 0) {
        return undefined;
    }
    return trimTrailingNewline(result.stdout);
}

export async function gitConfigForEach(key: string,
                                       callbackfn: (value: string) => void,
                                       workDir?: string):
    Promise<void> {
    const result = await GitProcess.exec(["config", "--get-all", key],
                                         workDir || ".");
    result.stdout.split(/\r?\n/).map(callbackfn);
}

export async function gitCommandExists(command: string, workDir?: string):
    Promise<boolean> {
    const result = await GitProcess.exec([command, "-h"], workDir || ".");
    return result.exitCode === 129;
}

// rev-parse does not have enough info in shallow repos to determine a safe short name
export function gitShortHash(longHash: string): string {
    return longHash.substring(0, 8);
}
