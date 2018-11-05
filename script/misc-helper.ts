import commander = require("commander");
import { CIHelper } from "../lib/ci-helper";
import { isDirectory } from "../lib/fs-util";
import { git, gitConfig } from "../lib/git";
import { GitHubGlue } from "../lib/github-glue";
import { toPrettyJSON } from "../lib/json-util";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";

commander.version("1.0.0")
    .usage("[options] ( update-open-prs | lookup-upstream-commit | "
        + "annotate-commit <pr-number> <original> <git.git> )")
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
    } else if (command === "lookup-upstream-commit") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: needs one argument\n`);
            process.exit(1);
        }
        const commit = commander.args[1];

        const upstreamCommit = await ci.identifyUpstreamCommit(commit);
        console.log(`Upstream commit for ${commit}: ${upstreamCommit}`);
    } else if (command === "set-previous-iteration") {
        if (commander.args.length !== 9) {
            process.stderr.write(`${command}: needs PR URL, iteration, ${
                ""}cover-letter Message ID, latest tag, ${
                ""}base commit, base label, head commit, head label\n`);
            process.exit(1);
        }
        const pullRequestURL = commander.args[1];
        const iteration = parseInt(commander.args[2], 10);
        const coverLetterMessageId = commander.args[3];
        const latestTag = commander.args[4];
        const baseCommit = commander.args[5];
        const baseLabel = commander.args[6];
        const headCommit = commander.args[7];
        const headLabel = commander.args[8];

        const data = await ci.getPRMetadata(pullRequestURL);
        if (data !== undefined) {
            process.stderr.write(`Found existing data for ${pullRequestURL}: ${
                toPrettyJSON(data)}`);
            process.exit(1);
        }
        const newData = {
            baseCommit,
            baseLabel,
            coverLetterMessageId,
            headCommit,
            headLabel,
            iteration,
            latestTag,
            pullRequestURL,
        } as IPatchSeriesMetadata;
        console.log(`data: ${toPrettyJSON(newData)}`);
        await ci.notes.set(pullRequestURL, newData);
    } else if (command === "update-commit-mapping") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: needs Message-ID\n`);
            process.exit(1);
        }

        const messageID = commander.args[1];

        const result = await ci.updateCommitMapping(messageID);
        console.log(`Result: ${result}`);
    } else if (command === "annotate-commit") {
        if (commander.args.length !== 3) {
            process.stderr.write(`${command}: needs 2 parameters: ${
                ""}original and git.git commit\n`);
            process.exit(1);
        }

        const originalCommit = commander.args[1];
        const gitGitCommit = commander.args[2];

        const glue = new GitHubGlue(ci.workDir);
        const id = await glue.annotateCommit(originalCommit, gitGitCommit);
        console.log(`Created check with id ${id}`);
    } else if (command === "identify-merge-commit") {
        if (commander.args.length !== 3) {
            process.stderr.write(`${command}: needs 2 parameters: ${
                ""}upstream branch and tip commit\n`);
            process.exit(1);
        }
        const upstreamBranch = commander.args[1];
        const commit = commander.args[2];

        const result = await ci.identifyMergeCommit(upstreamBranch, commit);
        console.log(result);
    } else {
        process.stderr.write(`${command}: unhandled sub-command\n`);
        process.exit(1);
    }
})().catch((reason) => {
    process.stderr.write(`Caught error ${reason}:\n${reason.stack}\n`);
    process.exit(1);
});
