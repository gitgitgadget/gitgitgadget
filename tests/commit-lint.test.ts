import "jest";
import { LintCommit } from "../lib/commit-lint";

jest.setTimeout(180000);

test("basic lint tests", async () => {
    const commit = {
        author: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        commit: "BAD1FEEDBEEF",
        committer: {
            email: "ggg@example.com",
            login: "ggg",
            name: "e. e. cummings",
        },
        message: "Message has no description",
        parentCount: 1,
    };

    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/too short/);
        }
    }

    commit.message = "Missing blank line is bad\nhere\nSigned-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/empty line/);
        }
    }

    commit.message = "";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/too short/);
        }
    }

    commit.message = `1234578901234567890123456789012345678901234567890${
                ""}123456789012345678901234567890\nmore bad\nSigned-off-by: x`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/too long/);
            expect(lintError.message).toMatch(/empty line/);
        }
    }

    commit.message = "tests: This should be lower case\n\nSigned-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/lower/);
        }
    }

    commit.message = "doc: success as Lower Case\n\nSigned-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

    commit.message = "Fail not signed off\n\nNotSigned-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/not signed/);
        }
    }

    commit.message = "Success signed off\n\n foo bar\nSigned-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

    commit.message = `Success signed off\n\n foo bar
Signed-off-by: x
Reviewed-by: y`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

    commit.message = "Fail blanks in sign off\n\n Signed-off-by: x";
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/whitespace/);
        }
    }

    commit.message = `Fail just a link\n
http://www.github.com\n\nSigned-off-by: x`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            expect(lintError.checkFailed).toBe(true);
            expect(lintError.message).toMatch(/explanation/);
        }
    }

    commit.message = `Success more than a link\n
http://www.github.com\nblah\n\nSigned-off-by: x`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

    commit.message = `Success more than a link\n
http://www.github.com blah\n\nSigned-off-by: x`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

    commit.message = `Success more than a link\n
blah http://www.github.com\n\nSigned-off-by: x`;
    {
        const linter = new LintCommit(commit);
        const lintError = await linter.lint();
        expect(lintError).toBeUndefined();
    }

});
