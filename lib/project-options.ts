import { commitExists, git, gitConfig, gitConfigForEach, revParse } from "./git";
import { IConfig, getConfig, projectInfo } from "./project-config";

// For now, only the Git, Cygwin and BusyBox projects are supported
export class ProjectOptions {
    public static async getBranchName(workDir: string): Promise<string> {
        // Get the current branch name
        const ref = await git(["rev-parse", "--symbolic-full-name", "HEAD"], { workDir });
        const match = ref.match(/^refs\/heads\/(.*)/);
        if (!match) {
            throw new Error("Not on a branch (" + ref + ")?");
        }
        return match[1];
    }

    public static async getLocal(workDir = "."): Promise<ProjectOptions> {
        const branchName = await ProjectOptions.getBranchName(workDir);
        const cc = await ProjectOptions.getCc(branchName, workDir);
        const publishToRemote = await gitConfig("mail.publishtoremote", workDir);
        const baseBranch = await ProjectOptions.determineBaseBranch(workDir, branchName, publishToRemote);

        return await ProjectOptions.get(workDir, branchName, cc, baseBranch, publishToRemote);
    }

    public static async get(workDir: string, branchName: string, cc: string[], basedOn?: string,
                            publishToRemote?: string, baseCommit?: string): Promise<ProjectOptions> {
        const config: IConfig = getConfig();
        let upstreamBranch: string;
        let to: string;
        let midUrlPrefix = " Message-ID: ";

        if (config.hasOwnProperty("project")) {
            const project = config.project as projectInfo;
            to = `--to=${project.to}`;
            upstreamBranch = project.branch;
            midUrlPrefix = project.urlPrefix;
            for (const user of project.cc) {
                cc.push(user);
            }
        } else if (await commitExists("cb07fc2a29c86d1bc11", workDir) &&
            await revParse(`${baseCommit}:git-gui.sh`, workDir) !== undefined) {
            // Git GUI
            to = "--to=git@vger.kernel.org";
            cc.push("Pratyush Yadav <me@yadavpratyush.com>");
            upstreamBranch = "git-gui/master";
        } else if (await commitExists("e83c5163316f89bfbde", workDir)) {
            // Git
            to = "--to=git@vger.kernel.org";
            // Do *not* Cc: Junio Hamano by default
            upstreamBranch = "upstream/seen";
            if (await git(["rev-list", branchName + ".." + upstreamBranch], { workDir })) {
                upstreamBranch = "upstream/next";
            }
            if (await git(["rev-list", branchName + ".." + upstreamBranch], { workDir })) {
                upstreamBranch = "upstream/master";
            }
            midUrlPrefix = "https://lore.kernel.org/git/";
        } else if (await commitExists("a3acbf46947e52ff596", workDir)) {
            // Cygwin
            to = "--to=cygwin-patches@cygwin.com";
            upstreamBranch = "cygwin/master";
            midUrlPrefix = "https://www.mail-archive.com/search?l=cygwin-patches@cygwin.com&q=";
        } else if (await commitExists("cc8ed39b240180b5881", workDir)) {
            // BusyBox
            to = "--to=busybox@busybox.net";
            upstreamBranch = "busybox/master";
            midUrlPrefix = "https://www.mail-archive.com/search?l=busybox@busybox.net&q=";
        } else if (await commitExists("7ccd18012de2e6c47e5", workDir)) {
            // We're running in the test suite!
            to = "--to=reviewer@example.com";
            upstreamBranch = "master";
            midUrlPrefix = "https://dummy.com/?mid=";
        } else {
            throw new Error("Unrecognized project");
        }

        if (basedOn) {
            upstreamBranch = basedOn;
        }

        if (!baseCommit &&
            await git(["rev-list", branchName + ".." + upstreamBranch], { workDir })) {
            throw new Error(`Branch ${branchName} is not rebased to ${upstreamBranch}`);
        }

        return new ProjectOptions(branchName, upstreamBranch, basedOn, publishToRemote, to, cc, midUrlPrefix,
                                  workDir, baseCommit);
    }

    protected static async determineBaseBranch(workDir: string, branchName: string, publishToRemote?: string):
        Promise<string | undefined> {
        const basedOn = await gitConfig(`branch.${branchName}.basedon`, workDir);
        if (!basedOn || !await commitExists(basedOn, workDir)) {
            return undefined;
        }

        if (!publishToRemote) {
            throw new Error("Need a remote to publish to");
        }

        const remoteRef = `refs/remotes/${publishToRemote}/${basedOn}`;
        if (!await commitExists(remoteRef, workDir)) {
            throw new Error(`${basedOn} not pushed to ${publishToRemote}`);
        }

        const commit = await git(["rev-parse", "-q", "--verify", remoteRef], { workDir });
        if (await git(["rev-parse", basedOn]) !== commit) {
            throw new Error(`${basedOn} on ${publishToRemote} disagrees with local branch`);
        }

        return basedOn;
    }

    protected static async getCc(branchName: string, workDir: string): Promise<string[]> {
        // Cc: from config
        const cc: string[] = [];
        const forEach = (email: string): void => {
            if (email) {
                cc.push(email);
            }
        };
        await gitConfigForEach(`branch.${branchName}.cc`, forEach, workDir);
        return cc;
    }

    public readonly branchName: string;
    public readonly upstreamBranch: string;
    public readonly baseCommit: string;
    public readonly basedOn?: string;
    public readonly publishToRemote?: string;
    public readonly workDir: string;

    public readonly to: string;
    public readonly cc: string[];
    public readonly midUrlPrefix: string;

    protected constructor(branchName: string, upstreamBranch: string, basedOn: string | undefined,
                          publishToRemote: string | undefined, to: string, cc: string[], midUrlPrefix: string,
                          workDir: string, baseCommit?: string) {
        this.branchName = branchName;
        this.upstreamBranch = upstreamBranch;

        this.baseCommit = baseCommit || upstreamBranch;

        this.basedOn = basedOn;
        this.publishToRemote = publishToRemote;
        this.workDir = workDir;

        this.to = to;
        this.cc = cc;
        this.midUrlPrefix = midUrlPrefix;
    }
}
