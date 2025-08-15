import addressparser from "nodemailer/lib/addressparser/index.js";
import { Octokit } from "@octokit/rest";
import { git, gitConfig } from "./git.js";
import { getPullRequestKey, pullRequestKeyInfo, pullRequestKey } from "./pullRequestKey.js";
export { RequestError } from "@octokit/request-error";

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
    draft: boolean;
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
    email: string | null; // null if no public email
    login: string;
    name: string;
    type: string;
}

export class GitHubGlue {
    public workDir: string;
    protected client: Octokit = new Octokit(); // add { log: console } to debug
    protected authenticated?: string;
    protected owner: string;
    protected repo: string;
    private tokens: Map<string, string> = new Map();

    public constructor(workDir: string, owner: string, repo: string) {
        this.owner = owner;
        this.repo = repo;
        this.workDir = workDir;
    }

    public async annotateCommit(
        originalCommit: string,
        gitGitCommit: string,
        repositoryOwner: string,
        baseOwner: string,
    ): Promise<number> {
        const output = await git(["show", "-s", "--format=%h %cI", gitGitCommit], { workDir: this.workDir });
        const match = output.match(/^(\S+) (\S+)$/);
        if (!match) {
            throw new Error(`Could not find ${gitGitCommit}: '${output}'`);
        }
        const [, short, completedAt] = match;
        const url = `https://github.com/${baseOwner}/${this.repo}/commit/${gitGitCommit}`;

        await this.ensureAuthenticated(repositoryOwner);
        const checks = await this.client.rest.checks.create({
            completed_at: completedAt,
            conclusion: "success",
            details_url: url,
            head_sha: originalCommit,
            name: "upstream commit",
            output: {
                summary: `Integrated into ${baseOwner}.${this.repo} as [${short}](${url}).`,
                title: `In ${baseOwner}.${this.repo}: ${short}`,
            },
            owner: repositoryOwner,
            repo: this.repo,
            started_at: completedAt,
            status: "completed",
        });
        return checks.data.id;
    }

    /**
     * Add a cc to a Pull Request
     *
     * @param {pullRequestKeyInfo} pullRequest - the Pull Request to comment on
     * @param {string} cc to add
     * @returns the comment ID and the URL to the comment
     */
    public async addPRCc(pullRequest: pullRequestKeyInfo, cc: string): Promise<void> {
        const id = cc.match(/<(.*)>/);

        if (!id || id[1] === "gitster@pobox.com") {
            return;
        }

        const ccLower = id[1].toLowerCase();
        const prKey = getPullRequestKey(pullRequest);

        const pr = await this.getPRInfo(prKey);

        const trimBody = pr.body.trimRight();
        let footer = trimBody.match(/^[^]+\r?\n\s*?\r?\n([^]+)$/);

        // handle PR descriptions that have no body, just footers
        if (!footer && !trimBody.match(/\r?\n\r?\n/)) {
            footer = trimBody.match(/^([a-z][-a-z0-9]+:\s*[^]+)$/i);
        }

        let found = false;
        let footerSeparator = "\r\n";

        if (footer && footer[1].match(/:/))
            try {
                footer[1]
                    .split(/\r?\n/)
                    .reverse()
                    .forEach((line) => {
                        const match = line.match(/^([a-z][-a-z0-9]+):\s*(.*)$/i);

                        if (!match) {
                            // stop if not a footer
                            throw new Error("No Footer");
                        }

                        footerSeparator = ""; // body already has footers
                        if (!found && match[1].toLowerCase() === "cc")
                            try {
                                addressparser(match[2], { flatten: true }).forEach((email) => {
                                    if (ccLower === email.address.toLowerCase()) {
                                        found = true;
                                        throw new Error("Found");
                                    }
                                });
                            } catch (_) {
                                // quick exit for cc matched (comment to quiet linter)
                            }
                    });
            } catch (_) {
                found = false; // ensure it was not a cc: false positive
                footerSeparator = "\r\n"; // reset
            }

        if (!found) {
            const user = await this.getGitHubUserInfo(pr.author);

            if (!user.email || ccLower !== user.email.toLowerCase()) {
                await this.updatePR(prKey, `${trimBody}${footerSeparator}\r\ncc: ${cc}`);
                await this.addPRComment(prKey, `User \`${cc}\` has been added to the cc: list.`);
            }
        }
    }

    /**
     * Add a Pull Request comment
     *
     * @param {pullRequestKeyInfo} pullRequest - the Pull Request to comment on
     * @param {string} comment the comment
     * @returns the comment ID and the URL to the comment
     */
    public async addPRComment(pullRequest: pullRequestKeyInfo, comment: string): Promise<{ id: number; url: string }> {
        const prKey = getPullRequestKey(pullRequest);

        await this.ensureAuthenticated(prKey.owner);
        const status = await this.client.rest.issues.createComment({
            body: comment,
            issue_number: prKey.pull_number,
            owner: prKey.owner,
            repo: prKey.repo,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    /**
     * Add a Pull Request comment on a specific commit
     *
     * @param {pullRequestKeyInfo} pullRequest - the Pull Request to comment on
     * @param {string} commit the hash of the commit to comment on
     * @param {string} comment the comment
     * @param {number} line the comment is referencing
     * @returns the comment ID and the URL to the comment
     */
    public async addPRCommitComment(
        pullRequest: pullRequestKeyInfo,
        commit: string,
        gitWorkDir: string | undefined,
        comment: string,
        line?: number,
    ): Promise<{ id: number; url: string }> {
        const prKey = getPullRequestKey(pullRequest);

        await this.ensureAuthenticated(prKey.owner);

        const files = await git(["diff", "--name-only", `${commit}^..${commit}`, "--"], { workDir: gitWorkDir });
        const path = files.replace(/\n[^]*/, "");

        const status = await this.client.rest.pulls.createReviewComment({
            body: comment,
            commit_id: commit,
            path,
            line: line || 1,
            ...prKey,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    /**
     * Add a Pull Request comment as reply to a specific comment
     *
     * @param {pullRequestKeyInfo} pullRequest - the Pull Request to comment on
     * @param {number} id the ID of the comment to which to reply
     * @param {string} comment the comment to add
     * @returns the comment ID and the URL to the added comment
     */
    public async addPRCommentReply(
        pullRequest: pullRequestKeyInfo,
        id: number,
        comment: string,
    ): Promise<{ id: number; url: string }> {
        const prKey = getPullRequestKey(pullRequest);

        await this.ensureAuthenticated(prKey.owner);

        const status = await this.client.rest.pulls.createReplyForReviewComment({
            body: comment,
            comment_id: id,
            ...prKey,
        });
        return {
            id: status.data.id,
            url: status.data.html_url,
        };
    }

    /**
     * Update a Pull Request body or title
     *
     * @param {pullRequestKey} prKey - the Pull Request to update
     * @param {string} body the updated body
     * @param {string} title the updated title
     * @returns the PR number
     */
    public async updatePR(prKey: pullRequestKey, body?: string, title?: string): Promise<number> {
        await this.ensureAuthenticated(prKey.owner);

        const result = await this.client.rest.pulls.update({
            body,
            title,
            ...prKey,
        });

        return result.data.id;
    }

    public async addPRLabels(pullRequest: pullRequestKeyInfo, labels: string[]): Promise<string[]> {
        const prKey = getPullRequestKey(pullRequest);

        await this.ensureAuthenticated(prKey.owner);
        const result = await this.client.rest.issues.addLabels({
            issue_number: prKey.pull_number,
            labels,
            owner: prKey.owner,
            repo: prKey.repo,
        });
        return result.data.map((res: { id: number }) => `${res.id}`);
    }

    public async closePR(pullRequest: pullRequestKeyInfo, viaMergeCommit: string): Promise<number> {
        const prKey = getPullRequestKey(pullRequest);

        await this.ensureAuthenticated(prKey.owner);
        await this.client.rest.pulls.update({
            state: "closed",
            ...prKey,
        });

        const result = await this.client.rest.issues.createComment({
            body: `Closed via ${viaMergeCommit}.`,
            issue_number: prKey.pull_number,
            owner: prKey.owner,
            repo: prKey.repo,
        });
        return result.data.id;
    }

    // The following public methods do not require authentication

    public async getOpenPRs(repositoryOwner: string): Promise<IPullRequestInfo[]> {
        const result: IPullRequestInfo[] = [];
        const response = await this.client.rest.pulls.list({
            owner: repositoryOwner,
            per_page: 1000,
            repo: this.repo,
            state: "open",
        });

        response.data.map((pr) => {
            if (!pr.user || !pr.base.repo.owner) {
                throw new Error(`PR ${pr.number} is missing information.\n${JSON.stringify(pr, null, 2)}`);
            }

            result.push({
                author: pr.user.login,
                baseCommit: pr.base.sha,
                baseLabel: pr.base.label,
                baseOwner: pr.base.repo.owner.login,
                baseRepo: pr.base.repo.name,
                body: pr.body || "",
                hasComments: pr.updated_at !== pr.created_at,
                headCommit: pr.head.sha,
                headLabel: pr.head.label,
                mergeable: true,
                number: pr.number,
                pullRequestURL: pr.html_url,
                title: pr.title,
                draft: false,
            });
        });
        return result;
    }

    /**
     * Retrieve a Pull Request's information relevant to GitGitGadget's operations.
     *
     * @param prKey the Pull Request's basic id (owner, repo, number)
     * @returns information about that Pull Request
     */
    public async getPRInfo(prKey: pullRequestKey): Promise<IPullRequestInfo> {
        const response = await this.client.rest.pulls.get({ ...prKey });

        const pullRequest = response.data;
        if (!pullRequest.user) {
            throw new Error(
                `PR ${pullRequest.number} is missing information.\n${JSON.stringify(pullRequest, null, 2)}`,
            );
        }

        return {
            author: pullRequest.user.login,
            baseCommit: pullRequest.base.sha,
            baseLabel: pullRequest.base.label,
            baseOwner: pullRequest.base.repo.owner.login,
            baseRepo: pullRequest.base.repo.name,
            body: pullRequest.body || "",
            commits: pullRequest.commits,
            hasComments: pullRequest.comments > 0,
            headCommit: pullRequest.head.sha,
            headLabel: pullRequest.head.label,
            mergeable: pullRequest.mergeable || true,
            number: pullRequest.number,
            pullRequestURL: pullRequest.html_url,
            title: pullRequest.title,
            draft: pullRequest.draft || false,
        };
    }

    /**
     * Retrieves the body of the specified PR/issue comment.
     *
     * @param commentID the ID of the PR/issue comment
     * @returns the text in the comment
     */
    public async getPRComment(repositoryOwner: string, commentID: number): Promise<IPRComment> {
        const response = await this.client.rest.issues.getComment({
            comment_id: commentID,
            owner: repositoryOwner,
            repo: this.repo,
        });
        const match = response.data.html_url.match(/\/pull\/([0-9]+)/);
        const prNumber = match ? parseInt(match[1], 10) : -1;

        if (!response.data.user) {
            throw new Error(
                `PR ${prNumber} comment is missing information.\n${JSON.stringify(response.data, null, 2)}`,
            );
        }

        return {
            author: response.data.user.login,
            body: response.data.body || "",
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
    public async getPRCommits(repositoryOwner: string, prNumber: number): Promise<IPRCommit[]> {
        const response = await this.client.rest.pulls.listCommits({
            owner: repositoryOwner,
            pull_number: prNumber,
            repo: this.repo,
        });
        const result: IPRCommit[] = [];
        response.data.map((cm) => {
            if (!cm.commit.committer || !cm.commit.author || !cm.sha) {
                throw new Error(`Commit information missing for PR ${prNumber}:\n${JSON.stringify(cm, null, 2)}`);
            }

            const committer = cm.commit.committer;
            const author = cm.commit.author;

            result.push({
                author: {
                    email: author.email || "unknown email",
                    login: cm.author ? cm.author.login : "unknown login",
                    name: author.name || "unknown name",
                },
                commit: cm.sha,
                committer: {
                    email: committer.email || "unknown email",
                    login: cm.committer ? cm.committer.login : "unknown login",
                    name: committer.name || "unknown name",
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
        await this.ensureAuthenticated(this.authenticated || this.owner);

        const response = await this.client.rest.users.getByUsername({
            username: login,
        });

        if (response.status === 200) {
            return {
                email: response.data.email,
                login: response.data.login,
                name: response.data.name || "",
                type: response.data.type,
            };
        } else {
            throw new Error(`GitHub unresponsive for getByUsername`);
        }
    }

    public setAccessToken(repositoryOwner: string, token: string): void {
        this.tokens.set(repositoryOwner, token);
    }

    protected async ensureAuthenticated(repositoryOwner: string): Promise<void> {
        if (repositoryOwner !== this.authenticated) {
            let token = this.tokens.get(repositoryOwner);
            if (!token) {
                const infix = repositoryOwner === "gitgitgadget" ? "" : `.${repositoryOwner}`;
                const tokenKey = `gitgitgadget${infix}.githubToken`;
                const tokenVar = tokenKey.toUpperCase().replace(/\./, "_");
                token = process.env[tokenVar] ? process.env[tokenVar] : await gitConfig(tokenKey);
            }
            if (!token) {
                throw new Error(`Need a GitHub token for ${repositoryOwner}`);
            }
            this.client = new Octokit({ auth: token }); // add log: console to debug
            this.authenticated = repositoryOwner;
        }
    }
}
