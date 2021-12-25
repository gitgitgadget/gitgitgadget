import addressparser = require("nodemailer/lib/addressparser");
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
        const checks = await this.client.rest.checks.create({
            completed_at: completedAt,
            conclusion: "success",
            details_url: url,
            head_sha: originalCommit,
            name: "upstream commit",
            output: {
                summary: `Integrated into git.git as [${
                    short}](${url}).`,
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
     * Add a cc to a Pull Request
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {string} cc to add
     * @returns the comment ID and the URL to the comment
     */
    public async addPRCc(pullRequestURL: string, cc: string):
        Promise<void> {
        const id = cc.match(/<(.*)>/);

        if (!id || id[1] === "gitster@pobox.com") {
            return;
        }

        const ccLower = id[1].toLowerCase();
        const url = GitGitGadget.parsePullRequestURL(pullRequestURL);
        const pr = await this.getPRInfo(url[0], url[2]);
        const trimBody = pr.body.trimRight();
        let footer = trimBody.match(/^[^]+\r?\n\s*?\r?\n([^]+)$/);

        // handle PR descriptions that have no body, just footers
        if (!footer && !trimBody.match(/\r?\n\r?\n/)) {
            footer = trimBody.match(/^([a-z][-a-z0-9]+:\s*[^]+)$/i);
        }

        let found = false;
        let footerSeparator = "\r\n";

        if (footer && footer[1].match(/:/)) try {
            footer[1].split(/\r?\n/).reverse().forEach(line => {
                const match = line.match(/^([a-z][-a-z0-9]+):\s*(.*)$/i);

                if (!match) {       // stop if not a footer
                    throw new Error("No Footer");
                }

                footerSeparator = ""; // body already has footers
                if (!found && match[1].toLowerCase() === "cc") try {
                    addressparser(match[2], {flatten: true}).forEach(email => {
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
            found = false;          // ensure it was not a cc: false positive
            footerSeparator = "\r\n"; // reset
        }

        if (!found) {
            const user = await this.getGitHubUserInfo(pr.author);

            if (!user.email || ccLower !== user.email.toLowerCase()) {
                await this.updatePR(url[0], url[2], `${trimBody}${
                    footerSeparator}\r\ncc: ${cc}`);
                await this.addPRComment(pullRequestURL, `User \`${
                                        cc}\` has been added to the cc: list.`);
            }
        }
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
        const status = await this.client.rest.issues.createComment({
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

        const status = await this.client.rest.pulls.createReviewComment({
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

        const status = await this.client.rest.pulls.createReplyForReviewComment(
            {
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

    /**
     * Update a Pull Request body or title
     *
     * @param {string} pullRequestURL the Pull Request to comment on
     * @param {string} body the updated body
     * @param {string} title the updated title
     * @returns the PR number
     */
    public async updatePR(owner: string, prNumber: number,
                          body?: string | undefined, title?: string):
        Promise<number> {

        await this.ensureAuthenticated(owner);
        const result = await this.client.rest.pulls.update({
            "body": body || undefined,
            owner,
            pull_number: prNumber,
            repo: this.repo,
            "title": title || undefined,
        });

        return result.data.id;
    }

    public async addPRLabels(pullRequestURL: string, labels: string[]):
        Promise<string[]> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated(owner);
        const result = await this.client.rest.issues.addLabels({
            issue_number: prNo,
            labels,
            owner,
            repo,
        });
        return result.data.map((res: { id: number }) => `${res.id}`);
    }

    public async closePR(pullRequestURL: string, viaMergeCommit: string):
        Promise<number> {
        const [owner, repo, prNo] =
            GitGitGadget.parsePullRequestURL(pullRequestURL);

        await this.ensureAuthenticated(owner);
        await this.client.rest.pulls.update({
            owner,
            pull_number: prNo,
            repo,
            state: "closed",
        });

        const result = await this.client.rest.issues.createComment({
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
        const response = await this.client.rest.pulls.list({
            owner: repositoryOwner,
            per_page: 1000,
            repo: this.repo,
            state: "open",
        });

        response.data.map((pr) => {
            if (!pr.user || !pr.base.repo.owner) {
                throw new Error(`PR ${pr.number} is missing information. ${
                    pr.toString()}`);
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
        const response = await this.client.rest.pulls.get({
            owner: repositoryOwner,
            pull_number: prNumber,
            repo: this.repo,
        });

        const pullRequest = response.data;
        if (!pullRequest.user) {
            throw new Error(`PR ${pullRequest.number} is missing information. ${
                pullRequest.toString()}`);
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
        const response = await this.client.rest.issues.getComment({
            comment_id: commentID,
            owner: repositoryOwner,
            repo: this.repo,
        });
        const match = response.data.html_url.match(/\/pull\/([0-9]+)/);
        const prNumber = match ? parseInt(match[1], 10) : -1;

        if (!response.data.user) {
            throw new Error(`PR ${prNumber} comment is missing information. ${
                response.data.toString()}`);
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
    public async getPRCommits(repositoryOwner: string, prNumber: number):
         Promise<IPRCommit[]> {
        const response = await this.client.rest.pulls.listCommits({
            owner: repositoryOwner,
            pull_number: prNumber,
            repo: this.repo,
        });
        const result: IPRCommit[] = [];
        response.data.map((cm) => {
            if (!cm.commit.committer || !cm.commit.author || !cm.sha) {
                throw new Error(`Commit information missing for PR ${
                    prNumber} - ${cm.toString()}`);
            }

            const committer = cm.commit.committer;
            const author = cm.commit.author

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
        await this.ensureAuthenticated(this.authenticated || "gitgitgadget");

        const response = await this.client.rest.users.getByUsername({
            username: login,
        });

        if (response.status === 200 ) {
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
