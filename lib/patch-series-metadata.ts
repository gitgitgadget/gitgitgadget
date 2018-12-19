export type GitGitIntegrationBranch = "maint" | "master" | "next" | "pu";

export interface IPatchSeriesMetadata {
    readonly pullRequestURL?: string;
    baseCommit: string;
    baseLabel: string;
    headCommit: string;
    headLabel: string;
    iteration: number;
    coverLetterMessageId?: string;
    latestTag?: string;
    referencesMessageIds?: string[];
    tipCommitInGitGit?: string;
    branchNameInGitsterGit?: string;
    // maps to merge commit
    mergedIntoUpstream?: { [branchName: string]: string };
}
