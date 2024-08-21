import { expect, jest, test } from "@jest/globals";
import { fileURLToPath } from 'url';
import { isDirectory } from "../lib/fs-util.js";
import { git, revParse } from "../lib/git.js";
import { GitNotes } from "../lib/git-notes.js";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata.js";
import { testCreateRepo } from "./test-lib.js";

// This test script might take quite a while to run
jest.setTimeout(60000);
const sourceFileName = fileURLToPath(import.meta.url);

test("set/get notes", async () => {
    const repo = await testCreateRepo(sourceFileName);
    expect(await isDirectory(`${repo.workDir}/.git`)).toBeTruthy();

    const notes = new GitNotes(repo.workDir);

    expect(await notes.getString("hello")).toBeUndefined();
    expect(await notes.setString("hello", "world")).toBeUndefined();
    expect(await notes.getString("hello")).toEqual("world");

    expect(await git(["log", "-p", "refs/notes/gitgitgadget"], {
        workDir: repo.workDir,
    })).toMatch(/\n\+hello$/);

    const gitURL = "https://github.com/gitgitgadget/git";
    const pullRequestURL = `${gitURL}/git/pull/1`;
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
    expect(commit).not.toBeUndefined();
    expect(await notes.appendCommitNote(commit as string, "1")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1");
    expect(await notes.appendCommitNote(commit as string, "2")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1\n\n2");
    expect(await notes.getLastCommitNote(commit as string)).toEqual("2");

    // error tests for update
    await expect(notes.update(gitURL)).resolves.toBeUndefined();
    const notesM2C = new GitNotes(repo.workDir, "refs/notes/mail-to-commit");
    await expect(notesM2C.update(gitURL)).resolves.toBeUndefined();
    const notesC2M = new GitNotes(repo.workDir, "refs/notes/commit-to-mail");
    await expect(notesC2M.update(gitURL)).resolves.toBeUndefined();
    const notesBad = new GitNotes(repo.workDir, "unknown");
    await expect(notesBad.update(gitURL)).rejects.toThrow(/know how to update/);
    const notesNotM2Chead = new GitNotes(repo.workDir, "xrefs/notes/mail-to-commit");
    await expect(notesNotM2Chead.update(gitURL)).rejects.toThrow(/know how to update/);
    const notesNotM2Ctail = new GitNotes(repo.workDir, "refs/notes/mail-to-commitx");
    await expect(notesNotM2Ctail.update(gitURL)).rejects.toThrow(/know how to update/);

});
