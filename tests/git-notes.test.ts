import { expect, jest, test } from "@jest/globals";
import { fileURLToPath } from "url";
import { isDirectory } from "../lib/fs-util.js";
import { emptyBlobName, git, revParse } from "../lib/git.js";
import { GitNotes, POJO } from "../lib/git-notes.js";
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

    expect(await git(["log", "-p", "refs/notes/gitgitgadget"], { workDir: repo.workDir })).toMatch(/\n\+hello$/);

    const gitURL = "https://github.com/gitgitgadget/git";
    // avoid network calls during tests
    const fakeRemote = `${repo.workDir}/.git/fake-remote`;
    await git(["init", "--bare", fakeRemote]);
    await git([`--git-dir=${fakeRemote}`, "notes", "--ref=gitgitgadget", "add", "-m", "{}", emptyBlobName]);
    await git([`--git-dir=${fakeRemote}`, "notes", "--ref=mail-to-commit", "add", "-m", "1", emptyBlobName]);
    await git([`--git-dir=${fakeRemote}`, "notes", "--ref=commit-to-mail", "add", "-m", "1", emptyBlobName]);
    await git(["config", `url.${fakeRemote}.insteadof`, gitURL], { workDir: repo.workDir });

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
    expect(await notes.get<IPatchSeriesMetadata>(pullRequestURL)).toEqual(metadata);

    const commit = await revParse(notes.notesRef, notes.workDir);
    expect(commit).not.toBeUndefined();
    expect(await notes.appendCommitNote(commit as string, "1")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1");
    expect(await notes.appendCommitNote(commit as string, "2")).toEqual("");
    expect(await notes.getCommitNotes(commit as string)).toEqual("1\n\n2");
    expect(await notes.getLastCommitNote(commit as string)).toEqual("2");

    // error tests for update
    for (const note of ["commit-to-mail", "mail-to-commit"]) {
        await expect(
            git(["update-ref", `refs/notes/${note}`, "refs/notes/gitgitgadget"], { workDir: repo.workDir }),
        ).resolves.toEqual("");
    }
    await expect(notes.update(".")).resolves.toBeUndefined();
    const notesM2C = new GitNotes(repo.workDir, "refs/notes/mail-to-commit");
    await expect(notesM2C.update(".")).resolves.toBeUndefined();
    const notesC2M = new GitNotes(repo.workDir, "refs/notes/commit-to-mail");
    await expect(notesC2M.update(".")).resolves.toBeUndefined();
    const notesBad = new GitNotes(repo.workDir, "unknown");
    await expect(notesBad.update(".")).rejects.toThrow(/know how to update/);
    const notesNotM2Chead = new GitNotes(repo.workDir, "xrefs/notes/mail-to-commit");
    await expect(notesNotM2Chead.update(".")).rejects.toThrow(/know how to update/);
    const notesNotM2Ctail = new GitNotes(repo.workDir, "refs/notes/mail-to-commitx");
    await expect(notesNotM2Ctail.update(".")).rejects.toThrow(/know how to update/);
});

test("notesSync()", async () => {
    const repo = await testCreateRepo(sourceFileName);
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

    const o3 = (await notes.get("")) as POJO;
    expect(o3.extra).toBeUndefined();
    expect(o3.somePrimeNumbers).toEqual([2, 3, 13, 17, 29]);
    expect(o3.hello).toEqual("you!");
    expect(o3.oh).toEqual(["hai", "cat"]);

    const addedNotes = await notes.getCommitNotes(commit as string);
    expect(addedNotes).toEqual(`first note\n\nlow note\n\nsecond note`);
});

test("push()", async () => {
    const remoteRepo = await testCreateRepo(sourceFileName, "-remote");
    const repo = await testCreateRepo(sourceFileName);
    const notes = new GitNotes(repo.workDir);

    interface O {
        hello: string;
        bye?: string;
    }
    const o: O = { hello: "world" };
    await notes.set("", o);
    await notes.push(remoteRepo.workDir);

    const otherRepo = await testCreateRepo(sourceFileName, "-other");
    const otherNotes = new GitNotes(otherRepo.workDir);
    await otherNotes.update(remoteRepo.workDir);

    const otherO = await otherNotes.get<O>("");
    expect(otherO).toEqual(o);
    otherO!.hello = "world!!!";
    await otherNotes.set("", otherO, true);
    await otherNotes.push(remoteRepo.workDir);

    o.bye = "wonderful world";
    await notes.set("", o, true);
    await notes.push(remoteRepo.workDir);

    const mergedO = await notes.get<O>("");
    expect(mergedO!.hello).toEqual("world!!!");
    expect(mergedO!.bye).toEqual("wonderful world");
    expect(mergedO).not.toEqual(o);
    await otherNotes.update(remoteRepo.workDir);
    expect(await otherNotes.get("")).toEqual(mergedO);
});
