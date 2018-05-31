import "jest";
import { gitConfig } from "../lib/git";

test("finds core.bare", async () => {
    expect(await gitConfig("core.bare")).toMatch(/true|false/);
});
