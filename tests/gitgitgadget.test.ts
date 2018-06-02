import "jest";
import { git, revParse } from "../lib/git";
import { GitNotes } from "../lib/git-notes";
import { PatchSeries } from "../lib/patch-series";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { ProjectOptions } from "../lib/project-options";
import {
    isDirectory, ITestCommitOptions, testCommit, testCreateRepo,
} from "./test-lib";

test("generate tag/notes from a Pull Request", async () => {
    const debug = true;
    const logger = !debug ? console : {
        log: (message: string): void => {
            /* do nothing */
        },
    };
    const workDir = await testCreateRepo(__filename);
    const gitOpts: ITestCommitOptions = { workDir };

    await git(["config", "user.name", "GitGitGadget"], gitOpts);
    await git(["config", "user.email", "gitgitgadget@example.com"], gitOpts);

    expect(await testCommit(gitOpts, "initial")).not.toEqual("");
    expect(await git(["checkout", "-b", "test-run"], { workDir }))
        .toEqual("");
    const baseCommit = await revParse("HEAD", workDir);
    expect(await testCommit(gitOpts, "A")).not.toEqual("");
    const gitOpts2: ITestCommitOptions = {
        author: "Contributor <contributor@example.com>",
        workDir,
    };
    expect(await testCommit(gitOpts2, "B")).not.toEqual("");
    const gitOpts3: ITestCommitOptions = {
        author: "Developer <developer@example.com>",
        committer: "Committer <committer@example.com>",
        workDir,
    };
    expect(await testCommit(gitOpts3, "C")).not.toEqual("");
    const headCommit = await revParse("HEAD", workDir);

    const notes = new GitNotes(workDir);
    const pullRequestURL = "https://github.com/gitgitgadget/git/pull/1";
    const description = `My first Pull Request!

This Pull Request contains some really important changes that I would love to
have included in git.git.

Cc: Some Body <somebody@example.com>
`;
    const match2 = description.match(/^([^]+)\n\n([^]+)$/);
    expect(match2).toBeTruthy();

    const patches = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description, "next", baseCommit, "somebody:master", headCommit);

    expect(patches.coverLetter).toEqual(`My first Pull Request!

This Pull Request contains some really important changes that I would love to
have included in git.git.`);

    const mails = [];
    const midRegex = new RegExp("<(cover|[0-9a-f]{40})"
        + ".\\d+\\.git\\.gitgitgadget@example\\.com>", "g");
    async function send(mail: string): Promise<string> {
        if (mails.length === 0) {
            mail = mail.replace(/(\nDate: ).*/, "$1<Cover-Letter-Date>");
        }
        mails.push(mail.replace(midRegex, "<$1.<Message-ID>>"));

        return "Message-ID";
    }
    expect(await patches.generateAndSend(logger, send)).toEqual("Message-ID");
    expect(mails).toEqual(expectedMails);

    expect(await testCommit(gitOpts, "D")).not.toEqual("");

    const headCommit2 = await revParse("HEAD", workDir);
    const patches2 = await PatchSeries.getFromNotes(notes, pullRequestURL,
        description,
        "gitgitgadget:next", baseCommit,
        "somebody:master", headCommit2);
    mails.splice(0);
    expect(await patches2.generateAndSend(logger, send)).toBeUndefined();
    expect(mails.length).toEqual(5);
    expect(await revParse("pr-1/somebody/master-v1", workDir)).toBeDefined();
});
