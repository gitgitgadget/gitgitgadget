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

export function getPullRequestKeyFromURL(pullRequestURL: string): pullRequestKey {
    const match = pullRequestURL.match(/^https:\/\/github.com\/(.*)\/(.*)\/pull\/(\d+)$/);
    if (!match) {
        throw new Error(`Unrecognized PR URL: "${pullRequestURL}`);
    }

    return { owner: match[1], repo: match[2], pull_number: parseInt(match[3], 10) };
}
