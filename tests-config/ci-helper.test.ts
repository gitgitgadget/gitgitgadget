import { afterAll, beforeAll, expect, jest, test } from "@jest/globals";
import { fileURLToPath } from 'url';
import { CIHelper } from "../lib/ci-helper.js";
import { GitNotes } from "../lib/git-notes.js";
import { GitHubGlue, IGitHubUser, IPRComment, IPRCommit, IPullRequestInfo, } from "../lib/github-glue.js";
import { IMailMetadata } from "../lib/mail-metadata.js";
import { IConfig, loadConfig, setConfig } from "../lib/project-config.js";
import { testSmtpServer } from "test-smtp-server";
import { testCreateRepo, TestRepo } from "../tests/test-lib.js";
import path from "path";

jest.setTimeout(180000);
const sourceFileName = fileURLToPath(import.meta.url);

const testConfig: IConfig = {
    repo: {
        name: "telescope",
        owner: "webb",
        baseOwner: "galileo",
        owners: ["webb", "galileo"],
        branches: ["maint"],
        closingBranches: ["maint", "main"],
        trackingBranches: ["maint", "main", "hubble"],
        maintainerBranch: "lippershey",
        host: "github.com",
    },
    mailrepo: {
        name: "git",
        owner: "gitgitgadget",
        branch: "main",
        host: "lore.kernel.org",
        url: "https://localhost",
        descriptiveName: "string",
    },
    mail: {
        author: "GitGadget",
        sender: "GitGadget"
    },
    app: {
        appID: 12836,
        installationID: 195971,
        name: "gitgitgadget",
        displayName: "BigScopes",
        altname: "gitgitgadget-git"
    },
    lint: {
        maxCommitsIgnore: [],
        maxCommits: 30,
    },
    user: {
        allowUserAsLogin: false,
    },
    project: {
        to: "david@groundcontrol.com",
        branch: "upstream/master",
        cc: [],
        urlPrefix: "https://mailarchive.com/egit/"
    }
};

let config = setConfig(testConfig);

const eMailOptions = {
    smtpserver: new testSmtpServer(),
    smtpOpts: ""
};

// async in case new config is loaded
beforeAll(async (): Promise<void> => {
    eMailOptions.smtpserver.startServer(); // start listening
    eMailOptions.smtpOpts =
        `{port: ${eMailOptions.smtpserver.getPort()
        }, secure: true, tls: {rejectUnauthorized: false}}`;

    if (process.env.GITGITGADGET_CONFIG) {
        const configSource = await loadConfig(path.resolve(process.env.GITGITGADGET_CONFIG));
        config = setConfig(configSource);
    }

    process.env.GIT_AUTHOR_NAME = config.mail.author;
    process.env.GIT_AUTHOR_EMAIL = `${config.mail.author}@fakehost.com`;
});

afterAll((): void => {
    eMailOptions.smtpserver.stopServer(); // terminate server
});

// Mocking class to replace GithubGlue with mock of GitHubGlue

class TestCIHelper extends CIHelper {
    public ghGlue: GitHubGlue;      // not readonly reference
    public addPRCommentCalls: string[][]; // reference mock.calls
    public updatePRCalls: string[][]; // reference mock.calls
    public addPRLabelsCalls: Array<[_: string, labels: string[]]>;

    public constructor(workDir: string, debug = false, gggDir = ".") {
        super(workDir, config, debug, gggDir);
        this.testing = true;
        this.ghGlue = this.github;

        const commentInfo = { id: 1, url: "ok" };
        // eslint-disable-next-line @typescript-eslint/require-await
        const addPRComment = jest.fn( async (): Promise<{id: number; url: string}> => commentInfo );
        this.ghGlue.addPRComment = addPRComment;
        this.addPRCommentCalls = addPRComment.mock.calls;

        // eslint-disable-next-line @typescript-eslint/require-await
        const updatePR = jest.fn( async (): Promise<number> => 1 );
        this.ghGlue.updatePR = updatePR;
        this.updatePRCalls = updatePR.mock.calls;

        // eslint-disable-next-line @typescript-eslint/require-await
        const addPRLabels = jest.fn( async (_: string, labels: string[]): Promise<string[]> => labels );
        this.ghGlue.addPRLabels = addPRLabels;
        this.addPRLabelsCalls = addPRLabels.mock.calls;

        // need keys to authenticate
        // this.ghGlue.ensureAuthenticated = async (): Promise<void> => {};
    }

    public setGHGetPRInfo(o: IPullRequestInfo): void {
        // eslint-disable-next-line @typescript-eslint/require-await
        this.ghGlue.getPRInfo = jest.fn( async (): Promise<IPullRequestInfo> => o );
    }

    public setGHGetPRComment(o: IPRComment): void {
        // eslint-disable-next-line @typescript-eslint/require-await
        this.ghGlue.getPRComment = jest.fn( async (): Promise<IPRComment> => o );
    }

    public setGHGetPRCommits(o: IPRCommit[]): void {
        // eslint-disable-next-line @typescript-eslint/require-await
        this.ghGlue.getPRCommits = jest.fn( async (): Promise<IPRCommit[]> => o );
    }

    public setGHGetGitHubUserInfo(o: IGitHubUser): void {
        // eslint-disable-next-line @typescript-eslint/require-await
        this.ghGlue.getGitHubUserInfo = jest.fn( async (): Promise<IGitHubUser> => o );
    }

    public addMaxCommitsException(pullRequestURL: string): void {
        this.maxCommitsExceptions = [pullRequestURL];
    }

    public removeMaxCommitsException(): void {
        this.maxCommitsExceptions = [];
    }
}

// Create three repos.
// worktree is a local copy for doing updates and has the config
// info that would normally be in the gitgitgadget repo.  To ensure
// testing isolation, worktree is NOT the repo used for git clone
// tests.  That work is done in gggLocal.

// gggRemote represents the master on github.

// gggLocal represents the empty repo to be used by gitgitgadget.  It
// is empty to ensure nothing needs to be present (worktree would
// have objects present).

async function setupRepos(instance: string):
    Promise <{ worktree: TestRepo; gggLocal: TestRepo; gggRemote: TestRepo }> {
    const worktree = await testCreateRepo(sourceFileName, `-work-cmt${instance}`);
    const gggLocal = await testCreateRepo(sourceFileName, `-git-lcl${instance}`);
    const gggRemote = await testCreateRepo(sourceFileName, `-git-rmt${instance}`);

    // re-route the URLs
    const url = `https://github.com/${config.repo.owner}/${config.repo.name}`;

    await worktree.git([ "config", `url.${gggRemote.workDir}.insteadOf`, url ]);
    await gggLocal.git([ "config", `url.${gggRemote.workDir}.insteadOf`, url ]);
    // pretend there are two remotes
    await gggLocal.git([ "config", `url.${gggRemote.workDir}.insteadOf`,
        `https://github.com/${config.repo.baseOwner}/${config.repo.name}` ]);

    // set needed config
    await worktree.git([ "config", "--add", "gitgitgadget.workDir", gggLocal.workDir, ]);
    // misc-helper and gitgitgadget use this and ci-helper relies on insteadOf above
    await worktree.git(["config", "--add", "gitgitgadget.publishRemote", gggRemote.workDir]);
    await worktree.git([ "config", "--add", "gitgitgadget.smtpUser", "joe_user@example.com", ]);
    await worktree.git([ "config", "--add", "gitgitgadget.smtpHost", "localhost", ]);
    await worktree.git([ "config", "--add", "gitgitgadget.smtpPass", "secret", ]);
    await worktree.git([ "config", "--add", "gitgitgadget.smtpOpts", eMailOptions.smtpOpts, ]);

    const notes = new GitNotes(gggRemote.workDir);
    await notes.set("", {allowedUsers: ["ggg", "user1"]}, true);

    // Initial empty commit
    const commitA = await gggRemote.commit("A");
    expect(commitA).not.toBeUndefined();

    // Set up fake upstream branches
    for (const branch of config.repo.trackingBranches) {
        await gggRemote.git(["branch", branch]);
    }

    return { worktree, gggLocal, gggRemote };
}

/**
 * Check the mail server for an email.
 *
 * @param messageId string to search for
 */
async function checkMsgId(messageId: string): Promise<boolean> {
    const mails = eMailOptions.smtpserver.getEmails();

    for (const mail of mails) {
        const parsed = await mail.getParsed();
        if (parsed.messageId?.match(messageId)) {
            return true;
        }
    }

    return false;
}

test("identify merge that integrated some commit", async () => {
    const repo = await testCreateRepo(sourceFileName);

    /*
     * Create a branch structure like this:
     *
     * a - b ----- c - d
     *   \       /   /
     *   | e ----- f
     *   \       /
     *     g - h
     */
    const commitA = await repo.commit("a");
    const commitG = await repo.commit("g");
    const commitH = await repo.commit("h");
    await repo.git(["reset", "--hard", commitA]);
    const commitE = await repo.commit("e");
    const commitF = await repo.merge("f", commitH);
    await repo.git(["reset", "--hard", commitA]);
    const commitB = await repo.commit("b");
    const commitC = await repo.merge("c", commitE);
    const commitD = await repo.merge("d", commitF);
    await repo.git(["update-ref", `refs/remotes/upstream/${config.repo.trackingBranches[2]}`, commitD]);

    const ci = new CIHelper(repo.workDir, config, true);
    expect(commitB).not.toBeUndefined();
    expect(await ci.identifyMergeCommit(config.repo.trackingBranches[2], commitG)).toEqual(commitD);
    expect(await ci.identifyMergeCommit(config.repo.trackingBranches[2], commitE)).toEqual(commitC);
    expect(await ci.identifyMergeCommit(config.repo.trackingBranches[2], commitH)).toEqual(commitD);
});

test("identify upstream commit", async () => {
    // initialize test worktree and gitgitgadget remote
    const worktree = await testCreateRepo(sourceFileName, "-worktree");
    const gggRemote = await testCreateRepo(sourceFileName, "-gitgitgadget");

    // re-route the URLs
    await worktree.git(["config", `url.${gggRemote.workDir}.insteadOf`,
                        `https://github.com/${config.repo.owner}/${config.repo.name}`]);

    // Set up fake upstream branches
    const commitA = await gggRemote.commit("A");
    expect(commitA).not.toBeUndefined();
    for (const branch of config.repo.trackingBranches) {
        await gggRemote.git(["branch", branch]);
    }

    // Now come up with a local change
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // "Contribute" it via a PullRequest
    const pullRequestURL = "https://example.com/pull/123";
    const messageID = "fake-1st-mail@example.com";
    const notes = new GitNotes(worktree.workDir);
    await notes.appendCommitNote(commitB, messageID);
    const bMeta = {
        messageID,
        originalCommit: commitB,
        pullRequestURL,
    } as IMailMetadata;
    await notes.set(messageID, bMeta);

    // "Apply" the patch, and merge it
    await gggRemote.newBranch("gg/via-pull-request");
    const commitBNew = await gggRemote.commit("B");
    await gggRemote.git(["checkout", config.repo.trackingBranches[2]]);
    await gggRemote.git(["merge", "--no-ff", "gg/via-pull-request"]);

    // Update the `mail-to-commit` notes ref, at least the part we care about
    const mail2CommitNotes = new GitNotes(gggRemote.workDir,
                                          "refs/notes/mail-to-commit");
    await mail2CommitNotes.setString(messageID, commitBNew);

    // "publish" the gitgitgadget notes
    await worktree.git(["push", gggRemote.workDir, notes.notesRef]);

    const ci = new TestCIHelper(worktree.workDir);
    expect(await ci.identifyUpstreamCommit(commitB)).toEqual(commitBNew);

    expect(await ci.updateCommitMapping(messageID)).toBeTruthy();
    const bMetaNew = await notes.get<IMailMetadata>(messageID);
    expect(bMetaNew).not.toBeUndefined();
    expect(bMetaNew?.originalCommit).toEqual(commitB);
    expect(bMetaNew?.commitInGitGit).toEqual(commitBNew);
});

test("handle comment allow basic test", async () => {
    const { worktree, gggLocal } = await setupRepos("a1");

    // Ready to start testing
    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",              // set in setupRepos
        body: "/allow  user2",
        prNumber,
    };
    const user = {
        email: "user2@example.com",
        login: "user2",
        name: "User Two",
        type: "basic",
    };

    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`is now allowed to use ${config.app.displayName}`);
});

test("handle comment allow fail invalid user", async () => {
    const { worktree, gggLocal } = await setupRepos("a2");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const comment = {
        author: "ggg",
        body: "/allow  bad_@@@@",
        prNumber,
    };

    ci.setGHGetPRComment(comment);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/is not a valid GitHub username/);
});

test("handle comment allow no public email", async () => {
    const { worktree, gggLocal } = await setupRepos("a3");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const comment = {
        author: "ggg",
        body: "/allow   bad",
        prNumber,
    };
    const user: IGitHubUser = {
        email: null,
        login: "noEmail",
        name: "no email",
        type: "basic",
    };

    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`is now allowed to use ${config.app.displayName}`);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/no public email address set/);
});

test("handle comment allow already allowed", async () => {
    const { worktree, gggLocal } = await setupRepos("a4");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/allow  ggg",
        prNumber,
    };
    const user = {
        email: "bad@example.com",
        login: "ggg",
        name: "not so bad",
        type: "basic",
    };

    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`already allowed to use ${config.app.displayName}`);
});

test("handle comment allow no name specified (with trailing white space)",
     async () => {
    const { worktree, gggLocal } = await setupRepos("a5");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/allow   ",
        prNumber,
    };
    const user = {
        email: "bad@example.com",
        login: "ggg",
        name: "not so bad",
        type: "basic",
    };
    const prInfo = {
        author: "ggg",
        baseCommit: "A",
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Super body",
        hasComments: true,
        headCommit: "B",
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Submit a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`already allowed to use ${config.app.displayName}`);
});

test("handle comment disallow basic test", async () => {
    const { worktree, gggLocal } = await setupRepos("d1");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/disallow  user1 ",
        prNumber,
    };
    const user = {
        email: "user1@example.com",
        login: "user1",
        name: "not so bad",
        type: "basic",
    };

    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`is no longer allowed to use ${config.app.displayName}`);
});

test("handle comment disallow was not allowed", async () => {
    const { worktree, gggLocal } = await setupRepos("d2");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/disallow  unknown1 ",
        prNumber,
    };

    ci.setGHGetPRComment(comment);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(`already not allowed to use ${config.app.displayName}`);
});

test("handle comment submit not author", async () => {
    const { worktree, gggLocal } = await setupRepos("s1");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "bad@example.com",
        login: "ggg",
        name: "ee cummings",
        type: "basic",
    };
    const prInfo = {
        author: "ggNOTg",
        baseCommit: "A",
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Super body",
        hasComments: true,
        headCommit: "B",
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Submit a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/Only the owner of a PR can submit/);
});

test("handle comment submit not mergeable", async () => {
    const { worktree, gggLocal } = await setupRepos("s2");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "bad@example.com",
        login: "ggg",
        name: "ee cummings",
        type: "basic",
    };
    const prInfo = {
        author: "ggg",
        baseCommit: "A",
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Super body",
        hasComments: true,
        headCommit: "B",
        headLabel: "somebody:master",
        mergeable: false,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Do Not Submit a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/does not merge cleanly/);
});

test("handle comment submit email success", async () => {
    const { worktree, gggLocal, gggRemote } = await setupRepos("s3");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const template = "fine template\r\nnew line";
    // add template to master repo
    await gggRemote.commit("temple", ".github//PULL_REQUEST_TEMPLATE.md", template);
    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git([
        "fetch", worktree.workDir,
        `refs/heads/master:${pullRequestRef}/head`,
        `refs/heads/master:${pullRequestRef}/merge`,
    ]); // fake merge

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "ggg@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const commits = [{
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BA55FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Submit ok\n\nSuccinct message\n\nSigned-off-by: x",
        parentCount: 1,
    }];
    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: `Super body\r\n${template}\r\nCc: Copy One <copy@cat.com>\r\n`
            + "Cc: Copy Two <copycat@cat.com>",
        hasComments: true,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Submit a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetPRCommits(commits);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/Submitted as/);

    const msgId = ci.addPRCommentCalls[0][1].match(/\[(.*)\]/);
    expect(msgId).not.toBeUndefined();
    if (msgId && msgId[1]) {
        const msgFound = await checkMsgId(msgId[1]);
        expect(msgFound).toBeTruthy();
    }
});

test("handle comment preview email success", async () => {
    const { worktree, gggLocal, gggRemote } = await setupRepos("p1");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const template = "fine template\nnew line";
    await gggRemote.commit("temple", ".github//PULL_REQUEST_TEMPLATE.md",
                           template);
    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git([
        "fetch", worktree.workDir,
        `refs/heads/master:${pullRequestRef}/head`,
        `refs/heads/master:${pullRequestRef}/merge`,
    ]); // fake merge

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "preview@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const commits = [{
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BA55FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Submit ok\n\nSigned-off-by: x",
        parentCount: 1,
    }];
    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "There will be a submit email and a preview email.",
        hasComments: true,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetPRCommits(commits);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/Submitted as/);

    const msgId1 = ci.addPRCommentCalls[0][1].match(/\[(.*)\]/);
    expect(msgId1).not.toBeUndefined();
    if (msgId1 && msgId1[1]) {
        const msgFound1 = await checkMsgId(msgId1[1]);
        expect(msgFound1).toBeTruthy();
    }

    comment.body = " /preview";
    ci.setGHGetPRComment(comment);
    await ci.handleComment(config.repo.owner, 433865360); // do it again
    expect(ci.addPRCommentCalls[1][1]).toMatch(/Preview email sent as/);

    const msgId2 = ci.addPRCommentCalls[0][1].match(/\[(.*)\]/);
    expect(msgId2).not.toBeUndefined();
    if (msgId2 && msgId2[1]) {
        const msgFound2 = await checkMsgId(msgId2[1]);
        expect(msgFound2).toBeTruthy();
    }

    await ci.handleComment(config.repo.owner, 433865360); // should still be v2

    const msgId3 = ci.addPRCommentCalls[0][1].match(/\[(.*)\]/);
    expect(msgId3).not.toBeUndefined();
    if (msgId3 && msgId3[1]) {
        const msgFound3 = await checkMsgId(msgId3[1]);
        expect(msgFound3).toBeTruthy();
    }
});

test("handle push/comment too many commits fails", async () => {
    const { worktree, gggLocal, gggRemote } = await setupRepos("pu1");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    // this should be in a separate repo from the worktree
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git([
        "fetch", worktree.workDir,
        `refs/heads/master:${pullRequestRef}/head`,
        `refs/heads/master:${pullRequestRef}/merge`,
    ]); // fake merge

    const commits: IPRCommit[] = [];
    for (let i = 0; i < 40; i++) {
        commits.push({
            author: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            commit: `${i}abc123`,
            committer: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            message: `commit ${i}\n\nfoo\n\nSigned-off-by: Bob <bob@example.com>`,
            parentCount: 1,
        });
    }
    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "preview@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Never seen - too many commits.",
        commits: commits.length,
        hasComments: false,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);
    ci.setGHGetPRCommits(commits);

    const failMsg = `The pull request has ${commits.length} commits.`;
    // fail for too many commits on push
    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

    expect(ci.addPRCommentCalls[0][1]).toMatch(failMsg);
    ci.addPRCommentCalls.length = 0;

    // fail for too many commits on submit
    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(failMsg);
    ci.addPRCommentCalls.length = 0;

    ci.addMaxCommitsException(prInfo.pullRequestURL);
    const commitsFail = commits;
    commitsFail[0].message = `x: A${commitsFail[0].message}`;
    ci.setGHGetPRCommits(commitsFail);
    await ci.handleComment(config.repo.owner, 433865360);
    // There will still be a comment, but about upper-case after prefix
    expect(ci.addPRCommentCalls).toHaveLength(1);
    expect(ci.addPRCommentCalls[0][1]).not.toMatch(failMsg);
    ci.removeMaxCommitsException();
    ci.addPRCommentCalls.length = 0;

    // fail for too many commits on preview
    comment.body = " /preview";
    ci.setGHGetPRComment(comment);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(failMsg);
    ci.addPRCommentCalls.length = 0;

    // fail for too many commits push new user
    prInfo.author = "starfish";
    comment.author = "starfish";
    user.login = "starfish";
    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);
    ci.setGHGetPRCommits(commits);

    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

    expect(ci.addPRCommentCalls[0][1]).toMatch(/Welcome/);
    expect(ci.addPRCommentCalls[1][1]).toMatch(failMsg);
    expect(ci.addPRLabelsCalls[0][1]).toEqual(["new user"]);
});

test("handle push/comment merge commits fails", async () => {
    const { worktree, gggLocal, gggRemote} = await setupRepos("pu2");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    // this should be in a separate repo from the worktree
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git(
        [ "fetch", worktree.workDir,
          `refs/heads/master:${pullRequestRef}/head`,
          `refs/heads/master:${pullRequestRef}/merge`]); // fake merge

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "ggg@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const commits = [{
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BAD1FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Merge a commit",
        parentCount: 2,
    }];

    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Never seen - merge commits.",
        commits: commits.length,
        hasComments: false,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetPRCommits(commits);
    ci.setGHGetGitHubUserInfo(user);

    // fail for merge commits on push
    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

    expect(ci.addPRCommentCalls[0][1]).toMatch(commits[0].commit);
    ci.addPRCommentCalls.length = 0;

    // fail for merge commits on submit
    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(commits[0].commit);
    ci.addPRCommentCalls.length = 0;

    // fail for merge commits on preview
    comment.body = " /preview";
    ci.setGHGetPRComment(comment);

    await ci.handleComment(config.repo.owner, 433865360);
    expect(ci.addPRCommentCalls[0][1]).toMatch(commits[0].commit);
    ci.addPRCommentCalls.length = 0;

    // fail for merge commits push new user
    prInfo.author = "starfish";
    comment.author = "starfish";
    user.login = "starfish";

    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

    expect(ci.addPRCommentCalls[0][1]).toMatch(/Welcome/);
    expect(ci.addPRCommentCalls[1][1]).toMatch(commits[0].commit);
    expect(ci.addPRLabelsCalls[0][1]).toEqual(["new user"]);
    ci.addPRCommentCalls.length = 0;

    // Test Multiple merges
    commits.push({
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BAD2FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Merge a commit",
        parentCount: 1,
    });
    commits.push({
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BAD3FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Merge a commit",
        parentCount: 2,
    });

    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

    expect(ci.addPRCommentCalls[0][1]).toMatch(/Welcome/);
    expect(ci.addPRCommentCalls[1][1]).toMatch(commits[0].commit);
    expect(ci.addPRCommentCalls[1][1]).not.toMatch(commits[1].commit);
    expect(ci.addPRCommentCalls[1][1]).toMatch(commits[2].commit);
    ci.addPRCommentCalls.length = 0;

});

test("disallow no-reply emails", async () => {
    const { worktree, gggLocal, gggRemote} = await setupRepos("pu2");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    // this should be in a separate repo from the worktree
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git(
        [ "fetch", worktree.workDir,
          `refs/heads/master:${pullRequestRef}/head`,
          `refs/heads/master:${pullRequestRef}/merge`]); // fake merge

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "ggg@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const commits = [{
        author: {
            email: "random@users.noreply.github.com",
            login: "random",
            name: "random",
        },
        commit: "BAD1FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Using ineligible email address",
        parentCount: 1,
    }];

    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Never seen - merge commits.",
        commits: commits.length,
        hasComments: false,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetPRCommits(commits);
    ci.setGHGetGitHubUserInfo(user);

    // fail for commits with fake email on push
    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);

});

// Basic tests for ci-helper - lint tests are in commit-lint.tests.ts

test("basic lint tests", async () => {
    const { worktree, gggLocal, gggRemote} = await setupRepos("pu4");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    const commitA = await gggRemote.revParse("HEAD");
    expect(commitA).not.toBeUndefined();

    // Now come up with a local change
    // this should be in a separate repo from the worktree
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const commitB = await worktree.commit("b");

    // get the pr refs in place
    const pullRequestRef = `refs/pull/${prNumber}`;
    await gggRemote.git(
        [ "fetch", worktree.workDir,
          `refs/heads/master:${pullRequestRef}/head`,
          `refs/heads/master:${pullRequestRef}/merge`]); // fake merge

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/submit   ",
        prNumber,
    };
    const user = {
        email: "ggg@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };
    const commits = [
        {
            author: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            commit: "BAD1FEEDBEEF",
            committer: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            message: "Message has no description",
            parentCount: 1,
        },
        {
            author: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            commit: "BAD2FEEDBEEF",
            committer: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            message: "Missing blank line is bad\nhere\nSigned-off-by: x",
            parentCount: 1,
        },
        {
            author: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            commit: "F00DFEEDBEEF",
            committer: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            message: "Successful test\n\nSigned-off-by: x",
            parentCount: 1,
        },
        {
            author: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            commit: "BAD5FEEDBEEF",
            committer: {
                email: "ggg@example.com",
                login: "ggg",
                name: "e. e. cummings",
            },
            message: "tests: This should be lower case\n\nSigned-off-by: x",
            parentCount: 1,
        },
    ];

    const prInfo = {
        author: "ggg",
        baseCommit: commitA,
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Never seen - merge commits.",
        commits: commits.length,
        hasComments: false,
        headCommit: commitB,
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetPRCommits(commits);
    ci.setGHGetGitHubUserInfo(user);

    // fail for commits with lint errors
    await expect(ci.handlePush(config.repo.owner, 433865360)).rejects.toThrow(/Failing check due/);
    expect(ci.addPRCommentCalls[0][1]).toMatch(commits[0].commit);
    expect(ci.addPRCommentCalls[0][1]).toMatch(/too short/);
    expect(ci.addPRCommentCalls[1][1]).toMatch(commits[1].commit);
    expect(ci.addPRCommentCalls[1][1]).toMatch(/empty line/);
    expect(ci.addPRCommentCalls[2][1]).toMatch(commits[3].commit);
    expect(ci.addPRCommentCalls[2][1]).toMatch(/lower case/);

});

test("Handle comment cc", async () => {
    const {worktree, gggLocal} = await setupRepos("cc");

    const ci = new TestCIHelper(gggLocal.workDir, false, worktree.workDir);
    const prNumber = 59;

    // GitHubGlue Responses
    const comment = {
        author: "ggg",
        body: "/cc \"Some Body\" <sbody@example.com>",
        prNumber,
    };
    const user = {
        email: "ggg@example.com",
        login: "ggg",
        name: "e. e. cummings",
        type: "basic",
    };

    const prInfo = {
        author: "ggg",
        baseCommit: "foo",
        baseLabel: "gitgitgadget:next",
        baseOwner: config.repo.owner,
        baseRepo: config.repo.name,
        body: "Never seen - no cc.",
        commits: 1,
        hasComments: false,
        headCommit: "bar",
        headLabel: "somebody:master",
        mergeable: true,
        number: prNumber,
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/59`,
        title: "Preview a fun fix",
    };

    ci.setGHGetPRInfo(prInfo);
    ci.setGHGetPRComment(comment);
    ci.setGHGetGitHubUserInfo(user);

    await ci.handleComment(config.repo.owner, prNumber);

    expect(ci.updatePRCalls[0][ci.updatePRCalls[0].length-1]).toMatch(/Some Body/);
    ci.updatePRCalls.length = 0;

    comment.body = "/cc \"A Body\" <abody@example.com>, "
        + "\"S Body\" <sbody@example.com>";

    await ci.handleComment(config.repo.owner, prNumber);

    expect(ci.updatePRCalls[0][ci.updatePRCalls[0].length-1]).toMatch(/A Body/);
    expect(ci.updatePRCalls[1][ci.updatePRCalls[0].length-1]).toMatch(/S Body/);
    ci.updatePRCalls.length = 0;

    // email will not be re-added to list
    prInfo.body = "changes\r\n\r\ncc: <abody@example.com>";

    await ci.handleComment(config.repo.owner, prNumber);

    expect(ci.updatePRCalls[0][ci.updatePRCalls[0].length-1]).toMatch(/S Body/);
    expect(ci.updatePRCalls).toHaveLength(1);
});
