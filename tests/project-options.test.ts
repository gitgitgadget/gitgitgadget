import "jest";
import { git } from "../lib/git";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { ProjectOptions } from "../lib/project-options";
import {
    isDirectory, ITestCommitOptions, testCommit, testCreateRepo,
} from "./test-lib";

// This test script might take quite a while to run
jest.setTimeout(20000);

test("project options", async () => {
    const workDir = await testCreateRepo(__filename);
    expect(await isDirectory(`${workDir}/.git`)).toBeTruthy();

    const gitOpts: ITestCommitOptions = { workDir };
    const initialCommit = "0c16a2d9ca7a82f08f3d1219f5f11642ffd329e2";
    expect(await testCommit(gitOpts, "initial")).toEqual(initialCommit);
    expect(await git(["rev-parse", "--symbolic-full-name", "HEAD"],
        { workDir })).toEqual("refs/heads/master");
    expect(await git(["checkout", "-b", "test-project-options"], { workDir }))
        .toEqual("");
    expect(await testCommit(gitOpts, "A")).not.toEqual("");
    expect(await testCommit(gitOpts, "B")).not.toEqual("");
    expect(await testCommit(gitOpts, "C")).not.toEqual("");

    const options1 = await ProjectOptions.getLocal(workDir);
    expect(options1.basedOn).toBeUndefined();
    expect(options1.to).toEqual("--to=reviewer@example.com");
    expect(options1.publishToRemote).toBeUndefined();
    const options2 = await ProjectOptions.get(workDir, "test-project-options",
        [], undefined, undefined);
    expect(options2.workDir).not.toBeUndefined();
    expect(options2.midUrlPrefix).toEqual("https://dummy.com/?mid=");
});
