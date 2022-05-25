import { expect, jest, test } from "@jest/globals";
import { ILintError, ILintOptions, LintCommit } from "../lib/commit-lint";
import { IPRCommit } from "../lib/github-glue";

jest.setTimeout(180000);

/**
 * Check one commit's linter result
 *
 * If the `check` parameter is set, it expects the linter to produce a
 * `lintError`. If the `check` parameter is unspecified, it expects the linter
 * _not_ to produce an error.
 *
 * @param commit the commit to lint
 * @param check a function to verify the lint result
 * @param options extra linter options, if any
 */
function lintCheck(
    commit: IPRCommit,
    check?: (error: ILintError) => void,
    options?: ILintOptions
) {
    const linter = new LintCommit(commit, options);
    const lintError = linter.lint();
    if (!check) {
        expect(lintError).toBeUndefined();
    } else {
        expect(lintError).not.toBeUndefined();
        if (lintError) {
            check(lintError);
        }
    }
}

test("basic lint tests", () => {
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

    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/too short/);
    });

    commit.message = "Missing blank line is bad\nhere\nSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/empty line/);
    });

    commit.message = "";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/too short/);
    });

    commit.message = `1234578901234567890123456789012345678901234567890${
                ""}123456789012345678901234567890\nmore bad\nSigned-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/too long/);
        expect(lintError.message).toMatch(/empty line/);
    });

    commit.message = "squash! This needs rebase\n\nSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/Rebase/);
    });

    commit.message = "fixup! This needs rebase\n\nSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/Rebase/);
    });

    commit.message = "amend! This needs rebase\n\nSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/Rebase/);
    });

    commit.message = "amend This is okay\n\nSigned-off-by: x";
    lintCheck(commit);

    commit.message = "tests: This should be lower case\n\nSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/lower/);
    });

    commit.message = `tests: A title that should also be lower case\n
Signed-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/lower/);
    });

    commit.message = "tests: THIS can be all-caps\n\nSigned-off-by: x";
    lintCheck(commit);

    commit.message = "doc: success as Lower Case\n\nSigned-off-by: x";
    lintCheck(commit);

    commit.message = `doc: a single-letter Lower Case message also succeeds\n
Signed-off-by: x`;
    lintCheck(commit);

    commit.message = "Fail not signed off\n\nNotSigned-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/not signed/);
    });

    commit.message = "Success signed off\n\n foo bar\nSigned-off-by: x";
    lintCheck(commit);

    commit.message = `Success signed off\n\n foo bar
Signed-off-by: x
Reviewed-by: y`;
    lintCheck(commit);

    commit.message = "Fail blanks in sign off\n\n Signed-off-by: x";
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/whitespace/);
    });

    commit.message = `Fail just a link\n
http://www.github.com\n\nSigned-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/explanation/);
    });

    commit.message = `Success more than a link\n
http://www.github.com\nblah\n\nSigned-off-by: x`;
    lintCheck(commit);

    commit.message = `Success more than a link\n
http://www.github.com blah\n\nSigned-off-by: x`;
    lintCheck(commit);

    commit.message = `Success more than a link\n
blah http://www.github.com\n\nSigned-off-by: x`;
    lintCheck(commit);

    commit.message = `wrapped but too long\n\n${
                ""}1234578901234567890123456789012345678901234567890${
                ""} 23456789012345678901234567890\nmore bad\nSigned-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/should be wrapped/);
    });

    commit.message = `contains a long URL that cannot be wrapped\n\n ${
                ""}[2] https://lore.kernel.org/git/CABPp-BH9tju7WVm=${
                ""}QZDOvaMDdZbpNXrVWQdN-jmfN8wC6YVhmw@mail.gmail.com/\n\n${
                ""}Signed-off-by: x}`;
    lintCheck(commit);

    commit.message = `contains a long, whitespace-prefixed error message\n\n${
                ""}    ld-elf.so.1: /usr/local/lib/perl5/5.32/mach/CORE/libperl.so.5.32:${
                ""} Undefined symbol "strerror_l@FBSD_1.6"\n\n${
                ""}Signed-off-by: x}`;
    lintCheck(commit);
});

test("combo lint tests", () => {
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

    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/too short/);
        expect(lintError.message).toMatch(/not signed/);
    });

    commit.message = `x: A 34578901234567890123456789012345678901234567890${
                ""}123456789012345678901234567890`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/too short/);
        expect(lintError.message).toMatch(/not signed/);
        expect(lintError.message).toMatch(/is too long/);
        expect(lintError.message).toMatch(/lower/);
    });

    commit.message = `1234578901234567890123456789012345678901234567890${
                ""}123456789012345678901234567890\nmore bad\nSigned-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/is too long/);
        expect(lintError.message).toMatch(/empty line/);
    });

    commit.message = `all good but too long\n${
                ""}1234578901234567890123456789012345678901234567890${
                ""} 23456789012345678901234567890\nmore bad\nSigned-off-by: x`;
    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/should be wrapped/);
        expect(lintError.message).toMatch(/empty line/);
    });
});

test("lint options tests", () => {
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
        message: `all good but too long 1234567890${
                ""} 234578901234567890123456789012345678901234567890\n\n${
                ""}1234578901234567890123456789012345678901234567890${
                ""} 23456789012345678901234567890\nmore bad\nSigned-off-by: x`,
        parentCount: 1,
    };

    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/is too long/);
        expect(lintError.message).toMatch(/should be wrapped/);
        expect(lintError.message).toMatch(/76/);
    }, {});

    lintCheck(commit, (lintError) => {
        expect(lintError.checkFailed).toBe(true);
        expect(lintError.message).toMatch(/is too long/);
        expect(lintError.message).toMatch(/should be wrapped/);
        expect(lintError.message).toMatch(/66/);
    }, {maxColumns: 66});
});
