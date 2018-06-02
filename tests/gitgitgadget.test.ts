import "jest";
import { git, revParse } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { PatchSeries } from "../lib/patch-series";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { ProjectOptions } from "../lib/project-options";
import {
    isDirectory, ITestCommitOptions, testCommit, testCreateRepo,
} from "./test-lib";

const expectedMails = [
    `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <cover.<Message-ID>>
From: GitGitGadget <gitgitgadget@example.com>
Date: <Cover-Letter-Date>
Subject: [PATCH 0/3] My first Pull Request!
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>

This Pull Request contains some really important changes that I would love to
have included in git.git.

Contributor (1):
  B

Developer (1):
  C

GitGitGadget (1):
  A

 A.t | 1 +
 B.t | 1 +
 C.t | 1 +
 3 files changed, 3 insertions(+)
 create mode 100644 A.t
 create mode 100644 B.t
 create mode 100644 C.t


base-commit: 0ae4d8d45ce43d7ad56faff2feeacf8ed5293518
--${" "}
2.17.0.windows.1
`, `From 44e454a6c1acb125e95d3ba9f57242445fb6beeb Mon Sep 17 00:00:00 2001
Message-Id: <44e454a6c1acb125e95d3ba9f57242445fb6beeb.<Message-ID>>
In-Reply-To: <cover.<Message-ID>>
References: <cover.<Message-ID>>
From: GitGitGadget <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:33:30 +0000
Subject: [PATCH 1/3] A
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>

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
2.17.0.windows.1

`, `From 0f7ccd74ef817f36e77c07eb918ebee41f6ab9e7 Mon Sep 17 00:00:00 2001
Message-Id: <0f7ccd74ef817f36e77c07eb918ebee41f6ab9e7.<Message-ID>>
In-Reply-To: <cover.<Message-ID>>
References: <cover.<Message-ID>>
From: "Contributor via GitGitGadget" <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:34:30 +0000
Subject: [PATCH 2/3] B
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>
Cc: Contributor <contributor@example.com>

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
2.17.0.windows.1

`, `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <566155e00ab72541ff0ac21eab84d087b0e882a5.<Message-ID>>
In-Reply-To: <cover.<Message-ID>>
References: <cover.<Message-ID>>
From: "Contributor via GitGitGadget" <gitgitgadget@example.com>
Date: Fri, 13 Feb 2009 23:35:30 +0000
Subject: [PATCH 3/3] C
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>
Cc: Developer <developer@example.com>

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
2.17.0.windows.1
`,
];

test("generate tag/notes from a Pull Request", async () => {
    const debug = true;
    const logger = !debug ? console : {
        log: (message: string): void => {
            /* do nothing */
        },
    };
    const workDir = await testCreateRepo(__filename);
    const gitOpts: ITestCommitOptions = { workDir };

    await git(["config", "user.name", "GitGitGadget"], gitOpts);
    await git(["config", "user.email", "gitgitgadget@example.com"], gitOpts);

    expect(await testCommit(gitOpts, "initial")).not.toEqual("");
    expect(await git(["checkout", "-b", "test-run"], { workDir }))
        .toEqual("");
    const baseCommit = await revParse("HEAD", workDir);
    expect(await testCommit(gitOpts, "A")).not.toEqual("");
    const gitOpts2: ITestCommitOptions = {
        author: "Contributor <contributor@example.com>",
        workDir,
    };
    expect(await testCommit(gitOpts2, "B")).not.toEqual("");
    const gitOpts3: ITestCommitOptions = {
        author: "Developer <developer@example.com>",
        committer: "Committer <committer@example.com>",
        workDir,
    };
    expect(await testCommit(gitOpts3, "C")).not.toEqual("");
    const headCommit = await revParse("HEAD", workDir);

    const notes = new GitNotes(workDir);
    const pullRequestURL = "https://github.com/gitgitgadget/git/pull/1";
    const description = `My first Pull Request!

This Pull Request contains some really important changes that I would love to
have included in git.git.

Cc: Some Body <somebody@example.com>
`;
    const match2 = description.match(/^([^]+)\n\n([^]+)$/);
    expect(match2).toBeTruthy();

    const patches = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description, "next", baseCommit, "somebody:master", headCommit);

    expect(patches.coverLetter).toEqual(`My first Pull Request!

This Pull Request contains some really important changes that I would love to
have included in git.git.`);

    const mails = [];
    const midRegex = new RegExp("<(cover|[0-9a-f]{40})"
        + ".\\d+\\.git\\.gitgitgadget@example\\.com>", "g");
    async function send(mail: string): Promise<string> {
        if (mails.length === 0) {
            mail = mail.replace(/(\nDate: ).*/, "$1<Cover-Letter-Date>");
        }
        mails.push(mail.replace(midRegex, "<$1.<Message-ID>>"));

        return "Message-ID";
    }
    expect(await patches.generateAndSend(logger, send)).toEqual("Message-ID");
    expect(mails).toEqual(expectedMails);

    expect(await testCommit(gitOpts, "D")).not.toEqual("");

    const headCommit2 = await revParse("HEAD", workDir);
    const patches2 = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description,
        "gitgitgadget:next", baseCommit,
        "somebody:master", headCommit2);
    mails.splice(0);
    expect(await patches2.generateAndSend(logger, send)).toBeUndefined();
    expect(mails.length).toEqual(5);
    expect(await revParse("pr-1/somebody/master-v1", workDir)).toBeDefined();
});
