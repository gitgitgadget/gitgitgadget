import { IConfig } from "./project-config.js";

const defaultConfig: IConfig = {
    repo: {
        name: "git",
        owner: "gitgitgadget",
        baseOwner: "git",
        testOwner: "dscho",
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
        public_inbox_epoch: 1,
        mirrorURL: "https://github.com/gitgitgadget/git-mailing-list-mirror",
        mirrorRef: "refs/heads/lore-1",
        descriptiveName: "lore.kernel/git",
    },
    mail: {
        author: "GitGitGadget",
        sender: "GitGitGadget",
        smtpUser: "gitgitgadget@gmail.com",
        smtpHost: "smtp.gmail.com",
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
    syncUpstreamBranches: [
        {
            sourceRepo: "gitster/git",
            targetRepo: "gitgitgadget/git",
            sourceRefRegex: "^refs/heads/(maint-\\d|[a-z][a-z]/)",
        },
        {
            sourceRepo: "j6t/git-gui",
            targetRepo: "gitgitgadget/git",
            targetRefNamespace: "git-gui/",
        },
    ],
};

export default defaultConfig;
