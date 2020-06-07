import { Octokit } from "@octokit/rest";
import { beforeAll, expect, jest, test } from "@jest/globals";
import { git, gitConfig } from "../lib/git";
import { GitHubGlue } from "../lib/github-glue";

/*
This test requires setup.  It will run successfully if setup has
not been done.  If the test fails, there may be a pull request and a
branch to be deleted on github and the local repo.  The test will
attempt cleanup of a previously failed test.

Setup:
gitgitgadget.githubtest.githubuser must be configured for this test to
identify your GitHub login.
The value must also be configured to identify a test repo to use as
gitgitgadget.<login>.githubrepo.

Additionally, a GitHub personal access token must be set for the
login to succeed.  This can be restricted to the test repo.

For example, these configuration settings are needed (where
`octokity` is your GitHub login):
git config --add gitgitgadget.githubtest.githubuser octokity
git config --add gitgitgadget.octokity.githubrepo ggg-test
git config --add gitgitgadget.octokity.githubtoken feedbeef...

The test repo must exist in github and locally.  It is expected to be
located at the same directory level as this project (ie ../).
*/

class GitHubProxy extends GitHubGlue {
    public octo: Octokit | any;
    public constructor(workDir?: string, repo = "git") {
        super(workDir, repo);
        this.octo = this.client;
    }

    public async authenticate(repositoryOwner: string): Promise<void> {
        await this.ensureAuthenticated(repositoryOwner);
        this.octo = this.client;
    }
}

jest.setTimeout(180000);

let owner: string;
let repo: string;

beforeAll(async () => {
    owner = await gitConfig(`gitgitgadget.githubtest.githubuser`) || "";
    repo = await gitConfig(`gitgitgadget.${owner}.githubrepo`) || "";
});

test("identify user", async () => {
    if (owner && repo) {
        const userName = await gitConfig(`user.name`, `../${repo}`) || "";

        const github = new GitHubProxy(`../${repo}`, repo);
        await github.authenticate(owner);

        const name = await github.getGitHubUserName(owner);
        expect(name).toMatch(userName);

        const ghUser = await github.getGitHubUserInfo(owner);
        expect(ghUser.login).toMatch(owner);
        expect(ghUser.name).toMatch(userName);
    }
});

test("pull requests", async () => {
    if (owner && repo) {
        const repoDir = `../${repo}`;

        const github = new GitHubProxy(repoDir, repo);
        await github.authenticate(owner);
        const content = Buffer.from("test data").toString("base64");

        const branch = "test-branch";
        const branchRef = `refs/heads/${branch}`;
        const title = "Test pulls integration";

        const oldPrs = await github.getOpenPRs(owner);
        let pullRequestURL = "";

        // Clean up in case a previous test failed

        oldPrs.map(pr => {
            if (pr.title === title) { // need to clean up?
                pullRequestURL = pr.pullRequestURL;
            }
        });

        if (pullRequestURL.length) {
            await github.closePR(pullRequestURL, "Not merged");
        }

        try {                       // delete remote branch
            await github.octo.git.deleteRef({
                owner,
                ref: `heads/${branch}`,
                repo,
                });
        } catch (error) {
            expect(error.toString()).toMatch(/Reference does not exist/);
        }

        try {                       // delete local branch
            await git(["branch", "-D", branch], { workDir: repoDir });
        } catch (error) {
            expect(error.toString()).toMatch(/not found/);
        }

        const gRef = await github.octo.git.getRef({
            owner,
            ref: `heads/master`,
            repo,
        });

        const cRef = await github.octo.git.createRef({
            owner,
            ref: branchRef,
            repo,
            sha: gRef.data.object.sha,
        });

        expect(cRef.data.object.sha).toMatch(gRef.data.object.sha);

        const cFile = await github.octo.repos.createOrUpdateFile({
            branch,
            content,
            message: "Commit a new file",
            owner,
            path: "foo.txt",
            repo,
        });

        const newPR = await github.octo.pulls.create({
            base: "master",
            body: "Test for a pull request\r\non a test repo.",
            head: branch,
            owner,
            repo,
            title,
        });

        const prData = newPR.data;

        const prs = await github.getOpenPRs(owner);
        expect(prs[0].author).toMatch(owner);

        const commits = await github.getPRCommits(owner, prData.number);
        expect(commits[0].author.login).toMatch(owner);
        expect(cFile.data.commit.sha).toMatch(commits[0].commit);

        const prInfo = await github.getPRInfo(owner, prData.number);
        expect(prInfo.headLabel).toMatch(branch);

        const newComment = "Adding a comment to the PR";
        const {id, url} = await github.addPRComment(prData.html_url,
                                                    newComment);
        expect(url).toMatch(id.toString());

        const comment = await github.getPRComment(owner, id);
        expect(comment.body).toMatch(newComment);

        // update the local repo to test commit comment
        await git(["fetch", "origin", "--", `+${branchRef}:${branchRef}`],
                  { workDir: repoDir });

        const commitComment = "comment about commit";
        const reviewResult = await github
            .addPRCommitComment(prData.html_url, cFile.data.commit.sha,
                                repoDir, commitComment);

        const commentReply =
            await github.addPRCommentReply(prData.html_url,
                                           reviewResult.id, newComment);

        expect(commentReply.url).toMatch(commentReply.id.toString());

        await github.setPRLabels(prData.html_url, ["bug"]);

        const cNumber = await github.closePR(prData.html_url, "Not merged");
        expect(cNumber).toBeGreaterThan(id);

        // delete local and remote branches
        try {
            await github.octo.git.deleteRef({
                owner,
                ref: `heads/${branch}`,
                repo,
            });

            await git(["branch", "-D", branch], { workDir: repoDir });
        } catch (error) {
            console.log(`commmand failed\n${error}`);
        }
    }
});
