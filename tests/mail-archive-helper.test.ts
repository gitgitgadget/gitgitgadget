import { Octokit } from "@octokit/rest";
import { OctokitResponse } from "@octokit/types";
import { expect, jest, test } from "@jest/globals";
import { fileURLToPath } from "url";
import { GitNotes } from "../lib/git-notes.js";
import { GitHubGlue } from "../lib/github-glue.js";
import { MailArchiveGitHelper, IGitMailingListMirrorState } from "../lib/mail-archive-helper.js";
import { IMailMetadata } from "../lib/mail-metadata.js";
import { testCreateRepo } from "./test-lib.js";
import defaultConfig from "../lib/gitgitgadget-config.js";
import { IConfig } from "../lib/project-config.js";

/* eslint max-classes-per-file: ["error", 2] */

class MailArchiveGitHelperProxy extends MailArchiveGitHelper {
    public constructor(
        config: IConfig,
        gggNotes: GitNotes,
        mailArchiveGitDir: string,
        githubGlue: GitHubGlue,
        state: IGitMailingListMirrorState,
        branch: string,
    ) {
        super(config, gggNotes, mailArchiveGitDir, githubGlue, state, branch);
    }
}
class GitHubProxy extends GitHubGlue {
    public octo: Octokit;
    public constructor(workDir = "./", owner = "gitgitfadget", repo = "git") {
        super(workDir, owner, repo);
        this.octo = this.client;
    }

    public fakeAuthenticated(repositoryOwner: string): void {
        this.authenticated = repositoryOwner;
    }
}

jest.setTimeout(180000);
const sourceFileName = fileURLToPath(import.meta.url);

// Minimal interfaces for github responses

interface IBasicUser {
    login: string;
    type: string;
    email: string | null;
}

interface ISimpleUser extends IBasicUser {
    name: string;
}

interface IRepository {
    name: string;
    owner: ISimpleUser | null;
}

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

interface IIssueComment {
    body?: string;
    html_url: string;
    id: number;
}

interface ICommit {
    commit: {
        author: ISimpleUser | null;
        committer: ISimpleUser | null;
        message: string;
    };
    author: ISimpleUser | null;
    committer: ISimpleUser | null;
    sha: string;
    parents: [{ sha: string; url: string; html_url?: string }];
}

const config = { ...defaultConfig }; // make a copy
config.repo.owner = "test";
config.repo.name = "test";

const fromEmail = "I Replied <ireplied@gmail.com>";

// Responses for any octokit calls - will be returned by the hook.wrap() in the tests.

const sampleUser: ISimpleUser = {
    login: "someString",
    type: "someString",
    name: "foo",
    email: null,
};
const testRepo: IRepository = {
    name: "gitout",
    owner: sampleUser,
};

const commitObj: ICommit = {
    commit: {
        author: sampleUser, // ISimpleUser | null;
        committer: sampleUser, // ISimpleUser | null;
        message: "someString",
    },
    author: null,
    committer: null,
    sha: "string",
    parents: [{ sha: "someString", url: "someString" }],
};

const getCommitsResponse: OctokitResponse<ICommit[]> = {
    status: 200,
    headers: { status: "200 OK" },
    url: "",
    data: [commitObj],
};

const pullRequestSimple: IPullRequestSimple = {
    html_url: "someString",
    number: 22,
    title: "someString",
    user: sampleUser, // ISimpleUser | null,
    body: `Good stuff\r\n\r\ncc: ${fromEmail}`, // string | null,
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

const prListResponse: OctokitResponse<IPullRequestSimple> = {
    status: 200,
    headers: { status: "200 OK" },
    url: "",
    data: pullRequestSimple,
};

const issueCommentResponse: OctokitResponse<IIssueComment> = {
    status: 200,
    headers: { status: "200 OK" },
    url: "",
    data: {
        html_url: "someString",
        id: 40,
    },
};

test("test not a pr related email", async () => {
    const repo = await testCreateRepo(sourceFileName, "-unrelated");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "pull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };

    const replyMessageId = `i${mailMeta.messageID}`;

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId}>
From:   jester <jester@gmail.com>
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 1/3] A Normal Patch
Content-Type: text/plain; charset=UTF-8
In-Reply-To: <not${mailMeta.messageID}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    await repo.commit("1", "1", mbox0);

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~" },
        "master",
    );

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
    logSpy.mockRestore();
});

test("test already seen", async () => {
    const repo = await testCreateRepo(sourceFileName, "-seen");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "pull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${mailMeta.messageID}>
From:   jester <jester@gmail.com>
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    await repo.commit("1", "1", mbox0);

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~" },
        "master",
    );

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(2); // verify no more errors
    expect(logSpy.mock.calls[1][0]).toMatch(/Already handled:/);
    logSpy.mockRestore();
});

test("test reply to cover letter", async () => {
    const repo = await testCreateRepo(sourceFileName, "-cover");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "pull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };
    const replyMessageId = `i${mailMeta.messageID}`;

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId}>
From:   ${fromEmail}
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
References: <${mailMeta.messageID}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    await repo.commit("1", "1", mbox0);

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    github.fakeAuthenticated(config.repo.owner);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~" },
        "master",
    );

    const commitsResponse = getCommitsResponse;
    const fail = false;

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async (_request, options) => {
        if ("/repos/{owner}/{repo}/pulls/{pull_number}" === options.url) {
            return prListResponse;
        }
        if ("/repos/{owner}/{repo}/issues/{issue_number}/comments" === options.url) {
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies" === options.url) {
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments" === options.url) {
            if (fail) {
                throw new Error("Force switch to comment");
            }
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/commits" === options.url) {
            return commitsResponse;
        }
        console.log(JSON.stringify(options, null, 2));
        return issueCommentResponse; // dummy
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(2); // verify no more errors
    logSpy.mockRestore();

    const data = await notes.get<IMailMetadata>(replyMessageId);
    expect(data).toBeDefined();
    expect(data?.pullRequestURL).toEqual(mailMeta.pullRequestURL);
});

test("test reply to patch letter", async () => {
    const repo = await testCreateRepo(sourceFileName, "-patchr");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "ppull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };

    const replyMessageId = `i${mailMeta.messageID}`;
    const replyMessageId1 = `j${mailMeta.messageID}`;

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId}>
From:   ${fromEmail}
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
References: <${mailMeta.messageID}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    const emailCommit = await repo.commit("1", "1", mbox0);
    mailMeta.originalCommit = emailCommit;

    // reply to reply
    const mbox1 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId1}>
From:   ${fromEmail}
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
References: <${mailMeta.messageID}> <${replyMessageId}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    await repo.commit("1", "1", mbox1);

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    github.fakeAuthenticated(config.repo.owner);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~~" },
        "master",
    );

    const commitsResponse = getCommitsResponse;
    const fail = false;

    let commentBody = "";

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async (_request, options) => {
        if ("/repos/{owner}/{repo}/pulls/{pull_number}" === options.url) {
            return prListResponse;
        }
        if ("/repos/{owner}/{repo}/issues/{issue_number}/comments" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments" === options.url) {
            if (fail) {
                throw new Error("Force switch to comment");
            }
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/commits" === options.url) {
            return commitsResponse;
        }
        console.log(JSON.stringify(options, null, 2));
        return issueCommentResponse; // dummy
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(3); // verify no more errors
    logSpy.mockRestore();
    expect(commentBody).not.toMatch(/outdated/);

    {
        // allow name reuse
        const data = await notes.get<IMailMetadata>(replyMessageId);
        expect(data).toBeDefined();
        expect(data?.pullRequestURL).toEqual(mailMeta.pullRequestURL);
    }

    // check reply to reply tracking
    const data = await notes.get<IMailMetadata>(replyMessageId1);
    expect(data).toBeDefined();
    expect(data?.pullRequestURL).toEqual(mailMeta.pullRequestURL);
    expect(data?.issueCommentId).toEqual(issueCommentResponse.data.id);
    expect(data?.messageID).toEqual(replyMessageId1);
    expect(data?.originalCommit).toEqual(mailMeta.originalCommit);
});

test("test reply to outdated patch letter (throws error)", async () => {
    const repo = await testCreateRepo(sourceFileName, "-patcho");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "ppull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };

    const replyMessageId = `i${mailMeta.messageID}`;

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId}>
From:   ${fromEmail}
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
References: <${mailMeta.messageID}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    const emailCommit = await repo.commit("1", "1", mbox0);
    mailMeta.originalCommit = emailCommit;

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    github.fakeAuthenticated(config.repo.owner);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~" },
        "master",
    );

    const commitsResponse = getCommitsResponse;
    const fail = true;

    let commentBody = "";

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async (_request, options) => {
        if ("/repos/{owner}/{repo}/pulls/{pull_number}" === options.url) {
            return prListResponse;
        }
        if ("/repos/{owner}/{repo}/issues/{issue_number}/comments" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments" === options.url) {
            if (fail) {
                throw new Error("Force switch to comment");
            }
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/commits" === options.url) {
            return commitsResponse;
        }
        console.log(JSON.stringify(options, null, 2));
        return issueCommentResponse; // dummy
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(2); // verify no more errors
    logSpy.mockRestore();
    expect(commentBody).toMatch(/outdated/);

    const data = await notes.get<IMailMetadata>(replyMessageId);
    expect(data).toBeDefined();
    expect(data?.pullRequestURL).toEqual(mailMeta.pullRequestURL);
});

test("test reply to not outdated patch letter (throws error)", async () => {
    const repo = await testCreateRepo(sourceFileName, "-patchn");
    await repo.commit("1", "1", ""); // need at least one commit to back up to

    const mailMeta: IMailMetadata = {
        messageID: "ppull.12345.v1.git.gitgitgadget@example.com",
        originalCommit: "feeddeadbeef",
        pullRequestURL: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/1`,
        firstPatchLine: 5,
    };

    const replyMessageId = `i${mailMeta.messageID}`;

    const mbox0 = `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <${replyMessageId}>
From:   ${fromEmail}
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Content-Type: text/plain; charset=UTF-8
References: <${mailMeta.messageID}>
To: reviewer@example.com

This Pull Request contains some ipsum lorem.
`;
    const emailCommit = await repo.commit("1", "1", mbox0);
    mailMeta.originalCommit = emailCommit;

    const github = new GitHubProxy(repo.workDir, config.repo.owner, config.repo.name);
    github.fakeAuthenticated(config.repo.owner);
    const notes = new GitNotes(repo.workDir);
    await notes.set(mailMeta.messageID, mailMeta, true);

    const mail = new MailArchiveGitHelperProxy(
        config,
        notes,
        repo.workDir,
        github,
        { latestRevision: "HEAD~" },
        "master",
    );

    const commitsResponse = getCommitsResponse;
    commitsResponse.data[0].sha = mailMeta.originalCommit;
    const fail = true;

    let commentBody = "";

    // eslint-disable-next-line @typescript-eslint/require-await
    github.octo.hook.wrap("request", async (_request, options) => {
        if ("/repos/{owner}/{repo}/pulls/{pull_number}" === options.url) {
            return prListResponse;
        }
        if ("/repos/{owner}/{repo}/issues/{issue_number}/comments" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies" === options.url) {
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/comments" === options.url) {
            if (fail) {
                throw new Error("Force switch to comment");
            }
            commentBody = options.body as string;
            return issueCommentResponse;
        }
        if ("/repos/{owner}/{repo}/pulls/{pull_number}/commits" === options.url) {
            return commitsResponse;
        }
        console.log(JSON.stringify(options, null, 2));
        return issueCommentResponse; // dummy
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await mail.processMails();
    expect(logSpy).toHaveBeenCalledTimes(2); // verify no more errors
    logSpy.mockRestore();
    expect(commentBody).not.toMatch(/outdated/);

    const data = await notes.get<IMailMetadata>(replyMessageId);
    expect(data).toBeDefined();
    expect(data?.pullRequestURL).toEqual(mailMeta.pullRequestURL);
});
