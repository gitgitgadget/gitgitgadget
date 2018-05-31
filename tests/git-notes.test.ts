import "jest";
import { emptyBlobName, git } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { isDirectory, testCreateRepo } from "./test-lib";

test("set/get notes", async () => {
    const workDir = await testCreateRepo(__filename);
    expect(await isDirectory(`${workDir}/.git`)).toBeTruthy();

    const notes = new GitNotes(workDir);
    expect(await notes.getString("hello")).toBeUndefined();

    expect(await notes.setString("hello", "world")).toBeUndefined();
    expect(await notes.getString("hello")).toEqual("world");

    expect(await git(["log", "-p", "refs/notes/gitgitgadget"], {
        workDir,
    })).toMatch(/\n\+hello$/);

    const pullRequestURL = "https://github.com/gitgitgadget/git/pull/1";
    const metadata: IPatchSeriesMetadata = {
        baseCommit: "0123456789012345678901234567890123456789",
        baseLabel: "gitgitgadget:test",
        coverLetterMessageId: "cover.1234567890.gitgitgadget.pull.1@github.com",
        headCommit: "1023456789012345678901234567890123456789",
        headLabel: "somebody:test2",
        iteration: 1,
        pullRequestURL,
    };
    expect(await notes.set(pullRequestURL, metadata)).toBeUndefined();
    expect(await notes.get<IPatchSeriesMetadata>(pullRequestURL))
        .toEqual(metadata);
});
