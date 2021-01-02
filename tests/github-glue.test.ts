import { Octokit } from "@octokit/rest";
import { components } from "@octokit/openapi-types";
import { RestEndpointMethodTypes
    } from "@octokit/plugin-rest-endpoint-methods";
import { OctokitResponse } from "@octokit/types";
import { beforeAll, expect, jest, test } from "@jest/globals";
import { git, gitConfig } from "../lib/git";
import { GitHubGlue, IGitHubUser, IPullRequestInfo } from "../lib/github-glue";

/*
This test requires setup.  It will run successfully if setup has
not been done.  If the test fails, there may be a pull request and a
branch to be deleted on github and the local repo.  The test will
attempt cleanup of a previously failed test.

Setup:
gitgitgadget.githubTest.gitHubUser must be configured for this test to
identify your GitHub login.
The value must also be configured to identify a test repo to use as
gitgitgadget.<login>.gitHubRepo.

Additionally, a GitHub personal access token must be set for the
login to succeed.  This can be restricted to the test repo.

For example, these configuration settings are needed (where
`octo-kitty` is your GitHub login):
git config --add gitgitgadget.CIGitHubTestUser octo-kitty
git config --add gitgitgadget.octo-kitty.gitHubRepo ggg-test
git config --add gitgitgadget.octo-kitty.gitHubToken feedbeef...

The test repo must exist in github and locally.  It is expected to be
located at the same directory level as this project (ie ../).
*/

class GitHubProxy extends GitHubGlue {
    public octo: Octokit;
    public constructor(workDir?: string, repo = "git") {
        super(workDir, repo);
        this.octo = this.client;
    }

    public async authenticate(repositoryOwner: string): Promise<void> {
        await this.ensureAuthenticated(repositoryOwner);
        this.octo = this.client;
    }

    public fakeAuthenticated(repositoryOwner: string): void {
        this.authenticated = repositoryOwner;
    }
}

jest.setTimeout(180000);

let owner: string;
let repo: string;

beforeAll(async () => {
    owner = await gitConfig(`gitgitgadget.CIGitHubTestUser`) || "";
    repo = await gitConfig(`gitgitgadget.${owner}.gitHubRepo`) || "";
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

        const branchBase = `ggg-test-branch-${process.platform}`;
        const titleBase = `ggg Test pulls integration-${process.platform}`;

        const oldPrs = await github.getOpenPRs(owner);
        let suffix = "";

        // Clean up in case a previous test failed
        // NOTE: Runs on GitHub and Azure pipelines use a timestamped
        // branch/PR request that gets cleaned up separately.

        if (!process.env.GITHUB_WORKFLOW &&
            !process.env.hasOwnProperty("system.definitionId")) {
            let pullRequestURL = "";

            oldPrs.map(pr => {
                if (pr.title === titleBase) { // need to clean up?
                    pullRequestURL = pr.pullRequestURL;
                }
            });

            if (pullRequestURL.length) {
                await github.closePR(pullRequestURL, "Not merged");
            }

            try {                   // delete remote branch
                await github.octo.git.deleteRef({
                    owner,
                    ref: `heads/${branchBase}`,
                    repo,
                    });
            } catch (e) {
                const error = e as Error;
                expect(error.toString()).toMatch(/Reference does not exist/);
            }

            try {                   // delete local branch
                await git(["branch", "-D", branchBase], { workDir: repoDir });
            } catch (e) {
                const error = e as Error;
                expect(error.toString()).toMatch(/not found/);
            }
        }
        else
        {
            const now = new Date();
            suffix = `_${now.toISOString().replace(/[:.]/g, "_")}`;
        }

        const branch = branchBase + suffix;
        const branchRef = `refs/heads/${branch}`;
        const title = titleBase + suffix;

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

        const cFile = await github.octo.repos.createOrUpdateFileContents({
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

        // Test update to PR body
        const prBody = `${prInfo.body}\r\nGlue`;
        await github.updatePR(owner, prData.number, prBody);
        const prNewInfo = await github.getPRInfo(owner, prData.number);
        expect(prNewInfo.body).toMatch(prBody);

        // Test update to PR title
        const prTitle = `${prInfo.title} Glue`;
        await github.updatePR(owner, prData.number, undefined, prTitle);
        const prNewTitle = await github.getPRInfo(owner, prData.number);
        expect(prNewTitle.title).toMatch(prTitle);

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
            console.log(`command failed\n${error}`);
        }
    }
});

test("add PR cc requests", async () => {
    const github = new GitHubGlue();

    const prInfo = {
        author: "ggg",
        baseCommit: "A",
        baseLabel: "gitgitgadget:next",
        baseOwner: "gitgitgadget",
        baseRepo: "git",
        body: "Basic commit description.",
        hasComments: true,
        headCommit: "B",
        headLabel: "somebody:master",
        mergeable: true,
        number: 59,
        pullRequestURL: "https://github.com/webstech/gitout/pull/59",
        title: "Submit a fun fix",
    };

    const commentInfo = { id: 1, url: "ok" };
    github.addPRComment = jest.fn( async ():
        // eslint-disable-next-line @typescript-eslint/require-await
        Promise<{id: number; url: string}> => commentInfo );

    const updatePR = jest.fn( async (_owner: string, _prNumber: number,
                        body: string):
        // eslint-disable-next-line @typescript-eslint/require-await
        Promise<number> => {
        prInfo.body = body;     // set new body for next test
        return 1;
    });

    github.updatePR = updatePR;

    github.getPRInfo = jest.fn( async ():
        // eslint-disable-next-line @typescript-eslint/require-await
        Promise<IPullRequestInfo> => prInfo);

    const ghUser = {
        email: "joe_kerr@example.org",
        login: "joekerr",
        name: "Joe Kerr",
        type: "unknown",
    };

    github.getGitHubUserInfo= jest.fn( async ():
        // eslint-disable-next-line @typescript-eslint/require-await
        Promise<IGitHubUser> => ghUser);

    // Test cc update to PR
    const prCc = "Not Real <ReallyNot@saturn.cosmos>";
    const prCc2 = "Not Real <RealNot@saturn.cosmos>";
    const prCcGitster = "Git Real <gitster@pobox.com>"; // filtered out

    // Test with no linefeed
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;

    // Test with linefeeds present
    prInfo.body = `Test\r\n\r\nGlue`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    await github.addPRCc(prInfo.pullRequestURL, prCc.toLowerCase());
    expect(updatePR.mock.calls).toHaveLength(1);
    await github.addPRCc(prInfo.pullRequestURL, prCc2);
    expect(updatePR.mock.calls).toHaveLength(2);
    await github.addPRCc(prInfo.pullRequestURL, prCcGitster);
    expect(updatePR.mock.calls).toHaveLength(2);
    const prCcOwner = `${ghUser.name} <${ghUser.email}>`;
    await github.addPRCc(prInfo.pullRequestURL, prCcOwner);
    expect(updatePR.mock.calls).toHaveLength(2);
    await github.addPRCc(prInfo.pullRequestURL, prCcOwner.toUpperCase());
    expect(updatePR.mock.calls).toHaveLength(2);
    updatePR.mock.calls.length = 0;

    // Test with linefeeds and unknown footers
    prInfo.body = `Test\r\n \t\r\nbb: x\r\ncc: ${prCc}`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(0);
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(0);

    // Test with linefeeds and unknown footer containing email
    prInfo.body = `Test\r\n \t\r\nbb: ${prCc}`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;

    // Test to ignore last block in body with cc: for last line
    prInfo.body = `Test\r\n\r\nfoo\r\nCC: ${prCc}`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;

    // Test to catch only block in body is footers
    prInfo.body = `CC: ${prCc}\r\nbb: bar`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(0);

    // Test to catch only block in body is footers
    prInfo.body = `CC: ${prCc}\r\nbb: bar`;
    await github.addPRCc(prInfo.pullRequestURL, prCc2);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;

    // Test to catch only block in body is cc footer
    prInfo.body = `CC: ${prCc}; ${prCc2}`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(0);

    // Test to catch only block in body is not really footers
    prInfo.body = `foo bar\r\nCC: ${prCc}`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;

    // Test to catch only block in body is not really footers
    prInfo.body = `CC: ${prCc}\r\nfoo bar`;
    await github.addPRCc(prInfo.pullRequestURL, prCc);
    expect(updatePR.mock.calls).toHaveLength(1);
    updatePR.mock.calls.length = 0;
});

test("test missing values in response using octokit schema", async () => {
    const github = new GitHubProxy();
    github.fakeAuthenticated(owner);

    const sampleUser: components["schemas"]["simple-user"] = {
        login: "someString",
        id: 777,
        node_id: "someString",
        avatar_url: "someString",
        gravatar_id: null,
        url: "someString",
        html_url: "someString",
        followers_url: "someString",
        following_url: "someString",
        gists_url: "someString",
        starred_url: "someString",
        subscriptions_url: "someString",
        organizations_url: "someString",
        repos_url: "someString",
        events_url: "someString",
        received_events_url: "someString",
        type: "someString",
        site_admin: false,
    };

    const testRepo: components["schemas"]["repository"] = {
        id: 217630276,
        node_id: "MDEwOlJlcG9zaXRvcnkyMTc2MzAyNzY=",
        name: "gitout",
        full_name: "a/b",
        private: false,
        owner: sampleUser,
        html_url: "https://github.com/a/b",
        description: "Test repo",
        fork: false,
        url: "https://api.github.com/repos/a/b",
        forks_url: "https://api.github.com/repos/a/b/forks",
        keys_url: "https://api.github.com/repos/a/b/keys{/key_id}",
        collaborators_url: "https://api.github.com/repos/a/b/{/collaborator}",
        teams_url: "https://api.github.com/repos/a/b/teams",
        hooks_url: "https://api.github.com/repos/a/b/hooks",
        issue_events_url: "https://api.github.com/repos/a/b/{/number}",
        events_url: "https://api.github.com/repos/a/b/events",
        assignees_url: "https://api.github.com/repos/a/b/assignees{/user}",
        branches_url: "https://api.github.com/repos/a/b/branches{/branch}",
        tags_url: "https://api.github.com/repos/a/b/tags",
        blobs_url: "https://api.github.com/repos/a/b/git/blobs{/sha}",
        git_tags_url: "https://api.github.com/repos/a/b/git/tags{/sha}",
        git_refs_url: "https://api.github.com/repos/a/b/git/refs{/sha}",
        trees_url: "https://api.github.com/repos/a/b/git/trees{/sha}",
        statuses_url: "https://api.github.com/repos/a/b/statuses/{sha}",
        languages_url: "https://api.github.com/repos/a/b/languages",
        stargazers_url: "https://api.github.com/repos/a/b/stargazers",
        contributors_url: "https://api.github.com/repos/a/b/contributors",
        subscribers_url: "https://api.github.com/repos/a/b/subscribers",
        subscription_url: "https://api.github.com/repos/a/b/subscription",
        commits_url: "https://api.github.com/repos/a/b/commits{/sha}",
        git_commits_url: "https://api.github.com/repos/a/b/git/commits{/sha}",
        comments_url: "https://api.github.com/repos/a/b/comments{/number}",
        issue_comment_url: "https://api.github.com/repos/a/b/{/number}",
        contents_url: "https://api.github.com/repos/a/b/contents/{+path}",
        compare_url: "https://api.github.com/repos/a/b/compare/{base}.{head}",
        merges_url: "https://api.github.com/repos/a/b/merges",
        archive_url: "https://api.github.com/repos/a/b/{t}{/ref}",
        downloads_url: "https://api.github.com/repos/a/b/downloads",
        issues_url: "https://api.github.com/repos/a/b/issues{/number}",
        pulls_url: "https://api.github.com/repos/a/b/pulls{/number}",
        milestones_url: "https://api.github.com/repos/a/b/{/number}",
        notifications_url: "https://api.github.com/repos/a/b/{?s}",
        labels_url: "https://api.github.com/repos/a/b/labels{/name}",
        releases_url: "https://api.github.com/repos/a/b/releases{/id}",
        deployments_url: "https://api.github.com/repos/a/b/deployments",
        created_at: "2019-10-25T23:44:57Z",
        updated_at: "2020-08-18T05:31:25Z",
        pushed_at: "2020-12-30T19:57:39Z",
        git_url: "git://github.com/a/b.git",
        ssh_url: "git@github.com:a/b.git",
        clone_url: "https://github.com/a/b.git",
        svn_url: "https://github.com/a/b",
        homepage: null,
        size: 7,
        stargazers_count: 0,
        watchers_count: 0,
        language: null,
        has_issues: true,
        has_projects: true,
        has_downloads: true,
        has_wiki: true,
        has_pages: false,
        forks_count: 0,
        mirror_url: null,
        archived: false,
        disabled: false,
        open_issues_count: 5,
        license: {
            key: "someString",
            name: "someString",
            url: null,
            spdx_id: null,
            node_id: "someString",
        },
        forks: 0,
        open_issues: 5,
        watchers: 0,
        default_branch: "main",
    };

    const pullRequestSimple: components["schemas"]["pull-request-simple"] = {
        url: "someString",
        id: 22,
        node_id: "someString",
        html_url: "someString",
        diff_url: "someString",
        patch_url: "someString",
        issue_url: "someString",
        commits_url: "someString",
        review_comments_url: "someString",
        review_comment_url: "someString",
        comments_url: "someString",
        statuses_url: "someString",
        number: 22,
        state: "open",
        locked: false,
        title: "someString",
        user: null, // ["simple-user"] | null,
        body: null, // string | null,
        labels: [],
        milestone: null, // ["milestone"] | null,
        created_at: "someString",
        updated_at: "someString",
        closed_at: null, // string | null,
        merged_at: null, // string | null,
        merge_commit_sha: null, // string | null,
        assignee: null, // ["simple-user"] | null,
        assignees: null, // ["simple-user"][] | null,
        requested_teams: null, // ["team-simple"][] | null,
        head: {
            label: "someString",
            ref: "someString",
            repo: testRepo,
            sha: "someString",
            user: null, // ["simple-user"] | null,
        },
        base: {
            label: "someString",
            ref: "someString",
            repo: testRepo,
            sha: "someString",
            user: null, // ["simple-user"] | null,
        },
        _links: {
            comments: { href: "schemas" },
            commits: { href: "schemas" },
            statuses: { href: "schemas" },
            html: { href: "schemas" },
            issue: { href: "schemas" },
            review_comments: { href: "schemas" },
            review_comment: { href: "schemas" },
            self: { href: "schemas" },
        },
        author_association: "someString",
    };

    const pullRequest: components["schemas"]["pull-request"] = {
        url: "someString",
        id: 22,
        node_id: "someString",
        html_url: "someString",
        diff_url: "someString",
        patch_url: "someString",
        issue_url: "someString",
        commits_url: "someString",
        review_comments_url: "someString",
        review_comment_url: "someString",
        comments_url: "someString",
        statuses_url: "someString",
        number: 22,
        state: "open",
        locked: false,
        title: "someString",
        user: null, // ["simple-user"] | null;
        body: null,
        labels: [],
        milestone: null, // ["milestone"] | null;
        created_at: "someString",
        updated_at: "someString",
        closed_at: null,
        merged_at: null,
        merge_commit_sha: null,
        assignee: null, // ["simple-user"] | null;
        head: {
            label: "someString",
            ref: "someString",
            repo: {
                archive_url: "someString",
                assignees_url: "someString",
                blobs_url: "someString",
                branches_url: "someString",
                collaborators_url: "someString",
                comments_url: "someString",
                commits_url: "someString",
                compare_url: "someString",
                contents_url: "someString",
                contributors_url: "someString",
                deployments_url: "someString",
                description: null,
                downloads_url: "someString",
                events_url: "someString",
                fork: true,
                forks_url: "someString",
                full_name: "someString",
                git_commits_url: "someString",
                git_refs_url: "someString",
                git_tags_url: "someString",
                hooks_url: "someString",
                html_url: "someString",
                id: 10,
                node_id: "someString",
                issue_comment_url: "someString",
                issue_events_url: "someString",
                issues_url: "someString",
                keys_url: "someString",
                labels_url: "someString",
                languages_url: "someString",
                merges_url: "someString",
                milestones_url: "someString",
                name: "someString",
                notifications_url: "someString",
                owner: {
                    avatar_url: "someString",
                    events_url: "someString",
                    followers_url: "someString",
                    following_url: "someString",
                    gists_url: "someString",
                    gravatar_id: null,
                    html_url: "someString",
                    id: 2,
                    node_id: "someString",
                    login: "someString",
                    organizations_url: "someString",
                    received_events_url: "someString",
                    repos_url: "someString",
                    site_admin: false,
                    starred_url: "someString",
                    subscriptions_url: "someString",
                    type: "someString",
                    url: "someString",
                },
                private: false,
                pulls_url: "someString",
                releases_url: "someString",
                stargazers_url: "someString",
                statuses_url: "someString",
                subscribers_url: "someString",
                subscription_url: "someString",
                tags_url: "someString",
                teams_url: "someString",
                trees_url: "someString",
                url: "someString",
                clone_url: "someString",
                default_branch: "someString",
                forks: 1,
                forks_count: 1,
                git_url: "someString",
                has_downloads: false,
                has_issues: false,
                has_projects: false,
                has_wiki: false,
                has_pages: false,
                homepage: null,
                language: null,
                archived: false,
                disabled: false,
                mirror_url: null,
                open_issues: 0,
                open_issues_count: 0,
                license: null,
                pushed_at: "someString",
                size: 0,
                ssh_url: "someString",
                stargazers_count: 0,
                svn_url: "someString",
                watchers: 0,
                watchers_count: 0,
                created_at: "someString",
                updated_at: "someString",
            },
            sha: "someString",
            user: {
                avatar_url: "someString",
                events_url: "someString",
                followers_url: "someString",
                following_url: "someString",
                gists_url: "someString",
                gravatar_id: null,
                html_url: "someString",
                id: 1,
                node_id: "someString",
                login: "someString",
                organizations_url: "someString",
                received_events_url: "someString",
                repos_url: "someString",
                site_admin: false,
                starred_url: "someString",
                subscriptions_url: "someString",
                type: "someString",
                url: "someString",
            },
        },
        base: {
            label: "someString",
            ref: "someString",
            repo: {
                archive_url: "someString",
                assignees_url: "someString",
                blobs_url: "someString",
                branches_url: "someString",
                collaborators_url: "someString",
                comments_url: "someString",
                commits_url: "someString",
                compare_url: "someString",
                contents_url: "someString",
                contributors_url: "someString",
                deployments_url: "someString",
                description: null,
                downloads_url: "someString",
                events_url: "someString",
                fork: true,
                forks_url: "someString",
                full_name: "someString",
                git_commits_url: "someString",
                git_refs_url: "someString",
                git_tags_url: "someString",
                hooks_url: "someString",
                html_url: "someString",
                id: 1,
                node_id: "someString",
                issue_comment_url: "someString",
                issue_events_url: "someString",
                issues_url: "someString",
                keys_url: "someString",
                labels_url: "someString",
                languages_url: "someString",
                merges_url: "someString",
                milestones_url: "someString",
                name: "someString",
                notifications_url: "someString",
                owner: {
                    avatar_url: "someString",
                    events_url: "someString",
                    followers_url: "someString",
                    following_url: "someString",
                    gists_url: "someString",
                    gravatar_id: null,
                    html_url: "someString",
                    id: 2,
                    node_id: "someString",
                    login: "someString",
                    organizations_url: "someString",
                    received_events_url: "someString",
                    repos_url: "someString",
                    site_admin: false,
                    starred_url: "someString",
                    subscriptions_url: "someString",
                    type: "someString",
                    url: "someString",
                },
                private: false,
                pulls_url: "someString",
                releases_url: "someString",
                stargazers_url: "someString",
                statuses_url: "someString",
                subscribers_url: "someString",
                subscription_url: "someString",
                tags_url: "someString",
                teams_url: "someString",
                trees_url: "someString",
                url: "someString",
                clone_url: "someString",
                default_branch: "someString",
                forks: 0,
                forks_count: 0,
                git_url: "someString",
                has_downloads: false,
                has_issues: false,
                has_projects: false,
                has_wiki: false,
                has_pages: false,
                homepage: null,
                language: null,
                archived: false,
                disabled: false,
                mirror_url: null,
                open_issues: 0,
                open_issues_count: 0,
                license: null, // ["license-simple"] | null;
                pushed_at: "someString",
                size: 0,
                ssh_url: "someString",
                stargazers_count: 0,
                svn_url: "someString",
                watchers: 0,
                watchers_count: 0,
                created_at: "someString",
                updated_at: "someString",
            },
            sha: "someString",
            user: {
                avatar_url: "someString",
                events_url: "someString",
                followers_url: "someString",
                following_url: "someString",
                gists_url: "someString",
                gravatar_id: null,
                html_url: "someString",
                id: 1,
                node_id: "someString",
                login: "someString",
                organizations_url: "someString",
                received_events_url: "someString",
                repos_url: "someString",
                site_admin: false,
                starred_url: "someString",
                subscriptions_url: "someString",
                type: "someString",
                url: "someString",
            },
        },
        _links: {
            comments: { href: "schemas" },
            commits: { href: "schemas" },
            statuses: { href: "schemas" },
            html: { href: "schemas" },
            issue: { href: "schemas" },
            review_comments: { href: "schemas" },
            review_comment: { href: "schemas" },
            self: { href: "schemas" },
        },
        author_association: "someString",
        merged: false,
        mergeable: true,
        mergeable_state: "someString",
        merged_by: null, // ["simple-user"] | null;
        comments: 0,
        review_comments: 0,
        maintainer_can_modify: true,
        commits: 1,
        additions: 0,
        deletions: 0,
        changed_files: 0,
    };

    const prListResponse:
        RestEndpointMethodTypes["pulls"]["list"]["response"] = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: [pullRequestSimple],
    };

    // Response for any octokit calls - will be returned by the hook.wrap()
    // being set below.

    let response: any = prListResponse;

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return response;
    });

    // if (!pr.user || !pr.base.repo.owner) {
    await expect(github.getOpenPRs(owner)).rejects.toThrow(/is missing info/);

    pullRequestSimple.user = sampleUser;
    pullRequestSimple.base.repo.owner = null;
    await expect(github.getOpenPRs(owner)).rejects.toThrow(/is missing info/);

    const prInfoResponse:
        RestEndpointMethodTypes["pulls"]["get"]["response"] = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: pullRequest,
    };

    response = prInfoResponse; // reset response value

    // if (!pullRequest.user) {
    await expect(github.getPRInfo(owner, 22)).rejects.toThrow(
        /is missing info/
    );

    const issueCommentResponse:
        RestEndpointMethodTypes["issues"]["getComment"]["response"] = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: {
            id: 66,
            node_id: "someString",
            url: "someString",
            // body?: "someString",
            // body_text?: "someString",
            // body_html?: "someString",
            html_url: "someString",
            user: null, // sampleUser,
            created_at: "someString",
            updated_at: "someString",
            issue_url: "someString",
            author_association: "none",
        },
    };

    response = issueCommentResponse; // reset response value

    // if (!response.data.user) {
    await expect(github.getPRComment(owner, 77)).rejects.toThrow(
        /is missing info/
    );

    const gitUser = { name: "x", email: "x" };

    const commitObj: components["schemas"]["commit"] = {
        url: null,
        sha: null,
        node_id: "someString",
        html_url: "someString",
        comments_url: "someString",
        commit: {
            url: "someString",
            author: gitUser, // ["git-user"] | null;
            committer: gitUser, // ["git-user"] | null;
            message: "someString",
            comment_count: 0,
            tree: { sha: "someString", url: "someString" },
        },
        author: null,
        committer: null,
        parents: [{ sha: "someString", url: "someString" }],
    };

    const getCommitsResponse:
        RestEndpointMethodTypes["pulls"]["listCommits"]["response"] = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: [commitObj],
    };

    response = getCommitsResponse; // reset response value

    // if (!cm.commit.committer || !cm.commit.author || !cm.sha) {
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    commitObj.commit.author = null;
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    commitObj.commit.committer = null;
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    const privateUser = {
        login: "someString",
        id: 11,
        node_id: "someString",
        avatar_url: "someString",
        gravatar_id: null,
        url: "someString",
        html_url: "someString",
        followers_url: "someString",
        following_url: "someString",
        gists_url: "someString",
        starred_url: "someString",
        subscriptions_url: "someString",
        organizations_url: "someString",
        repos_url: "someString",
        events_url: "someString",
        received_events_url: "someString",
        type: "someString",
        site_admin: false,
        name: null,
        company: null,
        blog: null,
        location: null,
        email: null,
        hireable: null,
        bio: null,
        public_repos: 22,
        public_gists: 2,
        followers: 0,
        following: 0,
        created_at: "someString",
        updated_at: "someString",
        private_gists: 0,
        total_private_repos: 0,
        owned_private_repos: 0,
        disk_usage: 0,
        collaborators: 0,
        two_factor_authentication: false,
    };

    const userNameResponse:
        RestEndpointMethodTypes["users"]["getByUsername"]["response"] = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: privateUser,
    };

    response = userNameResponse; // reset response value

    // if (!response.data.name) {
    await expect(github.getGitHubUserInfo(owner)).rejects.toThrow(
        /Unable to get name/
    );

    // if (!response.data.name) {
    await expect(github.getGitHubUserName(owner)).rejects.toThrow(
        /Unable to get name/
    );
});

test("test missing values in response using small schema", async () => {
    const github = new GitHubProxy();
    github.fakeAuthenticated(owner);

    /**
     * These tests use a basic schema consisting of only fields of interest.  To
     * use the full schema, the types have to match octokit.
     *
     * For example:
     *
     * @example Objects would be typed like this:
     * const sampleUser: components["schemas"]["simple-user"] = {...};
     * const pullRequestSimple:
     * components["schemas"]["pull-request-simple"] = {...};
     *
     * @example Responses would be typed like this:
     * const prListResponse:
     * RestEndpointMethodTypes["pulls"]["list"]["response"] = {
     * status: 200,
     * headers: { status: "200 OK" },
     * url: "",
     * data: [pullRequestSimple],
     * };
     *
     */

    interface IBasicUser {
        login: string;
        type: string;
        email: string | null;
    }

    interface ISimpleUser extends IBasicUser {
        name: string;
    }

    const sampleUser: ISimpleUser = {
        login: "someString",
        type: "someString",
        name: "foo",
        email: null,
    };

    interface IRepository {
        name: string;
        owner: ISimpleUser | null;
    }

    const testRepo: IRepository = {
        name: "gitout",
        owner: sampleUser,
    };

    interface IPullRequestSimple {
        html_url: string;
        number: number;
        title: string;
        user: ISimpleUser | null;
        body: string | null;
        created_at: string;
        updated_at: string;
        head: {
            label: string;
            repo: IRepository;
            sha: string;
        };
        base: {
            label: string;
            repo: IRepository;
            sha: string;
        };
        mergeable: boolean;
        comments: number;
        commits: number;
    }

    const pullRequestSimple: IPullRequestSimple = {
        html_url: "someString",
        number: 22,
        title: "someString",
        user: null, // ISimpleUser | null,
        body: null, // string | null,
        created_at: "someString",
        updated_at: "someString",
        head: {
            label: "someString",
            repo: testRepo,
            sha: "someString",
        },
        base: {
            label: "someString",
            repo: testRepo,
            sha: "someString",
        },
        mergeable: true,
        comments: 0,
        commits: 1,
    };

    const prListResponse: OctokitResponse<[IPullRequestSimple]> = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: [pullRequestSimple],
    };

    // Response for any octokit calls - will be returned by the hook.wrap()
    // being set below.

    let response: any = prListResponse;

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return response;
    });

    // if (!pr.user || !pr.base.repo.owner) {
    await expect(github.getOpenPRs(owner)).rejects.toThrow(/is missing info/);

    pullRequestSimple.user = sampleUser;
    pullRequestSimple.base.repo.owner = null;
    await expect(github.getOpenPRs(owner)).rejects.toThrow(/is missing info/);

    const prInfoResponse: OctokitResponse<IPullRequestSimple> = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: pullRequestSimple,
    };

    response = prInfoResponse; // reset response value

    pullRequestSimple.user = null;
    pullRequestSimple.base.repo.owner = sampleUser;
    // if (!pullRequest.user) {
    await expect(github.getPRInfo(owner, 2)).rejects.toThrow(/is missing info/);

    interface IIssueComment {
        body?: string;
        html_url: string;
        user: ISimpleUser | null;
    }

    const issueCommentResponse: OctokitResponse<IIssueComment> = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: {
            html_url: "someString",
            user: null, // sampleUser,
        },
    };

    response = issueCommentResponse; // reset response value

    // if (!response.data.user) {
    await expect(github.getPRComment(owner, 77)).rejects.toThrow(
        /is missing info/
    );

    interface ICommit {
        commit: {
            author: ISimpleUser | null;
            committer: ISimpleUser | null;
            message: string;
        };
        author: ISimpleUser | null;
        committer: ISimpleUser | null;
        parents: [{ sha: string; url: string; html_url?: string }];
    }

    const commitObj: ICommit = {
        commit: {
            author: sampleUser, // ISimpleUser | null;
            committer: sampleUser, // ISimpleUser | null;
            message: "someString",
        },
        author: null,
        committer: null,
        parents: [{ sha: "someString", url: "someString" }],
    };

    const getCommitsResponse: OctokitResponse<[ICommit]> = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: [commitObj],
    };

    response = getCommitsResponse; // reset response value

    // if (!cm.commit.committer || !cm.commit.author || !cm.sha) {
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    commitObj.commit.author = null;
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    commitObj.commit.committer = null;
    await expect(github.getPRCommits(owner, 22)).rejects.toThrow(
        /information missing/
    );

    interface IPrivateUser extends IBasicUser {
        name: string | null;
    }

    const userNameResponse: OctokitResponse<IPrivateUser> = {
        status: 200,
        headers: { status: "200 OK" },
        url: "",
        data: sampleUser,
    };

    response = userNameResponse; // reset response value

    (sampleUser as IPrivateUser).name = null;
    // if (!response.data.name) {
    await expect(github.getGitHubUserInfo(owner)).rejects.toThrow(
        /Unable to get name/
    );

    // if (!response.data.name) {
    await expect(github.getGitHubUserName(owner)).rejects.toThrow(
        /Unable to get name/
    );
});
