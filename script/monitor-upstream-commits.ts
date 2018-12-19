import commander = require("commander");
import { CIHelper } from "../lib/ci-helper";
import { GitGitGadget } from "../lib/gitgitgadget";

/*
 * This script is used to update GitGitGadget's open PRs in response to updates
 * to `refs/notes/mail-to-commit` in https://github.com/gitgitgadget/git (which
 * is a notes ref describing which commits in git.git correspond to which mails
 * on the mailing list).
 */

commander.version("1.0.0")
    .usage("[options]")
    .description("GitGitGadget's refs/notes/mail-to-commit monitor")
    .option("-w, --work-dir [directory]",
        "Use a different working directory than '.'", ".")
    .parse(process.argv);

if (commander.args.length === 0) {
    commander.help();
}

(async () => {
    if (commander.workDir === undefined) {
        commander.workDir = await GitGitGadget.getWorkDir(".");
    }
    const command = commander.args[0];
    const helper = new CIHelper(commander.workDir);
    if (command === "TODO") {
        console.log(`helper: ${helper}`);
    } else {
        process.stderr.write(`${command}: unhandled sub-command\n`);
        process.exit(1);
    }
})().catch((reason) => {
    process.stderr.write(`ERROR!: ${reason}\n`);
    process.exit(1);
});
