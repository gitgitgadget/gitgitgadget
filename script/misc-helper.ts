import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Command } from "commander";
import { CIHelper } from "../lib/ci-helper";
import { isDirectory } from "../lib/fs-util";
import { git, gitConfig } from "../lib/git";
import { IGitGitGadgetOptions, getVar } from "../lib/gitgitgadget";
import { getConfig } from "../lib/gitgitgadget-config";
import { GitHubGlue } from "../lib/github-glue";
import { toPrettyJSON } from "../lib/json-util";
import { IGitMailingListMirrorState, stateKey } from "../lib/mail-archive-helper";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata";
import { IConfig, loadConfig, setConfig } from "../lib/project-config";
import path from "path";

const commander = new Command();
const publishRemoteKey = "publishRemote";

commander.version("1.0.0")
    .usage("[options] ( update-open-prs | lookup-upstream-commit | "
        + "annotate-commit <pr-number> <original> <git.git> )")
    .description("Command-line helper for GitGitGadget")
    .option("-g, --git-work-dir [directory]",
            "Use a different git.git working directory than specified via "
            + "`gitgitgadget.workDir`",
            undefined)
    .option("-G, --gitgitgadget-work-dir [directory]",
            "Use a different gitgitgadget working directory than the "
            + "current working directory to access the Git config e.g. for "
            + "`gitgitgadget.workDir`",
            ".")
    .option("-c, --config <string>",
            "Use this configuration when using gitgitgadget with a project other than git", "")
    .option("-s, --skip-update",
            "Do not update the local refs (useful for debugging)")
    .parse(process.argv);

interface ICommanderOptions {
    config: string | undefined;
    gitgitgadgetWorkDir: string | undefined;
    gitWorkDir: string | undefined;
    skipUpdate: boolean | undefined;
}

if (commander.args.length === 0) {
    commander.help();
}

const commandOptions = commander.opts<ICommanderOptions>();

(async (): Promise<void> => {
    const config: IConfig = commandOptions.config ? setConfig(await getExternalConfig(commandOptions.config))
        : getConfig();

    const getGitGitWorkDir = async (): Promise<string> => {
        if (!commandOptions.gitWorkDir) {
            commandOptions.gitWorkDir = await getVar("workDir", commandOptions.gitgitgadgetWorkDir);

            if (!commandOptions.gitWorkDir) {
                throw new Error("Could not determine gitgitgadget.workDir");
            }
        }
        if (!await isDirectory(commandOptions.gitWorkDir)) {
            console.log(`Cloning git into ${commandOptions.gitWorkDir}`);
            await git([
                "clone",
                `https://github.com/${config.repo.owner}/${config.repo.name}`,
                commandOptions.gitWorkDir,
            ]);
        }
        return commandOptions.gitWorkDir;
    };

    const ci = new CIHelper(await getGitGitWorkDir(), commandOptions.skipUpdate,
        commandOptions.gitgitgadgetWorkDir);

    const command = commander.args[0];
    if (command === "update-open-prs") {
        if (commander.args.length !== 1) {
            process.stderr.write(`${command}: does not accept arguments\n`);
            process.exit(1);
        }

        const result = await ci.updateOpenPrs();
        console.log(`Updated notes: ${result}`);
    } else if (command === "update-commit-mappings") {
        if (commander.args.length !== 1) {
            process.stderr.write(`${command}: does not accept arguments\n`);
            process.exit(1);
        }

        const result = await ci.updateCommitMappings();
        console.log(`Updated notes: ${result}`);
    } else if (command === "handle-open-prs") {
        if (commander.args.length !== 1) {
            process.stderr.write(`${command}: does not accept arguments\n`);
            process.exit(1);
        }

        const options = await ci.getGitGitGadgetOptions();
        if (!options.openPRs) {
            throw new Error("No open PRs?");
        }
        const result = await ci.handleOpenPRs();
        console.log(`Updated notes: ${result}`);
    } else if (command === "lookup-upstream-commit") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: needs one argument\n`);
            process.exit(1);
        }
        const commit = commander.args[1];

        const upstreamCommit = await ci.identifyUpstreamCommit(commit);
        console.log(`Upstream commit for ${commit}: ${upstreamCommit}`);
    } else if (command === "set-upstream-commit") {
        if (commander.args.length !== 3) {
            process.stderr.write(`${command}: needs 2 parameters:${
                "\n"}original and upstream commit`);
            process.exit(1);
        }
        const originalCommit = commander.args[1];
        const gitGitCommit = commander.args[2];

        await ci.setUpstreamCommit(originalCommit, gitGitCommit);
    } else if (command === "set-tip-commit-in-git.git") {
        if (commander.args.length !== 3) {
            process.stderr.write(`${command}: needs 2 parameters:${
                "\n"}PR URL and tip commit in ${config.repo.baseOwner}.${config.repo.name}`);
            process.exit(1);
        }
        const pullRequestURL = commander.args[1];
        const gitGitCommit = commander.args[2];

        const data = await ci.getPRMetadata(pullRequestURL);
        if (!data) {
            throw new Error(`No metadata for ${pullRequestURL}`);
        }
        data.tipCommitInGitGit = gitGitCommit;
        await ci.notes.set(pullRequestURL, data, true);
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
            process.stderr.write(`${command}: needs 2 parameters: original and ${
                config.repo.baseOwner}.${config.repo.name} commit\n`);
            process.exit(1);
        }

        const originalCommit = commander.args[1];
        const gitGitCommit = commander.args[2];

        const glue = new GitHubGlue(ci.workDir, config.repo.owner, config.repo.name);
        const id = await glue.annotateCommit(originalCommit, gitGitCommit, config.repo.owner, config.repo.baseOwner);
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
    } else if (command === "get-gitgitgadget-options") {
        if (commander.args.length !== 1) {
            process.stderr.write(`${command}: no argument accepted\n`);
            process.exit(1);
        }

        console.log(toPrettyJSON(await ci.getGitGitGadgetOptions()));
    } else if (command === "init-gitgitgadget-options") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: needs 1 parameter: initial user\n`);
            process.exit(1);
        }

        try {
            await ci.getGitGitGadgetOptions();
            process.stderr.write(`${command}: ${config.repo.owner}/${config.repo.name} already initialized\n`);
            process.exit(1);
        } catch (error) {
            const options: IGitGitGadgetOptions = { allowedUsers: [ commander.args[1] ] };
            await ci.notes.set("", options, true);

            const publishTagsAndNotesToRemote = await getVar(publishRemoteKey, commandOptions.gitgitgadgetWorkDir);

            if (!publishTagsAndNotesToRemote) {
                throw new Error("No remote to which to push configured");
            }
            await git(["push", publishTagsAndNotesToRemote, "--", `${ci.notes.notesRef}`],
                    { workDir: commandOptions.gitWorkDir });
        }

        console.log(toPrettyJSON(await ci.getGitGitGadgetOptions()));
    } else if (command === "init-email-commit-tip") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: needs 1 parameter: email commit\n`);
            process.exit(1);
        }

        try {
            await ci.getGitGitGadgetOptions(); // get the notes updated
        } catch (_error) {
            console.log(`Options not set.  Please run \`misc-helper init-gitgitgadget-options\` ${
                ""}to set the allowedUsers.`);
        }

        const state: IGitMailingListMirrorState = await ci.notes.get<IGitMailingListMirrorState>(stateKey) || {};
        state.latestRevision = commander.args[1];
        await ci.notes.set(stateKey, state, true);
        const publishTagsAndNotesToRemote = await getVar(publishRemoteKey, commandOptions.gitgitgadgetWorkDir);
        if (!publishTagsAndNotesToRemote) {
            throw new Error("No remote to which to push configured");
        }
        await git(["push", publishTagsAndNotesToRemote, "--", `${ci.notes.notesRef}`],
                { workDir: commandOptions.gitWorkDir });

        console.log(toPrettyJSON(state));
    } else if (command === "get-mail-meta") {
        if (commander.args.length !== 2) {
            process.stderr.write(`${command}: need a Message-ID\n`);
            process.exit(1);
        }
        const messageID = commander.args[1];

        console.log(toPrettyJSON(await ci.getMailMetadata(messageID)));
    } else if (command === "get-pr-meta") {
        if (commander.args.length !== 2 && commander.args.length !== 3) {
            process.stderr.write(`${command}: need a repository owner and a Pull Request number\n`);
            process.exit(1);
        }
        const repositoryOwner = commander.args.length === 3 ? commander.args[1] : config.repo.owner;
        const prNumber = commander.args[commander.args.length === 3 ? 2 : 1];

        const pullRequestURL = prNumber.match(/^http/) ? prNumber :
            `https://github.com/${repositoryOwner}/${config.repo.name}/pull/${prNumber}`;
        console.log(toPrettyJSON(await ci.getPRMetadata(pullRequestURL)));
    } else if (command === "get-pr-commits") {
        if (commander.args.length !== 2 && commander.args.length !== 3) {
            process.stderr.write(`${command}: need a repository owner and a Pull Request number\n`);
            process.exit(1);
        }
        const repositoryOwner = commander.args.length === 3 ? commander.args[1] : config.repo.owner;
        const prNumber = commander.args[commander.args.length === 3 ? 2 : 1];

        const pullRequestURL = `https://github.com/${repositoryOwner}/${config.repo.name}/pull/${prNumber}`;
        const prMeta = await ci.getPRMetadata(pullRequestURL);
        if (!prMeta) {
            throw new Error(`No metadata found for ${pullRequestURL}`);
        }
        console.log(toPrettyJSON(await ci.getOriginalCommitsForPR(prMeta)));
    } else if (command === "handle-pr") {
        if (commander.args.length !== 2 && commander.args.length !== 3) {
            process.stderr.write(`${command}: need a repository owner and a Pull Request number\n`);
            process.exit(1);
        }
        const repositoryOwner = commander.args.length === 3 ? commander.args[1] : config.repo.owner;
        const prNumber = commander.args[commander.args.length === 3 ? 2 : 1];

        const pullRequestURL = `https://github.com/${repositoryOwner}/${config.repo.name}/pull/${prNumber}`;

        const meta = await ci.getPRMetadata(pullRequestURL);
        if (!meta) {
            throw new Error(`No metadata for ${pullRequestURL}`);
        }

        const options = await ci.getGitGitGadgetOptions();
        let optionsUpdated = false;
        if (!options.openPRs) {
            options.openPRs = {};
            optionsUpdated = true;
        }
        if (options.openPRs[pullRequestURL] === undefined) {
            if (meta.coverLetterMessageId) {
                options.openPRs[pullRequestURL] = meta.coverLetterMessageId;
                optionsUpdated = true;
            }
        }

        if (!options.activeMessageIDs) {
            options.activeMessageIDs = {};
            optionsUpdated = true;
        }

        let notesUpdated = false;
        if (meta.baseCommit && meta.headCommit) {
            for (const rev of await ci.getOriginalCommitsForPR(meta)) {
                const messageID = await ci.notes.getLastCommitNote(rev);
                if (messageID &&
                    options.activeMessageIDs[messageID] === undefined) {
                    options.activeMessageIDs[messageID] = rev;
                    optionsUpdated = true;
                    if (await ci.updateCommitMapping(messageID)) {
                        notesUpdated = true;
                    }
                }
            }
        }

        const [notesUpdated2, optionsUpdated2] =
            await ci.handlePR(pullRequestURL, options);
        if (notesUpdated2) {
            notesUpdated = true;
        }
        if (optionsUpdated || optionsUpdated2) {
            await ci.notes.set("", options, true);
            notesUpdated = true;
        }
        console.log(`Notes were ${notesUpdated ? "" : "not "}updated`);
    } else if (command === "add-pr-comment") {
        if (commander.args.length !== 3) {
            process.stderr.write(`${command}: need a PR URL and a comment\n`);
            process.exit(1);
        }
        const pullRequestURL = commander.args[1].match(/^[0-9]+$/) ?
            `https://github.com/gitgitgadget/${config.repo.name}/pull/${commander.args[1]}` :
            commander.args[1];
        const comment = commander.args[2];

        const glue = new GitHubGlue(ci.workDir, config.repo.owner, config.repo.name);
        await glue.addPRComment(pullRequestURL, comment);
    } else if (command === "set-app-token") {
        const set = async (options: {
             appID: number;
             installationID?: number;
             name: string;
        }): Promise<void> => {
            const appName = options.name === config.app.name ? config.app.name : config.app.altname;
            const appNameKey = `${appName}.privateKey`;
            const appNameVar = appNameKey.toUpperCase().replace(/\./, "_");
            const key = process.env[appNameVar] ? process.env[appNameVar] : await gitConfig(appNameKey);

            if (!key) {
                throw new Error(`Need the ${appName} App's private key`);
            }

            const client = new Octokit({
                authStrategy: createAppAuth,
                auth: {
                    appId: options.appID,
                    privateKey: key.replace(/\\n/g, `\n`)
                }
            });

            if (options.installationID === undefined) {
                options.installationID =
                    (await client.rest.apps.getRepoInstallation({
                        owner: options.name,
                        repo: config.repo.name,
                })).data.id;
            }
            const result = await client.rest.apps.createInstallationAccessToken(
                {
                    installation_id: options.installationID,
                });
            const configKey = options.name === config.app.name ?
                `${config.app.name}.githubToken` : `gitgitgadget.${options.name}.githubToken`;
            await git(["config", configKey, result.data.token]);
        };

        await set(config.app);
        for (const org of commander.args.slice(1)) {
            await set({ appID: 46807, name: org});
        }
    } else if (command === "handle-pr-comment") {
        if (commander.args.length !== 2 && commander.args.length !== 3) {
            process.stderr.write(`${command}: optionally takes a repository owner and one comment ID\n`);
            process.exit(1);
        }
        const repositoryOwner = commander.args.length === 3 ? commander.args[1] : config.repo.owner;
        const commentID = parseInt(commander.args[commander.args.length === 3 ? 2 : 1], 10);

        await ci.handleComment(repositoryOwner, commentID);
    } else if (command === "handle-pr-push") {
        if (commander.args.length !== 2 && commander.args.length !== 3) {
            process.stderr.write(`${command}: optionally takes a repository owner and a Pull Request number\n`);
            process.exit(1);
        }
        const repositoryOwner = commander.args.length === 3 ? commander.args[1] : config.repo.owner;
        const prNumber = parseInt(commander.args[commander.args.length === 3 ? 2 : 1], 10);

        await ci.handlePush(repositoryOwner, prNumber);
    } else if (command === "handle-new-mails") {
        const mailArchiveGitDir = await getVar("loreGitDir", commandOptions.gitgitgadgetWorkDir);

        if (!mailArchiveGitDir) {
            process.stderr.write(`Need a ${config.mailrepo.descriptiveName} worktree`);
            process.exit(1);
        }
        const onlyPRs = new Set<number>();
        for (const arg of commander.args.slice(1)) {
            onlyPRs.add(parseInt(arg, 10));
        }
        await ci.handleNewMails(mailArchiveGitDir, onlyPRs.size ? onlyPRs : undefined);
    } else {
        process.stderr.write(`${command}: unhandled sub-command\n`);
        process.exit(1);
    }
})().catch((reason: Error) => {
    console.log(`Caught error ${reason}:\n${reason.stack}\n`);
    process.stderr.write(`Caught error ${reason}:\n${reason.stack}\n`);
    process.exit(1);
});

async function getExternalConfig(file: string): Promise<IConfig> {
    const newConfig = await loadConfig(path.resolve(file));

    if (!newConfig.hasOwnProperty("project")) {
        throw new Error(`User configurations must have a 'project:'.  Not found in ${path}`);
    }

    if (!newConfig.repo.owner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'owner' ${newConfig.repo.owner} in ${path}`);
    }

    if (!newConfig.repo.baseOwner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'baseOwner' ${newConfig.repo.baseOwner} in ${path}`);
    }

    return newConfig;
}
