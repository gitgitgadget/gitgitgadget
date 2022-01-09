import { IPRCommit } from "./github-glue";

export interface ILintError {
    checkFailed: boolean;           // true if check failed
    message: string;
}

export interface ILintOptions {
    maxColumns?: number | undefined; // max line length
}

/*
 * Simple single use class to drive lint tests on commit messages.
 */
export class LintCommit {
    private blocked: boolean;
    private lines: string[];
    private patch: IPRCommit;
    private messages: string[] = [];
    private maxColumns = 76;

    public constructor(patch: IPRCommit, options?: ILintOptions | undefined) {
        this.blocked = false;
        this.lines =  patch.message.split("\n");
        this.patch = patch;

        if (options !== undefined) {
            if (options.maxColumns !== undefined) {
                this.maxColumns = options.maxColumns;
            }
        }
    }

    /**
     * Linter method to run checks on the commit message.
     */
    public lint(): ILintError | void {

        const phase1 = [
            this.commitViable
        ];

        const phase2 = [            // checks to always run
            this.commitMessageLength,
            this.bangPrefix,
            this.lowerCaseAfterPrefix,
            this.signedOffBy
        ];

        const phase3 = [            // checks if phase1 was successful
            this.commitTextLength,
            this.moreThanAHyperlink
        ];

        phase1.map((linter) => { linter(); });

        const phase1Okay = false === this.blocked;

        phase2.map((linter) => { linter(); });

        if (phase1Okay) {
            phase3.map((linter) => { linter(); });
        }

        if (this.messages.length) {
            this.messages.unshift(`\`${this.lines[0]}\``);
            return { checkFailed: this.blocked,
                     message: `There ${this.messages.length > 1 ?
                     "are issues" : "is an issue"} in commit ${
                     this.patch.commit}:\n${this.messages.join("\n")}`,
                };
        }
    }

    private addMessage(message: string): void {
        this.messages.push(message);
    }

    private block(message: string): void {
        this.blocked = true;
        this.addMessage(message);
    }

    // Test for a minimum viable commit message.
    // - the body of the commit message should not be empty

    private commitViable = (): void => {
        if (this.lines.length < 3) {
            this.block("Commit checks stopped - the message is too short");
        }
    };

    // The first line should not be too long

    private commitMessageLength = (): void => {
        if (this.lines[0].length > this.maxColumns) {
            this.block(`First line of commit message is too long (> ${
                this.maxColumns} columns)`);
        }
    };

    // More tests of the commit message structure.
    // - the first line should be followed by an empty line
    // other lines should not be too long

    private commitTextLength = (): void => {
        if (this.lines.length > 2 && this.lines[1].length) {
            this.block("The first line must be separated from the rest by an "
                        + "empty line");
        }

        for (let i = 1; i < this.lines.length; i++) {
            if (this.lines[i].length > this.maxColumns &&
                // Allow long lines if they cannot be wrapped at some
                // white-space character, e.g. URLs. To allow ` [1] <URL>`
                // lines, we skip the first 10 characters.
                this.lines[i].slice(10).match(/\s/)) {
                this.block(`Lines in the body of the commit messages ${""
                    }should be wrapped between 60 and ${
                    this.maxColumns} characters.`);
                break;
            }
        }
    };

    // Verify if the first line starts with a prefix (e.g. tests:), it continues
    // in lower-case (except for ALL_CAPS as that is likely to be a code
    // identifier)

    private lowerCaseAfterPrefix = (): void =>{
        const match = this.lines[0].match(/^\S+?:\s*?([A-Z][a-z ])/);

        if (match) {
            this.block("Prefixed commit message must be in lower case");
        }
    };

    // Reject commits that appear to require rebasing

    private bangPrefix = (): void =>{
        if (this.lines[0].match(/^(squash|fixup|amend)!/)) {
            this.block("Rebase needed to squash commit");
        }
    };

    // Verify there is a Signed-off-by: line - DCO check does this
    // already, but put out a message if it is indented

    private signedOffBy = (): void =>{
        let signedFound = false;

        this.lines.map((line) => {
            const match = line.match(/^(\s*)Signed-off-by:\s+(.*)/);

            if (match) {
                signedFound = true;
                if (match[1].length) {
                    this.block(`Leading whitespace in sign off: ${line}`);
                }
            }
        });

        if (!signedFound) {
            this.block("Commit not signed off");
        }
    };

    // Verify the body of the commit message does not consist of a hyperlink,
    // without any other explanation.
    // Should all lines be checked ie is it an array of links?
    // Low hanging fruit: check the first line.
    // Hyperlink validation is NOT part of the test.

    private moreThanAHyperlink = (): void =>{
        const line = this.lines[2];
        const match = line.match(/^(\w*)\s*https*:\/\/\S+\s*(\w*)/);

        if (match) {
            if (!match[1].length && !match[2].length &&
                this.lines.length === 5) {
                this.block("A hyperlink requires some explanation");
            }
        }
    };
}
