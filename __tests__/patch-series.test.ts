import 'jest';
import { PatchSeries } from '../lib/patch-series';

const mbox1 =
    `From 38d1082511bb02a709f203481c2787adc6e67c02 Mon Sep 17 00:00:00 2001
Message-Id: <cover.3.git.author@example.com>
From: A U Thor <author@example.com>
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

-- 
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
const tagMessage1 =
`This is the subject of the cover letter that wraps around

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
    static runTests() {
        const mails = PatchSeries.splitMails(mbox1);

        test('mails are split correctly', () => {
            expect(mails.length).toBe(2);
            expect(mails[0]).toMatch(/^From [^]*\n-- \n2\.17\.0\.windows\.1\n$/);
            expect(mails[1]).toMatch(/^From [^]*\n---\n2\.17\.0\.windows\.1\n$/);
        });

        PatchSeries.insertCcAndFromLines(mails, 'A U Thor <author@example.com>');
        test('Cc: is inserted correctly', () => {
            expect(mails[1]).toMatch(/From: A U Thor[^]*\nCc: Some One Else[^]*\n\nFrom: Some One Else.*\n\n/);
        });

        const coverLetter = PatchSeries.adjustCoverLetter(mails[0]);
        test('Subject: header in cover letter is adjusted', () => {
            expect(coverLetter).toMatch(/\nSubject: .*This is the subject/);
        });

        const tagMessage = PatchSeries.generateTagMessage(coverLetter, true, 'https://mid.lookup/', [ 'cover.2.git.author@example.com', 'cover.1.git.author@example.com']);
        test('Tag message is generated correctly', () => {
            expect(tagMessage).toBe(tagMessage1);
        })

        const repoUrl = 'https://github.com/author/git';
        const withLinks = PatchSeries.insertLinks(tagMessage, repoUrl, 'my-series-v1', 'next');
        test('Links are inserted correctly', () => {
            const footer = '\nBased-On: next at ' + repoUrl + '\nFetch-Base-Via: git fetch ' + repoUrl + ' next\n' +
                'Published-As: ' + repoUrl + '/releases/tag/my-series-v1\nFetch-It-Via: git fetch ' + repoUrl + ' my-series-v1\n';
            expect(withLinks).toBe(tagMessage1 + footer);
        })

        const coverLetterWithBranchDiff = PatchSeries.insertBranchDiff(coverLetter, true, "HEADER", "This\nis\na\nfake\ncover letter\n");
        const mailWithBranchDiff = PatchSeries.insertBranchDiff(mails[1], false, "HEADER", "This\nis\na\nfake\ncover letter\n");
        test('Branch diff is inserted correctly', () => {
            expect(coverLetterWithBranchDiff).toMatch(/\n-- \n\nHEADER\n This\n is\n a\n fake\n cover letter\n\n2\.17/);
            expect(mailWithBranchDiff).toMatch(/\n---\n\nHEADER\n This\n is\n a\n fake\n cover letter\n\n README/);
        })
    }
}

PatchSeriesTest.runTests();