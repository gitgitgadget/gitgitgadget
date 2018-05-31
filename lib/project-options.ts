import { git, gitConfig, gitConfigForEach } from "./git";

// For now, only the Git, Cygwin and BusyBox projects are supported
export class ProjectOptions {
    public static async getBranchName(workDir: string): Promise<string> {
        // Get the current branch name
        const ref = await git(["rev-parse", "--symbolic-full-name", "HEAD"],
            { workDir });
        const match = ref.match(/^refs\/heads\/(.*)/);
        if (!match) {
            throw new Error("Not on a branch (" + ref + ")?");
        }
        return match![1];
    }

    public static async getLocal(workDir?: string): Promise<ProjectOptions> {
        if (!workDir) {
            workDir = ".";
        }
        const branchName = await ProjectOptions.getBranchName(workDir);
        const cc = await ProjectOptions.getCc(branchName, workDir);
        const publishToRemote =
            await gitConfig("mail.publishtoremote", workDir);
        const baseBranch =
            await ProjectOptions.determineBaseBranch(branchName,
            publishToRemote, workDir);

        return await ProjectOptions.get(workDir, branchName, cc, baseBranch,
            publishToRemote);
    }

    public static async get(workDir: string, branchName: string,
                            cc: string[], basedOn?: string,
                            publishToRemote?: string):
        Promise<ProjectOptions> {
        let upstreamBranch: string;
        let to: string;
        let midUrlPrefix: string = " Message-ID: ";

        if (this.commitExists("e83c5163316f89bfbde", workDir)) {
            // Git
            to = "--to=git@vger.kernel.org";
            cc.push("Junio C Hamano <gitster@pobox.com>");
            upstreamBranch = "upstream/pu";
            if (await git(["rev-list", branchName + ".." + upstreamBranch],
                { workDir })) {
                upstreamBranch = "upstream/next";
            }
            if (await git(["rev-list", branchName + ".." + upstreamBranch],
                { workDir })) {
                upstreamBranch = "upstream/master";
            }
            midUrlPrefix = "https://public-inbox.org/git/";
        } else if (this.commitExists("a3acbf46947e52ff596", workDir)) {
            // Cygwin
            to = "--to=cygwin-patches@cygwin.com";
            upstreamBranch = "cygwin/master";
            midUrlPrefix = "https://www.mail-archive.com/search?"
                + "l=cygwin-patches@cygwin.com&q=";
        } else if (this.commitExists("cc8ed39b240180b5881", workDir)) {
            // BusyBox
            to = "--to=busybox@busybox.net";
            upstreamBranch = "busybox/master";
            midUrlPrefix = "https://www.mail-archive.com/search?"
                + "l=busybox@busybox.net&q=";
        } else {
            throw new Error("Unrecognized project");
        }

        if (basedOn) {
            upstreamBranch = basedOn;
        }

        if (await git(["rev-list", branchName + ".." + upstreamBranch],
            { workDir })) {
            throw new Error("Branch " + branchName + " is not rebased to " +
                upstreamBranch);
        }

        return new ProjectOptions(branchName, upstreamBranch, basedOn,
            publishToRemote, to, cc, midUrlPrefix, workDir);
    }

    protected static async commitExists(commit: string, workDir: string):
        Promise<boolean> {
        try {
            await git(["rev-parse", "--verify", commit], { workDir });
            return true;
        } catch (err) {
            return false;
        }
    }

    protected static async determineBaseBranch(workDir: string,
                                               branchName: string,
                                               publishToRemote: string):
        Promise<string> {
        const basedOn =
            await gitConfig(`branch.${branchName}.basedon`, workDir);
        if (basedOn && !await this.commitExists(basedOn, workDir)) {
            throw new Error("Base branch does not exist: " + basedOn);
        }

        if (!publishToRemote) {
            throw new Error("Need a remote to publish to");
        }

        const remoteRef = `refs/remotes/${publishToRemote}/${basedOn}`;
        if (!await this.commitExists(remoteRef, workDir)) {
            throw new Error(`${basedOn} not pushed to ${publishToRemote}`);
        }

        const commit = await git(["rev-parse", "-q", "--verify", remoteRef],
            { workDir });
        if (await git(["rev-parse", basedOn]) !== commit) {
            throw new Error(basedOn + " on " + publishToRemote +
                " disagrees with local branch");
        }

        return basedOn;
    }

    protected static async getCc(branchName: string, workDir: string):
        Promise<string[]> {
        // Cc: from config
        const cc: string[] = [];
        await gitConfigForEach(`branch.${branchName}.cc`,
            (email) => {
                if (email) {
                    cc.push(email);
                }
            }, workDir);
        return cc;
    }

    public readonly branchName: string;
    public readonly upstreamBranch: string;
    public readonly basedOn?: string;
    public readonly publishToRemote?: string;
    public readonly workDir: string;

    public readonly to: string;
    public readonly cc: string[];
    public readonly midUrlPrefix: string;

    protected constructor(branchName: string, upstreamBranch: string,
                          basedOn: string | undefined,
                          publishToRemote: string | undefined,
                          to: string, cc: string[], midUrlPrefix: string,
                          workDir: string) {
        this.branchName = branchName;
        this.upstreamBranch = upstreamBranch;
        this.basedOn = basedOn;
        this.publishToRemote = publishToRemote;
        this.workDir = workDir;

        this.to = to;
        this.cc = cc;
        this.midUrlPrefix = midUrlPrefix;
    }
}
