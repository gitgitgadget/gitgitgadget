import { expect, test } from "@jest/globals";
import { gitConfig } from "../lib/git";

test("finds core.bare", async () => {
    expect(await gitConfig("core.bare")).toMatch(/true|false/);
});
