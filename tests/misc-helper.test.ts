import { expect, jest, test } from "@jest/globals";
import { fileURLToPath } from "url";
import { git } from "../lib/git.js";
import { testCreateRepo, TestRepo } from "./test-lib.js";
import { execFile } from "child_process";
import * as util from "util";
import defaultConfig from "../lib/gitgitgadget-config.js";

const execChild = util.promisify(execFile);

jest.setTimeout(180000);
const sourceFileName = fileURLToPath(import.meta.url);

const config = defaultConfig;

// Create three repos.
// worktree is a local copy for doing updates and has the config
// info that would normally be in the gitgitgadget repo.  To ensure
// testing isolation, worktree is NOT the repo used for git clone
// tests.  That work is done in gggLocal.

// gggRemote represents the master on github.

// gggLocal represents the empty repo to be used by gitgitgadget.  It
// is empty to ensure nothing needs to be present (worktree would
// have objects present).

async function setupRepos(instance: string): Promise<{ worktree: TestRepo; gggLocal: TestRepo; gggRemote: TestRepo }> {
    const worktree = await testCreateRepo(sourceFileName, `-work-cmt${instance}`);
    const gggLocal = await testCreateRepo(sourceFileName, `-git-lcl${instance}`);
    const gggRemote = await testCreateRepo(sourceFileName, `-git-rmt${instance}`);

    // re-route the URLs
    const url = `https://github.com/${config.repo.owner}/${config.repo.name}`;

    await worktree.git(["config", `url.${gggRemote.workDir}.insteadOf`, url]);
    await gggLocal.git(["config", `url.${gggRemote.workDir}.insteadOf`, url]);

    // set needed config
    await worktree.git(["config", "--add", "gitgitgadget.workDir", gggLocal.workDir]);
    // misc-helper and gitgitgadget use this and ci-helper relies on insteadOf above
    await worktree.git(["config", "--add", "gitgitgadget.publishRemote", gggRemote.workDir]);

    await worktree.git(["config", "user.name", "Test User"]);
    await gggLocal.git(["config", "user.name", "Test User"]);
    await gggRemote.git(["config", "user.name", "Test User"]);
    await worktree.git(["config", "user.email", "user@example.com"]);
    await gggLocal.git(["config", "user.email", "user@example.com"]);
    await gggRemote.git(["config", "user.email", "user@example.com"]);

    // Initial empty commit
    const commitA = await gggRemote.commit("A");
    expect(commitA).not.toBeUndefined();

    // Set up fake upstream branches
    for (const branch of config.repo.trackingBranches) {
        if (!branch.match(/master|main/)) {
            await gggRemote.git(["branch", branch]);
        }
    }

    return { worktree, gggLocal, gggRemote };
}

const notesRef = "--ref=refs/notes/gitgitgadget";
const helperEnv = {
    GIT_AUTHOR_NAME: "J Doe",
    GIT_AUTHOR_EMAIL: "jdoe@example.com",
    GIT_COMMITTER_NAME: "J Doe",
    GIT_COMMITTER_EMAIL: "jdoe@example.com",
    ...process.env,
};

async function getNote(reg: RegExp, workDir: string): Promise<string> {
    const notes = await git(["notes", notesRef], { workDir });
    const id = notes.match(reg);
    expect(id).not.toBeNull();
    return await git(["notes", notesRef, "show", (id as RegExpMatchArray)[1]], { workDir });
}

test("init options and init/update tip", async () => {
    const { worktree, gggLocal, gggRemote } = await setupRepos("mha1");

    const miscHelper = async (...args: string[]): Promise<string> => {
        const cmd = ["build/script/misc-helper.js", "-s", "-g", gggLocal.workDir, "-G", worktree.workDir, ...args];
        const { stdout } = await execChild("node", cmd, { env: helperEnv });
        return stdout;
    };

    {
        const user = "beno";
        const options = await miscHelper("init-gitgitgadget-options", user);
        expect(options).toMatch(user);

        const remoteOptions = await getNote(/ (.*)$/, gggRemote.workDir);
        expect(remoteOptions).toMatch(user);
    }

    {
        const tipCommit = "feeddeadbeef";
        const tip = await miscHelper("init-email-commit-tip", tipCommit);
        expect(tip).toMatch(tipCommit);

        const remotetip = await getNote(/ (.*)\n/, gggRemote.workDir);
        expect(remotetip).toMatch(tipCommit);
    }

    {
        const tipCommit = "feeddeadfade";
        const tip = await miscHelper("init-email-commit-tip", tipCommit);
        expect(tip).toMatch(tipCommit);

        const remotetip = await getNote(/ (.*)\n/, gggRemote.workDir);
        expect(remotetip).toMatch(tipCommit);
    }
});

test("init email commit tip and init options", async () => {
    const { worktree, gggLocal, gggRemote } = await setupRepos("mha2");

    const miscHelper = async (...args: string[]): Promise<string> => {
        const cmd = ["build/script/misc-helper.js", "-s", "-g", gggLocal.workDir, "-G", worktree.workDir, ...args];
        const { stdout } = await execChild("node", cmd, { env: helperEnv });
        return stdout;
    };

    {
        const tipCommit = "feeddeadbeef";
        const tip = await miscHelper("init-email-commit-tip", tipCommit);
        expect(tip).toMatch(tipCommit);

        const remotetip = await getNote(/ (.*)$/, gggRemote.workDir);
        expect(remotetip).toMatch(tipCommit);
    }

    {
        const user = "beno";
        const options = await miscHelper("init-gitgitgadget-options", user);
        expect(options).toMatch(user);

        const remoteOptions = await getNote(/ (.*)$/, gggRemote.workDir);
        expect(remoteOptions).toMatch(user);
    }
});
