import { GitProcess, IGitExecutionOptions } from "dugite";

// For convenience, let's add helpers to call Git:

export async function git(args: string[],
                          options?: IGitExecutionOptions | undefined):
                         Promise<string> {
    const result = await GitProcess.exec(args, ".", options);
    if (result.exitCode) {
        throw new Error("git " + args.join(" ") + " failed with exit code "
            + result.exitCode);
    }
    return result.stdout;
}

export async function gitConfig(key: string): Promise<string> {
    return (await GitProcess.exec(["config", key], ".")).stdout;
}

export async function gitConfigForEach(key: string,
                                       callbackfn: (value: string) => void):
                                      Promise<void> {
    const result = await GitProcess.exec(["config", "--get-all", key], ".");
    result.stdout.split("\n").map(callbackfn);
}
