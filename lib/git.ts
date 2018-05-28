import { GitProcess, IGitExecutionOptions } from "dugite";

// For convenience, let's add helpers to call Git:

export interface IGitOptions extends IGitExecutionOptions {
    workDir?: string;
}

export async function git(args: string[],
                          options?: IGitOptions | undefined):
                         Promise<string> {
    const workDir = options && options.workDir || ".";
    const result = await GitProcess.exec(args, workDir, options);
    if (result.exitCode) {
        throw new Error("git " + args.join(" ") + " failed with exit code "
            + result.exitCode);
    }
    return result.stdout;
}

export async function gitConfig(key: string, workDir?: string):
        Promise<string> {
    return (await GitProcess.exec(["config", key], workDir || ".")).stdout;
}

export async function gitConfigForEach(key: string,
                                       callbackfn: (value: string) => void,
                                       workDir?: string):
                                      Promise<void> {
    const result = await GitProcess.exec(["config", "--get-all", key],
                                         workDir || ".");
    result.stdout.split("\n").map(callbackfn);
}
