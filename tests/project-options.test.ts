import "jest";
import { isDirectory } from "../lib/fs-util";
import { git } from "../lib/git";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { ProjectOptions } from "../lib/project-options";
import {
    ITestCommitOptions, testCreateRepo,
} from "./test-lib";

// This test script might take quite a while to run
jest.setTimeout(20000);

test("project options", async () => {
    const repo = await testCreateRepo(__filename);
    expect(await isDirectory(`${repo.workDir}/.git`)).toBeTruthy();

    const initialCommit = "e073a465d0c7bf27664959bc93a9f018ac6f6f00";
    expect(await repo.commit("initial")).toEqual(initialCommit);
    expect(await repo.git(["rev-parse", "--symbolic-full-name", "HEAD"]))
        .toEqual("refs/heads/master");
    expect(await repo.newBranch("test-project-options")).toEqual("");
    expect(await repo.commit("A")).not.toEqual("");
    expect(await repo.commit("B")).not.toEqual("");
    expect(await repo.commit("C")).not.toEqual("");

    const options1 = await ProjectOptions.getLocal(repo.workDir);
    expect(options1.basedOn).toBeUndefined();
    expect(options1.to).toEqual("--to=reviewer@example.com");
    expect(options1.publishToRemote).toBeUndefined();
    const options2 = await ProjectOptions.get(repo.workDir,
        "test-project-options", [], undefined, undefined);
    expect(options2.workDir).not.toBeUndefined();
    expect(options2.midUrlPrefix).toEqual("https://dummy.com/?mid=");
});
