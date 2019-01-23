import { ChildProcess } from "child_process";
import { GitProcess, IGitExecutionOptions } from "dugite";

// For convenience, let's add helpers to call Git:

export interface IGitOptions {
    processCallback?: (process: ChildProcess) => void;
    stdin?: string | Buffer;
    workDir?: string;
    trimTrailingNewline?: boolean; // defaults to true
    trace?: boolean;
}

export const emptyBlobName = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

function trimTrailingNewline(str: string): string {
    return str.replace(/\r?\n$/, "");
}

export async function git(args: string[],
                          options?: IGitOptions | undefined):
    Promise<string> {
    const workDir = options && options.workDir || ".";
    if (options && options.trace) {
        process.stderr.write(`Called 'git ${args.join(" ")}' in '${workDir
                             }':\n${new Error().stack}\n`);
    }
    const result = await GitProcess.exec(args, workDir,
                                         options as IGitExecutionOptions);
    if (result.exitCode) {
        throw new Error(`git ${args.join(" ")} failed: ${result.exitCode
                        },\n${result.stderr}`);
    }
    if (options && options.trace) {
        process.stderr.write(`Output of 'git ${args.join(" ")
                             }':\nstderr: ${result.stderr
                             }\nstdout: ${result.stdout}\n`);
    }
    return !options || options.trimTrailingNewline === false ?
        result.stdout : trimTrailingNewline(result.stdout);
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
export async function revParse(argument: string, workDir?: string) {
    const result = await GitProcess.exec(["rev-parse", "--verify", "-q",
                                          argument],
                                         workDir || ".");
    return result.exitCode ? undefined : trimTrailingNewline(result.stdout);
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
