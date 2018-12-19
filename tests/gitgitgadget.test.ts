import "jest";
import { git, gitCommandExists, gitConfig, revParse } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { GitGitGadget, IGitGitGadgetOptions } from "../lib/gitgitgadget";
import { PatchSeries } from "../lib/patch-series";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { ProjectOptions } from "../lib/project-options";
import {
    ITestCommitOptions, testCreateRepo, TestRepo,
} from "./test-lib";

// This test script might take quite a while to run
jest.setTimeout(60000);

const expectedMails = [
    `From 07f68c195159518c5777ca4a7c1d07124e7a9956 Mon Sep 17 00:00:00 2001
Message-Id: <pull.<Message-ID>>
From: "GitHub User via GitGitGadget" <gitgitgadget@example.com>
Date: <Cover-Letter-Date>
Subject: [PATCH 0/3] My first Pull Request!
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>

This Pull Request contains some really important changes that I would love
to have included in git.git [https://github.com/git/git].

Contributor (1):
  B

Developer (1):
  C

Test Dev (1):
  A

 A.t | 1 +
 B.t | 1 +
 C.t | 1 +
 3 files changed, 3 insertions(+)
 create mode 100644 A.t
 create mode 100644 B.t
 create mode 100644 C.t


base-commit: c241357a04a6f862ceef20bd148946085f3178b9
Published-As: https://github.com/gitgitgadget/git/releases/tags/${
    "pr-1/somebody/master-v1".replace(/\//g, "%2F")}
Fetch-It-Via: git fetch https://github.com/gitgitgadget/git ${
    ""}pr-1/somebody/master-v1
Pull-Request: https://github.com/gitgitgadget/git/pull/1
--${" "}
gitgitgadget
`, `From cd048a1378e3f7b055cd467ff3a24ed0cf5e7453 Mon Sep 17 00:00:00 2001
Message-Id: <cd048a1378e3f7b055cd467ff3a24ed0cf5e7453.<Message-ID>>
In-Reply-To: <pull.<Message-ID>>
References: <pull.<Message-ID>>
From: "Test Dev via GitGitGadget" <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:33:30 +0000
Subject: [PATCH 1/3] A
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>,
    Test Dev <dev@example.com>

From: Test Dev <dev@example.com>

---
 A.t | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 A.t

diff --git a/A.t b/A.t
new file mode 100644
index 0000000..8c7e5a6
--- /dev/null
+++ b/A.t
@@ -0,0 +1 @@
+A
\\ No newline at end of file
--${" "}
gitgitgadget

`, `From b8acfa2635f9907e472d2b7396b260c6e73b1ed5 Mon Sep 17 00:00:00 2001
Message-Id: <b8acfa2635f9907e472d2b7396b260c6e73b1ed5.<Message-ID>>
In-Reply-To: <pull.<Message-ID>>
References: <pull.<Message-ID>>
From: "Contributor via GitGitGadget" <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:34:30 +0000
Subject: [PATCH 2/3] B
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>,
    Contributor <contributor@example.com>

From: Contributor <contributor@example.com>

---
 B.t | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 B.t

diff --git a/B.t b/B.t
new file mode 100644
index 0000000..7371f47
--- /dev/null
+++ b/B.t
@@ -0,0 +1 @@
+B
\\ No newline at end of file
--${" "}
gitgitgadget

`, `From 07f68c195159518c5777ca4a7c1d07124e7a9956 Mon Sep 17 00:00:00 2001
Message-Id: <07f68c195159518c5777ca4a7c1d07124e7a9956.<Message-ID>>
In-Reply-To: <pull.<Message-ID>>
References: <pull.<Message-ID>>
From: "Developer via GitGitGadget" <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:35:30 +0000
Subject: [PATCH 3/3] C
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>,
    Developer <developer@example.com>

From: Developer <developer@example.com>

---
 C.t | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 C.t

diff --git a/C.t b/C.t
new file mode 100644
index 0000000..96d80cd
--- /dev/null
+++ b/C.t
@@ -0,0 +1 @@
+C
\\ No newline at end of file
--${" "}
gitgitgadget
`,
];

test("generate tag/notes from a Pull Request", async () => {
    const debug = true;
    const logger = !debug ? console : {
        log: (message: string): void => {
            /* do nothing */
        },
    };
    const repo = await testCreateRepo(__filename);
    const notes = new GitNotes(repo.workDir);

    const gitGitGadgetOptions: IGitGitGadgetOptions = {
        allowedUsers: ["somebody"],
    };
    expect(await notes.set("", gitGitGadgetOptions)).toBeUndefined();
    expect(await notes.get("")).toEqual(gitGitGadgetOptions);

    await repo.git(["config", "user.name", "Test Dev"]);
    await repo.git(["config", "user.email", "dev@example.com"]);

    expect(await repo.commit("initial")).not.toEqual("");
    expect(await repo.newBranch("test-run")).toEqual("");
    const baseCommit = await repo.revParse("HEAD");
    expect(await repo.commit("A")).not.toEqual("");

    repo.options.author = "Contributor <contributor@example.com>";
    expect(await repo.commit("B")).not.toEqual("");
    delete repo.options.author;

    repo.options.author = "Developer <developer@example.com>";
    repo.options.committer = "Committer <committer@example.com>";
    expect(await repo.commit("C")).not.toEqual("");
    delete repo.options.author;
    delete repo.options.committer;
    const headCommit = await repo.revParse("HEAD");

    const pullRequestURL = "https://github.com/gitgitgadget/git/pull/1";
    // tslint:disable-next-line:max-line-length
    const description = `My first Pull Request!

This Pull Request contains some really important changes that I would love to${
        ""} have included in [git.git](https://github.com/git/git).

Cc: Some Body <somebody@example.com>
`;
    const match2 = description.match(/^([^]+)\n\n([^]+)$/);
    expect(match2).toBeTruthy();

    await git(["config", "user.name", "GitGitGadget"], repo.options);
    await git(["config", "user.email", "gitgitgadget@example.com"],
        repo.options);

    const patches = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description,
        "gitgitgadget:next", baseCommit,
        "somebody:master", headCommit, "GitHub User");

    expect(patches.coverLetter).toEqual(`My first Pull Request!

This Pull Request contains some really important changes that I would love
to have included in git.git [https://github.com/git/git].`);

    const mails = [];
    const midRegex = new RegExp("<(pull|[0-9a-f]{40})"
        + "\\.\\d+(\\.v\\d+)?\\.git\\.gitgitgadget@example\\.com>", "g");
    async function send(mail: string): Promise<string> {
        if (mails.length === 0) {
            mail = mail.replace(/(\nDate: ).*/, "$1<Cover-Letter-Date>");
        }
        mails.push(mail.replace(midRegex, "<$1.<Message-ID>>"));

        return "Message-ID";
    }
    expect(await patches.generateAndSend(logger, send, undefined,
        pullRequestURL))
        .toEqual("pull.1.git.gitgitgadget@example.com");
    expect(mails).toEqual(expectedMails);

    expect(await repo.commit("D")).not.toEqual("");

    const headCommit2 = await repo.revParse("HEAD");
    const patches2 = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description,
        "gitgitgadget:next", baseCommit,
        "somebody:master", headCommit2, "GitHub User");
    mails.splice(0);
    expect(await patches2.generateAndSend(logger, send, undefined,
        pullRequestURL))
        .toEqual("pull.1.v2.git.gitgitgadget@example.com");
    expect(mails.length).toEqual(5);
    if (await gitCommandExists("range-diff", repo.workDir)) {
        expect(mails[0]).toMatch(/Range-diff vs v1:\n[^]*\n -: .* 4: /);
    }
    expect(await repo.revParse("pr-1/somebody/master-v2")).toBeDefined();

    expect(await notes.get(pullRequestURL)).toEqual({
        baseCommit,
        baseLabel: "gitgitgadget:next",
        coverLetterMessageId: "pull.1.v2.git.gitgitgadget@example.com",
        headCommit: headCommit2,
        headLabel: "somebody:master",
        iteration: 2,
        latestTag: "pr-1/somebody/master-v2",
        pullRequestURL,
        referencesMessageIds: [
            "pull.1.git.gitgitgadget@example.com",
        ],
    } as IPatchSeriesMetadata);

    // verify that the tag was generated correctly
    expect((await git(["cat-file", "tag", "pr-1/somebody/master-v2"],
        repo.options))
        .replace(/^[^]*?\n\n/, "")).toEqual(`My first Pull Request!

This Pull Request contains some really important changes that I would love
to have included in git.git [https://github.com/git/git].

Contributor (1):
  B

Developer (1):
  C

GitGitGadget (1):
  D

Test Dev (1):
  A

 A.t | 1 +
 B.t | 1 +
 C.t | 1 +
 D.t | 1 +
 4 files changed, 4 insertions(+)
 create mode 100644 A.t
 create mode 100644 B.t
 create mode 100644 C.t
 create mode 100644 D.t

base-commit: c241357a04a6f862ceef20bd148946085f3178b9

Submitted-As: https://dummy.com/?mid=pull.1.v2.git.gitgitgadget@example.com
In-Reply-To: https://dummy.com/?mid=pull.1.git.gitgitgadget@example.com`);
});

test("allow/disallow", async () => {
    const repo = await testCreateRepo(__filename);
    const workDir = repo.workDir;
    const remote = await testCreateRepo(__filename, "-remote");

    await git(["config", "gitgitgadget.workDir", workDir], { workDir });
    await git(["config",
        "gitgitgadget.publishRemote", remote.workDir], { workDir });
    await git(["config", "gitgitgadget.smtpUser", "test"], { workDir });
    await git(["config", "gitgitgadget.smtpHost", "test"], { workDir });
    await git(["config", "gitgitgadget.smtpPass", "test"], { workDir });

    const notes = new GitNotes(remote.workDir);
    await notes.set("", {} as IGitGitGadgetOptions);

    const gitGitGadget = await GitGitGadget.get(workDir);

    // pretend that the notes ref had been changed in the meantime
    await notes.set("",
        { allowedUsers: ["first-one"] } as IGitGitGadgetOptions, true);

    expect(gitGitGadget.isUserAllowed("second-one")).toBeFalsy();
    expect(await gitGitGadget.allowUser("first-one", "second-one"))
        .toBeTruthy();
    expect(await gitGitGadget.allowUser("first-one", "second-one"))
        .toBeFalsy();
    expect(gitGitGadget.isUserAllowed("second-one")).toBeTruthy();
    expect(await gitGitGadget.denyUser("first-one", "second-one"))
        .toBeTruthy();
    expect(await gitGitGadget.denyUser("first-one", "second-one"))
        .toBeFalsy();
    expect(gitGitGadget.isUserAllowed("second-one")).toBeFalsy();
});
