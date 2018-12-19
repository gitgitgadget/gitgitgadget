import "jest";
import { CIHelper } from "../lib/ci-helper";
import { git } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { IMailMetadata } from "../lib/mail-metadata";
import { testCreateRepo } from "./test-lib";

jest.setTimeout(60000);

test("identify merge that integrated some commit", async () => {
    const repo = await testCreateRepo(__filename);

    /*
     * Create a branch structure like this:
     *
     * a - b ----- c - d
     *   \       /   /
     *   | e ----- f
     *   \       /
     *     g - h
     */
    const a = await repo.commit("a");
    const g = await repo.commit("g");
    const h = await repo.commit("h");
    await repo.git(["reset", "--hard", a]);
    const e = await repo.commit("e");
    const f = await repo.merge("f", h);
    await repo.git(["reset", "--hard", a]);
    const b = await repo.commit("b");
    const c = await repo.merge("c", e);
    const d = await repo.merge("d", f);
    await repo.git(["update-ref", "refs/remotes/upstream/pu", d]);

    const ci = new CIHelper(repo.workDir);
    expect(await ci.identifyMergeCommit("pu", g)).toEqual(d);
    expect(await ci.identifyMergeCommit("pu", e)).toEqual(c);
    expect(await ci.identifyMergeCommit("pu", h)).toEqual(d);
});

test("identify upstream commit", async () => {
    // initialize test worktree and gitgitgadget remote
    const worktree = await testCreateRepo(__filename, "-worktree");
    const gggRemote = await testCreateRepo(__filename, "-gitgitgadget");

    // re-route the URLs
    await worktree.git(["config", `url.${gggRemote.workDir}.insteadOf`,
        "https://github.com/gitgitgadget/git"]);

    // Set up fake upstream branches
    const A = await gggRemote.commit("A");
    await gggRemote.git(["branch", "maint"]);
    await gggRemote.git(["branch", "next"]);
    await gggRemote.git(["branch", "pu"]);

    // Now come up with a local change
    await worktree.git(["pull", gggRemote.workDir, "master"]);
    const b = await worktree.commit("b");

    // "Contribute" it via a PullRequest
    const pullRequestURL = "https://example.com/pull/123";
    const messageID = "fake-1st-mail@example.com";
    const notes = new GitNotes(worktree.workDir);
    await notes.appendCommitNote(b, messageID);
    const bMeta = {
        messageID,
        originalCommit: b,
        pullRequestURL,
    } as IMailMetadata;
    await notes.set(messageID, bMeta);

    // "Apply" the patch, and merge it
    await gggRemote.newBranch("gg/via-pull-request");
    const B = await gggRemote.commit("B");
    await gggRemote.git(["checkout", "pu"]);
    await gggRemote.git(["merge", "--no-ff", "gg/via-pull-request"]);

    // Update the `mail-to-commit` notes ref, at least the part we care about
    const mail2CommitNotes = new GitNotes(gggRemote.workDir,
        "refs/notes/mail-to-commit");
    await mail2CommitNotes.setString(messageID, B);

    // "publish" the gitgitgadget notes
    await worktree.git(["push", gggRemote.workDir, notes.notesRef]);

    class TestCIHelper extends CIHelper {
        public constructor() {
            super(worktree.workDir);
            this.testing = true;
        }
    }
    const ci = new TestCIHelper();
    expect(await ci.identifyUpstreamCommit(b)).toEqual(B);

    expect(await ci.updateCommitMapping(messageID)).toBeTruthy();
    const bMetaNew = await notes.get<IMailMetadata>(messageID);
    expect(bMetaNew.originalCommit).toEqual(b);
    expect(bMetaNew.commitInGitGit).toEqual(B);
});
