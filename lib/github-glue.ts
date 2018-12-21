import octokit = require("@octokit/rest");
import { git, gitConfig } from "./git";
import { GitGitGadget } from "./gitgitgadget";

export interface IPullRequestInfo {
    pullRequestURL: string;
    author: string;
    title: string;
    body: string;
    baseLabel: string;
    baseCommit: string;
    headLabel: string;
    headCommit: string;
    mergeable: boolean;
}

export interface IPRComment {
    author: string;
    body: string;
    prNumber: number;
}
export class GitHubGlue {
    public workDir?: string;
    protected readonly client = new octokit();
    protected authenticated = false;

    public constructor(workDir?: string) {
        this.workDir = workDir;
    }

    public async annotateCommit(originalCommit: string, gitGitCommit: string):
        Promise<number> {
        const output =
            await git(["show", "-s", "--format=%h %cI", gitGitCommit],
                      { workDir: this.workDir });
        const match = output.match(/^(\S+) (\S+)$/);
        if (!match) {
            throw new Error(`Could not find ${gitGitCommit}: '${output}'`);
        }
        const [, short, completedAt] = match;
        const url = `https://github.com/git/git/commit/${gitGitCommit}`;

        await this.ensureAuthenticated();
        const checks = await this.client.checks.create({
            completed_at: completedAt,
            conclusion: "success",
            details_url: url,
            head_sha: originalCommit,
            name: "upstream commit",
            output: {
                // tslint:disable-next-line:max-line-length
                summary: `Integrated into git.git as [${short}](${url}).`,
                title: `In git.git: ${short}`,
            },
            owner: "gitgitgadget",
            repo: "git",
            status: "completed",
        });
        return checks.data.id;
    }

    /**
     * Add a Pull Request comment
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {string} comment the comment
     * @returns the URL to the comment
     */
    public async addPRComment(pullRequestURL: string, comment: string):
        Promise<string> {
        await this.ensureAuthenticated();
        const [owner, repo, nr] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);
        const status = await this.client.issues.createComment({
            body: comment,
            number: nr,
            owner,
            repo,
        });
        return status.data.html_url;
    }

    public async setPRLabels(pullRequestURL: string, labels: string[]):
        Promise<string[]> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated();
        const result = await this.client.issues.addLabels({
            labels,
            number: prNo,
            owner,
            repo,
        });
        return result.data.map((res: any) => res.id);
    }

    public async closePR(pullRequestURL: string, viaMergeCommit: string):
        Promise<number> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated();
        await this.client.pullRequests.update({
            number: prNo,
            owner,
            repo,
            state: "closed",
        });

        const result = await this.client.issues.createComment({
            body: `Closed via ${viaMergeCommit}.`,
            number: prNo,
            owner,
            repo,
        });
        return result.data.id;
    }

    // The following public methods do not require authentication

    public async getOpenPRs(): Promise<IPullRequestInfo[]> {
        const result: IPullRequestInfo[] = [];
        const response = await this.client.pullRequests.getAll({
            owner: "gitgitgadget",
            per_page: 1000,
            repo: "git",
            state: "open",
        });
        response.data.map((pr: octokit.PullRequestsGetAllResponseItem) => {
            result.push({
                author: pr.user.login,
                baseCommit: pr.base.sha,
                baseLabel: pr.base.label,
                body: pr.body,
                headCommit: pr.head.sha,
                headLabel: pr.head.label,
                mergeable: true,
                pullRequestURL: pr.html_url,
                title: pr.title,
            });
        });
        return result;
    }

    /**
     * Retrieve a Pull Request's information relevant to GitGitGadget's
     * operations.
     *
     * @param prNumber the Pull Request's number
     * @returns information about that Pull Request
     */
    public async getPRInfo(prNumber: number): Promise<IPullRequestInfo> {
        const response = await this.client.pullRequests.get({
            number: prNumber,
            owner: "gitgitgadget",
            repo: "git",
        });
        return {
            author: response.data.user.login,
            baseCommit: response.data.base.sha,
            baseLabel: response.data.base.label,
            body: response.data.body,
            headCommit: response.data.head.sha,
            headLabel: response.data.head.label,
            mergeable: response.data.mergeable,
            pullRequestURL: response.data.html_url,
            title: response.data.title,
        };
    }

    /**
     * Retrieves the body of the specified PR/issue comment.
     *
     * @param commentID the ID of the PR/issue comment
     * @returns the text in the comment
     */
    public async getPRComment(commentID: number): Promise<IPRComment> {
        const response = await this.client.issues.getComment({
            comment_id: commentID,
            owner: "gitgitgadget",
            repo: "git",
        });
        const match = response.data.html_url.match(/\/pull\/([0-9]+)/);
        const prNumber = match ? parseInt(match[1], 10) : -1;
        return {
            author: response.data.user.login,
            body: response.data.body,
            prNumber,
        };
    }

    /**
     * Obtain the full name (if any) for a given GitHub user.
     *
     * @param login the GitHub login
     */
    public async getGitHubUserName(login: string): Promise<string> {
        const response = await this.client.users.getForUser({
            username: login,
        });
        return response.data.name;
    }

    protected async ensureAuthenticated(): Promise<void> {
        if (!this.authenticated) {
            const token = await gitConfig("gitgitgadget.githubToken");
            if (!token) {
                throw new Error(`Need a GitHub token`);
            }
            this.client.authenticate({
                token,
                type: "token",
            });
            this.authenticated = true;
        }
    }
}
