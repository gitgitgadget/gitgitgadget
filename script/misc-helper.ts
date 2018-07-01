import commander = require("commander");
import { CIHelper } from "../lib/ci-helper";
import { isDirectory } from "../lib/fs-util";
import { git, gitConfig } from "../lib/git";
import { GitHubGlue } from "../lib/github-glue";
import { toPrettyJSON } from "../lib/json-util";

commander.version("1.0.0")
    .usage("[options] ( update-open-prs )")
    .description("Command-line helper for GitGitGadget")
    .option("-w, --work-dir [directory]",
        "Use a different GitGitGadget working directory than '.'", ".")
    .parse(process.argv);

if (commander.args.length === 0) {
    commander.help();
}

async function getGitGitWorkDir(): Promise<string> {
    if (!commander.gitGitWorkDir) {
        commander.gitGitWorkDir = await gitConfig("gitgitgadget.workDir");
        if (!commander.gitGitWorkDir) {
            throw new Error(`Could not determine gitgitgadget.workDir`);
        }
    }
    if (!await isDirectory(commander.gitGitWorkDir)) {
        console.log(`Cloning git into ${commander.gitGitWorkDir}`);
        await git([
            "clone",
            "https://github.com/gitgitgadget/git",
            commander.gitGitWorkDir,
        ]);
    }
    return commander.gitGitWorkDir;
}

async function getCIHelper(): Promise<CIHelper> {
    return new CIHelper(await getGitGitWorkDir());
}

(async () => {
    const ci = await getCIHelper();
    const command = commander.args[0];
    if (command === "update-open-prs") {
        if (commander.args.length !== 1) {
            process.stderr.write(`${command}: does not accept arguments\n`);
            process.exit(1);
        }

        const gitHub = new GitHubGlue(ci.workDir);

        const options = await ci.getGitGitGadgetOptions();
        let optionsChanged: boolean = false;
        if (!options.openPRs) {
            options.openPRs = {};
            optionsChanged = true;
        }
        if (!options.activeMessageIDs) {
            options.activeMessageIDs = {};
            optionsChanged = true;
        }

        const pullRequests = await gitHub.getOpenPRs();
        const handledPRs = new Set<string>();
        const handledMessageIDs = new Set<string>();
        for (const pr of pullRequests) {
            const meta = await ci.getPRMetadata(pr.pullRequestURL);
            if (!meta) {
                console.log(`No meta found for ${pr.pullRequestURL}`);
                continue;
            }

            const url: string = pr.pullRequestURL;
            handledPRs.add(url);
            if (meta.coverLetterMessageId &&
                options.openPRs[url] === undefined) {
                options.openPRs[url] = meta.coverLetterMessageId;
                optionsChanged = true;
            }

            if (meta.baseCommit && meta.headCommit) {
                for (const rev of await ci.getOriginalCommitsForPR(meta)) {
                    const messageID = await ci.notes.getLastCommitNote(rev);
                    handledMessageIDs.add(messageID);
                    if (messageID &&
                        options.activeMessageIDs[messageID] === undefined) {
                        options.activeMessageIDs[messageID] = rev;
                        optionsChanged = true;
                    }
                }
            }
        }

        for (const url in options.openPRs) {
            if (!handledPRs.has(url)) {
                delete options.openPRs[url];
                optionsChanged = true;
            }
        }

        for (const messageID in options.activeMessageIDs) {
            if (!handledMessageIDs.has(messageID)) {
                delete options.activeMessageIDs[messageID];
                optionsChanged = true;
            }
        }

        if (optionsChanged) {
            console.log(`Changed options:\n${toPrettyJSON(options)}`);
            await ci.notes.set("", options, true);
        }
    } else {
        process.stderr.write(`${command}: unhandled sub-command\n`);
        process.exit(1);
    }
})().catch((reason) => {
    process.stderr.write(`Caught error ${reason}:\n${reason.stack}\n`);
    process.exit(1);
});
