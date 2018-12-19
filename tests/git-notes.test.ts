import "jest";
import { isDirectory } from "../lib/fs-util";
import { git, revParse } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { testCreateRepo } from "./test-lib";

// This test script might take quite a while to run
jest.setTimeout(60000);

test("set/get notes", async () => {
    const repo = await testCreateRepo(__filename);
    expect(await isDirectory(`${repo.workDir}/.git`)).toBeTruthy();

    const notes = new GitNotes(repo.workDir);

    expect(await notes.getString("hello")).toBeUndefined();
    expect(await notes.setString("hello", "world")).toBeUndefined();
    expect(await notes.getString("hello")).toEqual("world");

    expect(await git(["log", "-p", "refs/notes/gitgitgadget"], {
        workDir: repo.workDir,
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

    const commit = await revParse(notes.notesRef, notes.workDir);
    expect(await notes.appendCommitNote(commit, "1")).toEqual("");
    expect(await notes.getCommitNotes(commit)).toEqual("1");
    expect(await notes.appendCommitNote(commit, "2")).toEqual("");
    expect(await notes.getCommitNotes(commit)).toEqual("1\n\n2");
    expect(await notes.getLastCommitNote(commit)).toEqual("2");
});
