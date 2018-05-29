import { GitProcess, IGitExecutionOptions } from "dugite";

// For convenience, let's add helpers to call Git:

export interface IGitOptions extends IGitExecutionOptions {
    workDir?: string;
    trimTrailingNewline?: boolean; // defaults to true
}

function trimTrailingNewline(str: string): string {
    return str.replace(/\r?\n$/, "");
}

export async function git(args: string[],
                          options?: IGitOptions | undefined):
                         Promise<string> {
    const workDir = options && options.workDir || ".";
    const result = await GitProcess.exec(args, workDir, options);
    if (result.exitCode) {
        throw new Error(`git ${args.join(" ")} failed: ${result.exitCode},
${result.stderr}`);
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
    const result = await GitProcess.exec([
        "rev-parse", "--verify", "-q", argument,
    ], workDir || ".");
    return result.exitCode ? undefined : trimTrailingNewline(result.stdout);
}

export async function gitConfig(key: string, workDir?: string):
        Promise<string> {
    const result = await GitProcess.exec(["config", key], workDir || ".");
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
