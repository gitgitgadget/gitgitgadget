import { IConfig, setConfig } from "./project-config.js";

const defaultConfig: IConfig = {
    repo: {
        name: "git",
        owner: "gitgitgadget",
        baseOwner: "git",
        owners: ["gitgitgadget", "git", "dscho"],
        branches: ["maint", "seen"],
        closingBranches: ["maint", "master"],
        trackingBranches: ["maint", "seen", "master", "next"],
        maintainerBranch: "gitster",
        host: "github.com",
    },
    mailrepo: {
        name: "git",
        owner: "gitgitgadget",
        branch: "master",
        host: "lore.kernel.org",
        url: "https://lore.kernel.org/git/",
        descriptiveName: "lore.kernel/git",
    },
    mail: {
        author: "GitGitGadget",
        sender: "GitGitGadget",
    },
    app: {
        appID: 12836,
        installationID: 195971,
        name: "gitgitgadget",
        displayName: "GitGitGadget",
        altname: "gitgitgadget-git",
    },
    lint: {
        maxCommitsIgnore: ["https://github.com/gitgitgadget/git/pull/923"],
        maxCommits: 30,
    },
    user: {
        allowUserAsLogin: false,
    },
};

export default defaultConfig;

setConfig(defaultConfig);

export function getConfig(): IConfig {
    return setConfig(defaultConfig);
}
