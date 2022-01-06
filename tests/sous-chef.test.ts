import { expect, test } from "@jest/globals";
import * as fs from "fs";
import { SousChef } from "../lib/sous-chef";

const mboxFixturePath = `${__dirname}/fixtures/whats-cooking-2021-02-10.mbox`;

test("Parse What's Cooking mail", async () => {
    const mbox = await fs.promises.readFile(mboxFixturePath);
    const sousChef = new SousChef(mbox.toString());
    expect(sousChef.messageID)
        .toEqual("xmqqim6zz8x6.fsf@gitster.c.googlers.com");
    const branchInfo = sousChef.branches.get("js/rebase-i-commit-cleanup-fix");
    expect(branchInfo).not.toBeUndefined();
    expect(branchInfo?.merged)
        .toEqual("(merged to 'next' on 2021-01-31 at 358f562e1f)");
    expect(branchInfo?.sectionName).toEqual("Graduated to 'master'");
    const text =
        `When "git rebase -i" processes "fixup" insn, there is no reason to
clean up the commit log message, but we did the usual stripspace
processing.  This has been corrected.`;
    expect(branchInfo?.text).toEqual(text);
});