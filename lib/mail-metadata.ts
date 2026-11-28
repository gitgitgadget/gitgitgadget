export interface IMailMetadata {
    readonly messageID: string;
    /** Object ID of the original mbox in the mailing-list mirror. */
    mailBlobOID?: string;
    pullRequestURL?: string;
    issueCommentId?: number;
    originalCommit?: string;
    commitInGitGit?: string;
    firstPatchLine?: number;
}
