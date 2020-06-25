import { Octokit } from "@octokit/rest";
import { git, gitConfig } from "./git";
import { GitGitGadget } from "./gitgitgadget";

export interface IPullRequestInfo {
    pullRequestURL: string;
    author: string;
    title: string;
    body: string;
    baseLabel: string;
    baseCommit: string;
    baseOwner: string;
    baseRepo: string;
    commits?: number;
    hasComments: boolean;
    headLabel: string;
    headCommit: string;
    mergeable: boolean;
    number: number;
}

export interface IPRComment {
    author: string;
    body: string;
    prNumber: number;
}

export interface IPRCommit {
    author: {
        email: string;
        login: string;
        name: string;
    };
    commit: string;
    committer: {
        email: string;
        login: string;
        name: string;
    };
    message: string;
    parentCount: number;
}

export interface IGitHubUser {
    email: string | null;           // null if no public email
    login: string;
    name: string;
    type: string;
}

export class GitHubGlue {
    public workDir?: string;
    protected client = new Octokit();
    protected authenticated?: string;
    protected repo: string;

    public constructor(workDir?: string, repo = "git") {
        this.repo = repo;
        this.workDir = workDir;
    }

    public async annotateCommit(originalCommit: string, gitGitCommit: string,
                                repositoryOwner: string): Promise<number> {
        const output =
            await git(["show", "-s", "--format=%h %cI", gitGitCommit],
                      { workDir: this.workDir });
        const match = output.match(/^(\S+) (\S+)$/);
        if (!match) {
            throw new Error(`Could not find ${gitGitCommit}: '${output}'`);
        }
        const [, short, completedAt] = match;
        const url = `https://github.com/git/git/commit/${gitGitCommit}`;

        await this.ensureAuthenticated(repositoryOwner);
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
            owner: repositoryOwner,
            repo: this.repo,
            started_at: completedAt,
            status: "completed",
        });
        return checks.data.id;
    }

    /**
     * Add a Pull Request comment
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {string} comment the comment
     * @returns the comment ID and the URL to the comment
     */
    public async addPRComment(pullRequestURL: string, comment: string):
        Promise<{id: number; url: string}> {
        const [owner, repo, nr] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);
        await this.ensureAuthenticated(owner);
        const status = await this.client.issues.createComment({
            body: comment,
            issue_number: nr,
            owner,
            repo,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    /**
     * Add a Pull Request comment on a specific commit
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {string} commit the hash of the commit to comment on
     * @param {string} comment the comment
     * @returns the comment ID and the URL to the comment
     */
    public async addPRCommitComment(pullRequestURL: string,
                                    commit: string,
                                    gitWorkDir: string | undefined,
                                    comment: string):
        Promise<{id: number; url: string}> {
        const [owner, repo, nr] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);
        await this.ensureAuthenticated(owner);

        const files = await git(["diff", "--name-only",
                                 `${commit}^..${commit}`, "--"],
                                {workDir: gitWorkDir});
        const path = files.replace(/\n[^]*/, "");

        const status = await this.client.pulls.createReviewComment({
            body: comment,
            commit_id: commit,
            owner,
            path,
            position: 1,
            pull_number: nr,
            repo,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    /**
     * Add a Pull Request comment as reply to a specific comment
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {number} id the ID of the comment to which to reply
     * @param {string} comment the comment to add
     * @returns the comment ID and the URL to the added comment
     */
    public async addPRCommentReply(pullRequestURL: string, id: number,
                                   comment: string):
        Promise<{id: number, url: string}> {
        const [owner, repo, nr] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);
        await this.ensureAuthenticated(owner);

        const status = await this.client.pulls.createReplyForReviewComment({
            body: comment,
            comment_id: id,
            owner,
            pull_number: nr,
            repo,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    public async setPRLabels(pullRequestURL: string, labels: string[]):
        Promise<string[]> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated(owner);
        const result = await this.client.issues.addLabels({
            issue_number: prNo,
            labels,
            owner,
            repo,
        });
        return result.data.map((res: any) => res.id);
    }

    public async closePR(pullRequestURL: string, viaMergeCommit: string):
        Promise<number> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated(owner);
        await this.client.pulls.update({
            owner,
            pull_number: prNo,
            repo,
            state: "closed",
        });

        const result = await this.client.issues.createComment({
            body: `Closed via ${viaMergeCommit}.`,
            issue_number: prNo,
            owner,
            repo,
        });
        return result.data.id;
    }

    // The following public methods do not require authentication

    public async getOpenPRs(repositoryOwner: string):
        Promise<IPullRequestInfo[]> {
        const result: IPullRequestInfo[] = [];
        const response = await this.client.pulls.list({
            owner: repositoryOwner,
            per_page: 1000,
            repo: this.repo,
            state: "open",
        });
        response.data.map((pr) => {
            result.push({
                author: pr.user.login,
                baseCommit: pr.base.sha,
                baseLabel: pr.base.label,
                baseOwner: pr.base.repo.owner.login,
                baseRepo: pr.base.repo.name,
                body: pr.body,
                hasComments: pr.updated_at !== pr.created_at,
                headCommit: pr.head.sha,
                headLabel: pr.head.label,
                mergeable: true,
                number: pr.number,
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
    public async getPRInfo(repositoryOwner: string, prNumber: number):
        Promise<IPullRequestInfo> {
        const response = await this.client.pulls.get({
            owner: repositoryOwner,
            pull_number: prNumber,
            repo: this.repo,
        });
        return {
            author: response.data.user.login,
            baseCommit: response.data.base.sha,
            baseLabel: response.data.base.label,
            baseOwner: response.data.base.repo.owner.login,
            baseRepo: response.data.base.repo.name,
            body: response.data.body,
            commits: response.data.commits,
            hasComments: response.data.comments > 0,
            headCommit: response.data.head.sha,
            headLabel: response.data.head.label,
            mergeable: response.data.mergeable,
            number: response.data.number,
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
    public async getPRComment(repositoryOwner: string, commentID: number):
        Promise<IPRComment> {
        const response = await this.client.issues.getComment({
            comment_id: commentID,
            owner: repositoryOwner,
            repo: this.repo,
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
     * Retrieves the commits of the specified PR.
     *
     * @param repositoryOwner owner of the GitHub repo for the pull request
     * @param prNumber the Pull Request's number
     * @returns the set of commits
     */
    public async getPRCommits(repositoryOwner: string, prNumber: number):
         Promise<IPRCommit[]> {
        const response = await this.client.pulls.listCommits({
            owner: repositoryOwner,
            pull_number: prNumber,
            repo: this.repo,
        });
        const result: IPRCommit[] = [];
        response.data.map((cm) => {
            result.push({
                author: {
                    email: cm.commit.author.email,
                    login: cm.author ? cm.author.login : "unknown login",
                    name: cm.commit.author.name,
                },
                commit: cm.sha,
                committer: {
                    email: cm.commit.committer.email,
                    login: cm.committer ? cm.committer.login : "unknown login",
                    name: cm.commit.committer.name,
                },
                message: cm.commit.message,
                parentCount: cm.parents.length,
            });
        });

        return result;
    }

    /**
     * Obtain basic information for a given GitHub user.
     *
     * @param login the GitHub login
     */
    public async getGitHubUserInfo(login: string): Promise<IGitHubUser> {
        // required to get email
        await this.ensureAuthenticated(this.authenticated || "gitgitgadget");

        const response = await this.client.users.getByUsername({
            username: login,
        });
        return {
            email: response.data.email,
            login: response.data.login,
            name: response.data.name,
            type: response.data.type,
        };
    }

    /**
     * Obtain the full name (if any) for a given GitHub user.
     *
     * @param login the GitHub login
     */
    public async getGitHubUserName(login: string): Promise<string> {
        const response = await this.client.users.getByUsername({
            username: login,
        });
        return response.data.name;
    }

    protected async ensureAuthenticated(repositoryOwner: string):
        Promise<void> {
        if (repositoryOwner !== this.authenticated) {
            const infix = repositoryOwner === "gitgitgadget" ?
                "" : `.${repositoryOwner}`;
            const token = await gitConfig(`gitgitgadget${infix}.githubToken`);
            if (!token) {
                throw new Error(`Need a GitHub token for ${repositoryOwner}`);
            }
            this.client = new Octokit({ auth: token });
            this.authenticated = repositoryOwner;
        }
    }
}
