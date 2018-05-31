import "jest";
import { emptyBlobName, git } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
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
});
