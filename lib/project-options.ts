import { commitExists, git, revParse } from "./git.js";
import defaultConfig from "./gitgitgadget-config.js";
import { IConfig, projectInfo } from "./project-config.js";

// For now, only the Git, Cygwin and BusyBox projects are supported
export class ProjectOptions {
    public static async get(
        workDir: string,
        branchName: string,
        cc: string[],
        basedOn?: string,
        publishToRemote?: string,
        baseCommit?: string,
    ): Promise<ProjectOptions> {
        const config: IConfig = defaultConfig;
        let upstreamBranch: string;
        let to: string;
        let midUrlPrefix = " Message-ID: ";

        if (Object.prototype.hasOwnProperty.call(config, "project")) {
            const project = config.project as projectInfo;
            to = `--to=${project.to}`;
            upstreamBranch = project.branch;
            midUrlPrefix = project.urlPrefix;
            for (const user of project.cc) {
                cc.push(user);
            }
        } else if ((await revParse(`${baseCommit}:git-gui.sh`, workDir)) !== undefined) {
            // Git GUI
            to = "--to=git@vger.kernel.org";
            cc.push("Johannes Sixt <j6t@kdbg.org>");
            upstreamBranch = "git-gui/master";
        } else if ((await revParse(`${baseCommit}:git.c`, workDir)) !== undefined) {
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
        } else if ((await revParse(`${baseCommit}:winsup`, workDir)) !== undefined) {
            // Cygwin
            to = "--to=cygwin-patches@cygwin.com";
            upstreamBranch = "cygwin/master";
            midUrlPrefix = "https://www.mail-archive.com/search?l=cygwin-patches@cygwin.com&q=";
        } else if ((await revParse(`${baseCommit}:include/busybox.h`, workDir)) !== undefined) {
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

        if (!baseCommit && (await git(["rev-list", branchName + ".." + upstreamBranch], { workDir }))) {
            throw new Error(`Branch ${branchName} is not rebased to ${upstreamBranch}`);
        }

        return new ProjectOptions(
            branchName,
            upstreamBranch,
            basedOn,
            publishToRemote,
            to,
            cc,
            midUrlPrefix,
            workDir,
            baseCommit,
        );
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

    protected constructor(
        branchName: string,
        upstreamBranch: string,
        basedOn: string | undefined,
        publishToRemote: string | undefined,
        to: string,
        cc: string[],
        midUrlPrefix: string,
        workDir: string,
        baseCommit?: string,
    ) {
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
