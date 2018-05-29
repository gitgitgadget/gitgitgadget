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
