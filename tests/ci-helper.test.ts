import "jest";
import { CIHelper } from "../lib/ci-helper";
import { testCreateRepo } from "./test-lib";

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
