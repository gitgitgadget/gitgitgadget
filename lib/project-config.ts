export type projectInfo = {
    to: string; // email to send patches to
    branch: string; // upstream branch a PR must be based on
    cc: string[]; // emails to always be copied on patches
    urlPrefix: string; // url to 'listserv' of mail (should it be in mailrepo?)
};

export interface IRepoConfig {
    name: string; // name of the repo
    owner: string; // owner of repo holding the notes (tracking data)
    baseOwner: string; // owner of upstream ("base") repo
    testOwner?: string; // owner of the test repo (if any)
    owners: string[]; // owners of clones being monitored (PR checking)
    branches: string[]; // remote branches to fetch - just use trackingBranches?
    closingBranches: string[]; // close if the pr is added to this branch
    trackingBranches: string[]; // comment if the pr is added to this branch
    maintainerBranch?: string; // branch/owner manually implementing changes
    host: string;
}

export interface IMailRepoConfig {
    name: string;
    owner: string;
    branch: string;
    host: string;
    url: string;
    public_inbox_epoch?: number;
    mirrorURL?: string;
    mirrorRef?: string;
    descriptiveName: string;
}
export interface IMailConfig {
    author: string;
    sender: string;
    smtpUser: string;
    smtpHost: string;
}

export interface IAppConfig {
    appID: number;
    installationID: number;
    name: string;
    displayName: string; // name to use in comments to identify app
    altname: string | undefined; // is this even needed?
}

export interface ILintConfig {
    maxCommitsIgnore?: string[]; // array of pull request urls to skip check
    maxCommits: number; // limit on number of commits in a pull request
}

export interface IUserConfig {
    allowUserAsLogin: boolean; // use GitHub login as name if name is private
}

export interface ISyncUpstreamBranchesConfig {
    sourceRepo: string; // e.g. "gitster/git"
    targetRepo: string; // e.g. "gitgitgadget/git"
    sourceRefRegex?: string; // e.g. "^refs/heads/(maint-\\d|[a-z][a-z]/)"
    targetRefNamespace?: string; // e.g. "git-gui/"
}

export interface IConfig {
    repo: IRepoConfig;
    mailrepo: IMailRepoConfig;
    mail: IMailConfig;
    project?: projectInfo | undefined; // project-options values
    app: IAppConfig;
    lint: ILintConfig;
    user: IUserConfig;
    syncUpstreamBranches: ISyncUpstreamBranchesConfig[]; // branches to sync from upstream to our repo
}
