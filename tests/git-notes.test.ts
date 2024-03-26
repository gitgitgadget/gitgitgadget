import { expect, jest, test } from "@jest/globals";
import { isDirectory } from "../lib/fs-util";
import { git, revParse } from "../lib/git";
import { GitNotes, POJO } from "../lib/git-notes";
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
    expect(commit).not.toBeUndefined();
    expect(await notes.appendCommitNote(commit as string, "1")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1");
    expect(await notes.appendCommitNote(commit as string, "2")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1\n\n2");
    expect(await notes.getLastCommitNote(commit as string)).toEqual("2");
});

test("notesMerge()", async () => {
    const repo = await testCreateRepo(__filename);
    const notes = new GitNotes(repo.workDir);

    const somePrimeNumbers = [2, 3, 7, 11, 13];
    const o: POJO = { hello: "world", somePrimeNumbers };
    o.extra = true;
    const o2 = JSON.parse(JSON.stringify(o)) as POJO; // o.clone()

    await notes.set("", o);
    const commit = await revParse(notes.notesRef, repo.workDir);
    expect(commit).not.toBeUndefined();
    await notes.appendCommitNote(commit as string, "first note");

    // branch off
    const branchPoint = await revParse(notes.notesRef, repo.workDir);
    await notes.appendCommitNote(commit as string, "low note");
    somePrimeNumbers.push(17);
    o.hello = "World!!!";
    delete o.extra;
    await notes.set("", o, true);
    const branch1 = await revParse(notes.notesRef, repo.workDir);

    // rewind and make some local-first changes
    await git(["update-ref", notes.notesRef, branchPoint as string, branch1 as string], { workDir: repo.workDir });
    await notes.appendCommitNote(commit as string, "second note");
    await notes.setString("notes", "tsforyou");
    o2.hello = "you!";
    (o2.somePrimeNumbers as number[]).splice(2, 2);
    (o2.somePrimeNumbers as number[]).push(29);
    o2.oh = ["hai", "cat"];
    await notes.set("", o2, true);

    // now merge branch1 (or: replay HEAD onto branch1)
    await notes.notesSync(branch1 as string);

    const o3 = await notes.get("") as POJO;
    expect(o3.extra).toBeUndefined();
    expect(o3.somePrimeNumbers).toEqual([2, 3, 13, 17, 29]);
    expect(o3.hello).toEqual("you!");
    expect(o3.oh).toEqual(["hai", "cat"]);

    const addedNotes = await notes.getCommitNotes(commit as string);
    expect(addedNotes).toEqual(`first note\n\nlow note\n\nsecond note`);
});
