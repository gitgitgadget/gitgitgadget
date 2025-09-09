/**
 * Helper types to identify key fields of pull request related APIs.
 *
 * Two functions are provided to extract the key fields from a formatted URL.
 */
export type pullRequestKey = {
    owner: string;
    repo: string;
    pull_number: number;
};

export type pullRequestKeyInfo = string | pullRequestKey;

export function getPullRequestKey(pullRequest: pullRequestKeyInfo): pullRequestKey {
    return typeof pullRequest === "string" ? getPullRequestKeyFromURL(pullRequest) : pullRequest;
}

export type pullRequestCommentKey = pullRequestKey & { comment_id: number };

function getPullRequestOrCommentKeyFromURL(pullRequestOrCommentURL: string): pullRequestKey & { comment_id?: number } {
    const match = pullRequestOrCommentURL.match(/^https:\/\/github.com\/(.*)\/(.*)\/pull\/(\d+)(.*)$/);
    if (!match) {
        throw new Error(`Unrecognized PR URL: "${pullRequestOrCommentURL}`);
    }
    const match2 = match[4]?.match(/^#issuecomment-(\d+)$/);
    if (match[4] && !match2) {
        throw new Error(`Unrecognized PR URL: "${pullRequestOrCommentURL}`);
    }
    return {
        owner: match[1],
        repo: match[2],
        pull_number: parseInt(match[3], 10),
        comment_id: match2 ? parseInt(match2[1], 10) : undefined,
    };
}

export function getPullRequestKeyFromURL(pullRequestURL: string): pullRequestKey {
    const { comment_id, ...prKey } = getPullRequestOrCommentKeyFromURL(pullRequestURL);
    if (comment_id) {
        throw new Error(`Expected PR URL, not a PR comment URL: `);
    }
    return prKey;
}

export function getPullRequestCommentKeyFromURL(pullRequestURL: string): pullRequestCommentKey {
    const result = getPullRequestOrCommentKeyFromURL(pullRequestURL);
    if (result.comment_id === undefined) {
        throw new Error(`Expected PR comment URL, not a PR URL: `);
    }
    return result as pullRequestCommentKey;
}
