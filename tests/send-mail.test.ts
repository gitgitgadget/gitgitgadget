import "jest";
import { parseMBox } from "../lib/send-mail";

const mbox =
    `From 566155e00ab72541ff0ac21eab84d087b0e882a5 Mon Sep 17 00:00:00 2001
Message-Id: <pull.12345.v17.git.gitgitgadget@example.com>
From:   =?utf-8?B?w4Z2YXIgQXJuZmrDtnLDsA==?= Bjarmason <avarab@gmail.com>
Date: Fri Sep 21 12:34:56 2001
Subject: [PATCH 0/3] My first Pull Request!
Fcc: Sent
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit
MIME-Version: 1.0
To: reviewer@example.com
Cc: Some Body <somebody@example.com>,
 And Somebody Else <somebody@else.org>

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
`;

test("parse mbox", async () => {
    const parsed = await parseMBox(mbox);
    expect(parsed.from).toEqual("Ævar Arnfjörð Bjarmason <avarab@gmail.com>");
    expect(parsed.cc).toEqual([
        "Some Body <somebody@example.com>",
        "And Somebody Else <somebody@else.org>",
    ]);
    expect(parsed.subject).toEqual("[PATCH 0/3] My first Pull Request!");
    expect(parsed.headers).toEqual([
        { key: "Content-Type", value: "text/plain; charset=UTF-8" },
        { key: "Content-Transfer-Encoding", value: "8bit" },
        { key: "MIME-Version", value: "1.0" },
    ]);
    expect(parsed.to).toEqual("reviewer@example.com");
});
