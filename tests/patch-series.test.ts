import { expect, jest, test } from "@jest/globals";
import { fileURLToPath } from "url";
import { git } from "../lib/git.js";
import { GitNotes } from "../lib/git-notes.js";
import { PatchSeries } from "../lib/patch-series.js";
import { ProjectOptions } from "../lib/project-options.js";
import { testCreateRepo } from "./test-lib.js";
import defaultConfig from "../lib/gitgitgadget-config.js";

jest.setTimeout(60000);
const sourceFileName = fileURLToPath(import.meta.url);

const mbox1 = `From 38d1082511bb02a709f203481c2787adc6e67c02 Mon Sep 17 00:00:00 2001
Message-Id: <cover.3.git.author@example.com>
From: A U Thor
 <author@example.com>
Date: Tue, 1 May 2018 09:00:00 -0400
Subject: [PATCH 0/1] *** SUBJECT HERE ***

*** BLURB HERE ***

This is the subject of the cover letter that
wraps around

This is the actual body of the cover letter.

A U Thor (1):
    Some commit subject that is so long that it goes well over the 76 columns
    that are the recommended limit for onelines

    README.md | 5 +++++
    1 file changed, 5 insertions(+)

--${/* we really want that space: */ " "}
2.17.0.windows.1

From 34042ac7b177e6e5ae2d12f7a39ca3ab5993d817 Mon Sep 17 00:00:00 2001
In-Reply-To: <cover.3.git.author@example.com>
References: <cover.3.git.author@example.com>
From: Some One Else <some@one-el.se>
Date: Tue, 01 Feb 2018 01:02:03 +0400
Subject: [PATCH 1/1] Some commit subject that is so long that it goes well
 over the 76 columns that are the recommended limit for onelines

Some very terse commit message.
---
 README.md | 5 +++++
 1 file changed, 5 insertions(+)

diff --git a/README.md b/README.md
index fa400f1..daf4bc3 100755
--- a/README.md
+++ b/README.md
@@ -0,0 +1,5 @@
+This is a placeholder
+
+It does not say much,
+Though maybe some day it might;
+That would take effort.
---
2.17.0.windows.1
`;
const tagMessage1 = `This is the subject of the cover letter that wraps around

This is the actual body of the cover letter.

A U Thor (1):
    Some commit subject that is so long that it goes well over the 76 columns
    that are the recommended limit for onelines

    README.md | 5 +++++
    1 file changed, 5 insertions(+)

Submitted-As: https://mid.lookup/cover.3.git.author@example.com
In-Reply-To: https://mid.lookup/cover.2.git.author@example.com
In-Reply-To: https://mid.lookup/cover.1.git.author@example.com`;

class PatchSeriesTest extends PatchSeries {
    public static runTests(): void {
        const mails = PatchSeries.splitMails(mbox1);

        test("mails are split correctly", () => {
            expect(mails).toHaveLength(2);
            expect(mails[0]).toMatch(/^From [^]*\n-- \n2\.17\.0\.windows\.1\n$/);
            expect(mails[1]).toMatch(/^From [^]*\n---\n2\.17\.0\.windows\.1\n$/);
        });

        const thisAuthor = "GitGitGadget <gitgitgadget@gmail.com>";
        const senderName = "Nguyễn Thái Ngọc Duy";
        const prMeta = {
            baseCommit: "",
            baseLabel: "",
            headCommit: "",
            headLabel: "",
            iteration: 1,
        };
        class ProjectOptionsTest extends ProjectOptions {
            public constructor() {
                super("", "", "", "", "", [], "", "");
            }
        }

        const x = new PatchSeriesTest(
            defaultConfig,
            new GitNotes(),
            {},
            new ProjectOptionsTest(),
            prMeta,
            undefined,
            1,
        );

        x.insertCcAndFromLines(mails, thisAuthor, senderName);

        test("non-ASCII characters are encoded correctly", () => {
            const needle = '"=?UTF-8?Q?Nguy=E1=BB=85n_Th=C3=A1i_Ng=E1=BB=8Dc?= Duy via GitGitGadget" ';
            expect(mails[0]).toEqual(expect.stringContaining(needle));
        });

        test("sender names are quoted properly", () => {
            const pairs: { [sender: string]: string | string[] | boolean } = {
                "bee <nobody <email.org>": '"bee <nobody" <email.org>',
                "bob@obo <email.org>": '"bob@obo" <email.org>',
                "excited! <email.org>": false,
                "foo [bar] name <email.org>": '"foo [bar] name" <email.org>',
                'harry "s" truman <usa.gov>': [
                    '"harry \\"s\\" truman" <usa.gov>',
                    "harry =?UTF-8?Q?=22s=22?= truman <usa.gov>",
                ],
                "mr. name <email.org>": '"mr. name" <email.org>',
                "ms. \\backslash <email.org>": '"ms. \\\\backslash" <email.org>',
                "my name <email.org>": false,
                "name <email.org>": false,
                "wile e. coyote <coyote@desert.net>": '"wile e. coyote" <coyote@desert.net>',
            };
            for (const sender of Object.keys(pairs)) {
                const expected = pairs[sender] || sender;
                const quoted = PatchSeries.encodeSender(sender);
                if (Array.isArray(expected)) {
                    expect(expected).toContain(quoted);
                } else {
                    expect(quoted).toEqual(expected);
                }
            }
        });

        test("Cc: is inserted correctly", () => {
            expect(mails[1]).toMatch(
                new RegExp(
                    'From: "Some One Else via ' +
                        'GitGitGadget"[^]*\\nCc: Some One Else[^]*\\n\\nFrom: Some One Else.*\\n\\n',
                ),
            );
        });

        const coverLetter = PatchSeries.adjustCoverLetter(mails[0]);
        test("Subject: header in cover letter is adjusted", () => {
            expect(coverLetter).toMatch(/\nSubject: .*This is the subject/);
        });

        const mids = ["cover.2.git.author@example.com", "cover.1.git.author@example.com"];
        const tagMessage = PatchSeries.generateTagMessage(coverLetter, true, "https://mid.lookup/", mids);
        test("Tag message is generated correctly", () => {
            expect(tagMessage).toBe(tagMessage1);
        });

        const repoUrl = "https://github.com/author/git";
        const withLinks = PatchSeries.insertLinks(tagMessage, repoUrl, "my-series-v1", "next");
        test("Links are inserted correctly", () => {
            const footer = `
Based-On: next at ${repoUrl}
Fetch-Base-Via: git fetch ${repoUrl} next
Published-As: ${repoUrl}/releases/tag/my-series-v1
Fetch-It-Via: git fetch ${repoUrl} my-series-v1
`;
            expect(withLinks).toBe(tagMessage1 + footer);
        });

        const footers = ["HEADER"].concat(
            ["This", "is", "a", "fake", "cover letter"].map((element: string): string => ` ${element}`),
        );

        const coverLetterWithRangeDiff = PatchSeries.insertFooters(coverLetter, true, footers);
        const mailWithRangeDiff = PatchSeries.insertFooters(mails[1], false, footers);
        test("range-diff is inserted correctly", () => {
            expect(coverLetterWithRangeDiff).toMatch(/\n\nHEADER\n This\n is\n a\n fake\n cover letter\n-- \n2\.17/);
            expect(mailWithRangeDiff).toMatch(
                new RegExp("\\n---\\n\\nHEADER\\n This\\n is\\n a\\n fake\\n cover letter\\n\\n README"),
            );
        });

        test("adjust mbox to forced date", () => {
            expect(mails).toHaveLength(2);
            const endDate = new Date(987654321000);
            expect(PatchSeries.adjustDateHeaders(mails, endDate)).toEqual(2);
            const dates = mails.map((mail: string): string => {
                const match = mail.match(/\nDate: (.*)\n/);
                if (!match) {
                    throw new Error(`No Date: header in ${mail}`);
                }
                return match[1];
            });
            expect(new Date(dates[0]).getTime()).toEqual(987654320000);
            expect(new Date(dates[1]).getTime()).toEqual(987654321000);
        });

        const mimeBox1 = [
            "From xyz",
            "MIME-Version: 1.0",
            "From: bogus@example.org",
            "MIME-Version:  1.0",
            "Cc: x1@me.org,",
            " x2@me.org",
            "MIME-Version: 1.0 ",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate MIME-Version headers are eliminated", () => {
            const mails1 = [mimeBox1];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(/MIME-Version[^]*MIME-Version/);
        });

        const mimeBox2 = [
            "From xyz",
            "MIME-Version: 1.0",
            "From: bogus@example.org",
            "MIME-Version: 2.0",
            "Cc: x1@me.org,",
            " x2@me.org",
            "",
            "Hi!",
        ].join("\n");
        test("different MIME-Version headers write to log", () => {
            const mails1 = [mimeBox2];
            const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

            PatchSeries.cleanUpHeaders(mails1);

            expect(logSpy.mock.calls[0][0]).toMatch(/Found multiple headers/);
            expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
            logSpy.mockRestore();
        });

        const contentTypeBox1 = [
            "From xyz",
            "Content-Type: text/plain; charset=UTF-8",
            "From: bogus@example.org",
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Type: text/plain; charset=UTF-8", // ensure positioning ok
            "Content-Type: text/plain; charset=UTF-8",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-Type: text/plain; charset=UTF-8",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate Content-Type headers are eliminated", () => {
            const mails1 = [contentTypeBox1];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(/Content-Type[^]*Content-Type/);
        });

        const contentTypeBox2 = [
            "From xyz",
            "Content-Type: text/plain; charset=UTF-8",
            "From: bogus@example.org",
            "Content-Type: text/plain; charset=UTF-16",
            "Cc: x1@me.org,",
            " x2@me.org",
            "",
            "Hi!",
        ].join("\n");
        test("different Content-Type headers write to log", () => {
            const mails1 = [contentTypeBox2];
            const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

            PatchSeries.cleanUpHeaders(mails1);

            expect(logSpy.mock.calls[0][0]).toMatch(/Found multiple headers/);
            expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
            logSpy.mockRestore();
        });

        const contentTypeBox3 = [
            "From xyz",
            "Content-Type: text/plain; charset=UTF-8",
            "From: bogus@example.org",
            "Content-Type: text/plain", // different but variant ignored
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-Type: text/plain; charset=UTF-8",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate Content-Type headers are eliminated (take 2)", () => {
            const mails1 = [contentTypeBox3];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(/Content-Type[^]*Content-Type/);
        });

        const contentTransferEncodingBox1 = [
            "From xyz",
            "Content-Transfer-Encoding: 8bit",
            "From: bogus@example.org",
            "Content-Transfer-Encoding: 8bit",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-Transfer-Encoding: 8bit",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate Content-Transfer-Encoding headers are eliminated", () => {
            const mails1 = [contentTransferEncodingBox1];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(new RegExp("Content-Transfer-Encoding[^]*Content-Transfer-Encoding"));
        });

        const contentTransferEncodingBox2 = [
            "From xyz",
            "Content-Transfer-Encoding: 8bit",
            "From: bogus@example.org",
            "Content-Transfer-Encoding: 16bit",
            "Cc: x1@me.org,",
            " x2@me.org",
            "",
            "Hi!",
        ].join("\n");
        test("different Content-Transfer-Encoding headers write to log", () => {
            const mails1 = [contentTransferEncodingBox2];
            const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

            PatchSeries.cleanUpHeaders(mails1);

            expect(logSpy.mock.calls[0][0]).toMatch(/Found multiple headers/);
            expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
            logSpy.mockRestore();
        });

        const contentDescriptionBox1 = [
            "From xyz",
            "Content-Description: fooba",
            "From: bogus@example.org",
            "Content-Description: fooba",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-Description: fooba",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate Content-Description headers throw error", () => {
            const mails1 = [contentDescriptionBox1];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(new RegExp("Content-Description[^]*Content-Description"));
        });

        const contentDescriptionBox2 = [
            "From xyz",
            "Content-Description: fooba",
            "From: bogus@example.org",
            "Content-Description: foobar",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-Description: fooba",
            "",
            "Hi!",
        ].join("\n");
        test("different Content-Description headers write to log", () => {
            const mails1 = [contentDescriptionBox2];
            const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

            PatchSeries.cleanUpHeaders(mails1);

            expect(logSpy.mock.calls[0][0]).toMatch(/Found multiple headers/);
            expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
            logSpy.mockRestore();
        });

        const contentIDBox1 = [
            "From xyz",
            "Content-ID: 1.0",
            "From: bogus@example.org",
            "Content-ID: 1.0",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-ID: 1.0",
            "",
            "Hi!",
        ].join("\n");
        test("duplicate Content-ID headers throw error", () => {
            const mails1 = [contentIDBox1];
            PatchSeries.cleanUpHeaders(mails1);
            expect(mails1[0]).not.toMatch(/Content-ID[^]*Content-ID/);
        });

        const contentIDBox2 = [
            "From xyz",
            "Content-ID: 1.0",
            "From: bogus@example.org",
            "Content-ID: 2.0",
            "Cc: x1@me.org,",
            " x2@me.org",
            "Content-ID: 1.0",
            "",
            "Hi!",
        ].join("\n");
        test("different Content-ID headers write to log", () => {
            const mails1 = [contentIDBox2];
            const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

            PatchSeries.cleanUpHeaders(mails1);

            expect(logSpy.mock.calls[0][0]).toMatch(/Found multiple headers/);
            expect(logSpy).toHaveBeenCalledTimes(1); // verify no more errors
            logSpy.mockRestore();
        });

        test("test parsePullRequest()", async () => {
            const repo = await testCreateRepo(sourceFileName);
            await git(["config", "gitgitgadget.workDir", repo.workDir], {
                workDir: repo.workDir,
            });
            await repo.newBranch("upstream/master");
            await repo.commit(
                "template",
                ".github/PULL_REQUEST_TEMPLATE.md",
                ["This is PR template", "Please read our guide to continue"].join("\n"),
            );

            const prTitle = "My test PR!";
            const basedOn = "Disintegration";

            let prBody = [
                "some description goes here",
                "",
                `based-on: ${basedOn}`,
                "Cc: Some Contributor <contributor@example.com>",
                "CC: Capital Letters <shout@out.loud>, Hello <hello@wor.ld>, without@any.explicit.name" +
                    "; Semi Cologne <semi@col.on>",
                "Cc:No Space <no@outer.space>",
                "Cc:   Several Space <i@love.spaces>",
                "Cc:	Even A. Tab <john@tabular.com>",
                "Cc: Git Maintainer <maintainer@gmail.com>",
                "This is PR template",
                "Please read our guide to continue",
            ].join("\r\n");

            let parsed = await PatchSeries.parsePullRequest(repo.workDir, prTitle, prBody, 76, "");

            expect(parsed.cc).toEqual([
                "Some Contributor <contributor@example.com>",
                "Capital Letters <shout@out.loud>",
                "Hello <hello@wor.ld>",
                "without@any.explicit.name",
                "Semi Cologne <semi@col.on>",
                "No Space <no@outer.space>",
                "Several Space <i@love.spaces>",
                "Even A. Tab <john@tabular.com>",
                "Git Maintainer <maintainer@gmail.com>",
            ]);

            const expectedCover = [prTitle, "", "some description goes here"].join("\n");

            expect(parsed.coverLetter).toEqual(expectedCover);
            expect(parsed.basedOn).toEqual(basedOn);

            // Only footers test
            prBody = [
                "Cc: Some Contributor <contributor@example.com>",
                "CC: Capital Letters <shout@out.loud>, Hello <hello@wor.ld>",
                `based-on: ${basedOn}`,
            ].join("\r\n");

            parsed = await PatchSeries.parsePullRequest(repo.workDir, prTitle, prBody, 76, "");

            expect(parsed.cc).toEqual([
                "Some Contributor <contributor@example.com>",
                "Capital Letters <shout@out.loud>",
                "Hello <hello@wor.ld>",
            ]);

            const expectedCover1 = [prTitle].join("\n");

            expect(parsed.coverLetter).toEqual(expectedCover1);
            expect(parsed.basedOn).toEqual(basedOn);

            // Empty body test
            prBody = "";

            parsed = await PatchSeries.parsePullRequest(repo.workDir, prTitle, prBody, 76, "");

            expect(parsed.cc).toEqual([]);

            expect(parsed.coverLetter).toEqual(expectedCover1);
        });
    }
}

PatchSeriesTest.runTests();
