import octokit = require("@octokit/rest");
import { git, gitConfig } from "./git";
import { GitGitGadget } from "./gitgitgadget";

export interface IPullRequestInfo {
    pullRequestURL: string;
    title: string;
    baseCommit: string;
    headCommit: string;
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
        const output = await git([
            "show", "-s", "--format=%h %cI", gitGitCommit,
        ], { workDir: this.workDir });
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
        response.data.map((pr: any) => {
            result.push({
                baseCommit: pr.base.sha,
                headCommit: pr.head.sha,
                pullRequestURL: pr.html_url,
                title: pr.title,
            });
        });
        return result;
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
