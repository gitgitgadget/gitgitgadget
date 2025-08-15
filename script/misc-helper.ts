import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Command } from "commander";
import { CIHelper } from "../lib/ci-helper.js";
import { isDirectory } from "../lib/fs-util.js";
import { git, gitConfig } from "../lib/git.js";
import { IGitGitGadgetOptions, getVar } from "../lib/gitgitgadget.js";
import { GitHubGlue } from "../lib/github-glue.js";
import { toPrettyJSON } from "../lib/json-util.js";
import { IGitMailingListMirrorState, stateKey } from "../lib/mail-archive-helper.js";
import { IPatchSeriesMetadata } from "../lib/patch-series-metadata.js";
import { IConfig } from "../lib/project-config.js";

let commander = new Command();
const publishRemoteKey = "publishRemote";

commander
    .version("1.0.0")
    .usage("[options] <command> [args...]")
    .description("Command-line helper for GitGitGadget")
    .passThroughOptions()
    .option(
        "-g, --git-work-dir [directory]",
        "Use a different git.git working directory than specified via `gitgitgadget.workDir`",
        undefined,
    )
    .option(
        "-G, --gitgitgadget-work-dir [directory]",
        "Use a different gitgitgadget working directory than the current working directory to access the Git config" +
            "e.g. for `gitgitgadget.workDir`",
        ".",
    )
    .option("-c, --config <string>", "Use this configuration when using gitgitgadget with a project other than git", "")
    .option("-s, --skip-update", "Do not update the local refs (useful for debugging)")
    .argument("[args...]", "command arguments (call `list -h` for more information)")
    .parse(process.argv);

interface ICommanderOptions {
    config: string | undefined;
    gitgitgadgetWorkDir: string | undefined;
    gitWorkDir: string | undefined;
    skipUpdate: boolean | undefined;
}

const commandOptions = commander.opts<ICommanderOptions>();

(async (): Promise<void> => {
    const config: IConfig = await CIHelper.getConfig(commandOptions.config);

    const getGitGitWorkDir = async (): Promise<string> => {
        if (!commandOptions.gitWorkDir) {
            commandOptions.gitWorkDir = await getVar("workDir", commandOptions.gitgitgadgetWorkDir);

            if (!commandOptions.gitWorkDir) {
                throw new Error("Could not determine gitgitgadget.workDir");
            }
        }
        if (!(await isDirectory(commandOptions.gitWorkDir))) {
            console.log(`Cloning git into ${commandOptions.gitWorkDir}`);
            await git([
                "clone",
                `https://github.com/${config.repo.owner}/${config.repo.name}`,
                commandOptions.gitWorkDir,
            ]);
        }
        return commandOptions.gitWorkDir;
    };

    const ci = new CIHelper(
        await getGitGitWorkDir(),
        config,
        commandOptions.skipUpdate,
        commandOptions.gitgitgadgetWorkDir,
    );

    const configureNotesPushToken = async (): Promise<void> => {
        const token = await gitConfig("gitgitgadget.githubToken");
        if (!token) {
            throw new Error("No token configured for gitgitgadget.githubToken");
        }
        ci.setAccessToken("gitgitgadget", token);
    };

    const argv = commander.args;
    commander = new Command().version("1.0.0");
    commander
        .usage("[options] command")
        .command("update-open-prs")
        .description("Update GitGitGadget's idea of what PRs are open")
        .action(async () => {
            await configureNotesPushToken();
            const result = await ci.updateOpenPrs();
            console.log(`Updated notes: ${result}`);
        });
    commander
        .command("update-commit-mappings")
        .description("Determine which commits correspond to which open PRs")
        .action(async () => {
            await configureNotesPushToken();
            const result = await ci.updateCommitMappings();
            console.log(`Updated notes: ${result}`);
        });
    commander
        .command("handle-open-prs")
        .description("Handle open PRs, i.e. look whether they have been integrated into upstream Git")
        .action(async () => {
            await configureNotesPushToken();
            const options = await ci.getGitGitGadgetOptions();
            if (!options.openPRs) {
                throw new Error("No open PRs?");
            }
            const result = await ci.handleOpenPRs();
            console.log(`Updated notes: ${result}`);
        });
    commander
        .command("lookup-upstream-commit")
        .argument("<commit>")
        .description("Look up the corresponding upstream commit for a given commit in any of the open PRs")
        .action(async (commit: string) => {
            const upstreamCommit = await ci.identifyUpstreamCommit(commit);
            console.log(`Upstream commit for ${commit}: ${upstreamCommit}`);
        });
    commander
        .command("set-upstream-commit")
        .argument("<original-commit>")
        .argument("<git.git-commit>")
        .description("Set the upstream commit for a given commit in any of the open PRs")
        .action(async (originalCommit: string, gitGitCommit: string) => {
            await ci.setUpstreamCommit(originalCommit, gitGitCommit);
        });
    commander
        .command("set-tip-commit-in-git.git")
        .argument("<pr-url>")
        .argument("<git.git-commit>")
        .description("Set the tip commit in git.git for a given PR")
        .action(async (pullRequestURL: string, gitGitCommit: string) => {
            const data = await ci.getPRMetadata(pullRequestURL);
            if (!data) {
                throw new Error(`No metadata for ${pullRequestURL}`);
            }
            data.tipCommitInGitGit = gitGitCommit;
            await ci.notes.set(pullRequestURL, data, true);
        });
    commander
        .command("set-previous-iteration")
        .argument("<pullRequestURL>")
        .argument("<iteration>")
        .argument("<coverLetterMessageId>")
        .argument("<latestTag>")
        .argument("<baseCommit>")
        .argument("<baseLabel>")
        .argument("<headCommit>")
        .argument("<headLabel>")
        .action(
            async (
                pullRequestURL: string,
                iteration: string,
                coverLetterMessageId: string,
                latestTag: string,
                baseCommit: string,
                baseLabel: string,
                headCommit: string,
                headLabel: string,
            ) => {
                const data = await ci.getPRMetadata(pullRequestURL);
                if (data !== undefined) {
                    process.stderr.write(`Found existing data for ${pullRequestURL}: ${toPrettyJSON(data)}`);
                    process.exit(1);
                }
                const newData = {
                    baseCommit,
                    baseLabel,
                    coverLetterMessageId,
                    headCommit,
                    headLabel,
                    iteration: parseInt(iteration, 10),
                    latestTag,
                    pullRequestURL,
                } as IPatchSeriesMetadata;
                console.log(`data: ${toPrettyJSON(newData)}`);
                await ci.notes.set(pullRequestURL, newData);
            },
        );
    commander
        .command("update-commit-mapping")
        .argument("<message-id>")
        .description("Update the commit mapping for a given Message-ID")
        .action(async (messageID: string) => {
            const result = await ci.updateCommitMapping(messageID);
            console.log(`Result: ${result}`);
        });
    commander
        .command("annotate-commit")
        .argument("<original-commit>")
        .argument("<git.git-commit>")
        .description("Annotate a commit on GitHub with the corresponding git.git commit")
        .action(async (originalCommit: string, gitGitCommit: string) => {
            const glue = new GitHubGlue(ci.workDir, config.repo.owner, config.repo.name);
            const id = await glue.annotateCommit(
                originalCommit,
                gitGitCommit,
                config.repo.owner,
                config.repo.baseOwner,
            );
            console.log(`Created check with id ${id}`);
        });
    commander
        .command("identify-merge-commit")
        .argument("<upstream-branch>")
        .argument("<commit>")
        .description("Identify the merge commit that introduced a given commit into an upstream branch")
        .action(async (upstreamBranch: string, commit: string) => {
            const result = await ci.identifyMergeCommit(upstreamBranch, commit);
            console.log(result);
        });
    commander
        .command("get-gitgitgadget-options")
        .description("Display the current GitGitGadget options")
        .action(async () => {
            console.log(toPrettyJSON(await ci.getGitGitGadgetOptions()));
        });
    commander
        .command("init-gitgitgadget-options")
        .argument("<initial-user>")
        .description("Initialize the GitGitGadget options")
        .action(async (initialUser: string, _options, command) => {
            try {
                await ci.getGitGitGadgetOptions();
                process.stderr.write(`${command}: ${config.repo.owner}/${config.repo.name} already initialized\n`);
                process.exit(1);
            } catch (_error) {
                const options: IGitGitGadgetOptions = { allowedUsers: [initialUser] };
                await ci.notes.set("", options, true);

                const publishTagsAndNotesToRemote = await getVar(publishRemoteKey, commandOptions.gitgitgadgetWorkDir);

                if (!publishTagsAndNotesToRemote) {
                    throw new Error("No remote to which to push configured");
                }
                await git(["push", publishTagsAndNotesToRemote, "--", `${ci.notes.notesRef}`], {
                    workDir: commandOptions.gitWorkDir,
                });
            }

            console.log(toPrettyJSON(await ci.getGitGitGadgetOptions()));
        });
    commander
        .command("init-email-commit-tip")
        .argument("<latest-revision>")
        .description("Initialize the email-commit tip revision")
        .action(async (latestRevision: string) => {
            try {
                await ci.getGitGitGadgetOptions(); // get the notes updated
            } catch (_error) {
                console.log(
                    "Options not set. Please run `misc-helper init-gitgitgadget-options` to set the allowedUsers.",
                );
            }

            const state: IGitMailingListMirrorState = (await ci.notes.get<IGitMailingListMirrorState>(stateKey)) || {};
            state.latestRevision = latestRevision;
            await ci.notes.set(stateKey, state, true);
            const publishTagsAndNotesToRemote = await getVar(publishRemoteKey, commandOptions.gitgitgadgetWorkDir);
            if (!publishTagsAndNotesToRemote) {
                throw new Error("No remote to which to push configured");
            }
            await git(["push", publishTagsAndNotesToRemote, "--", `${ci.notes.notesRef}`], {
                workDir: commandOptions.gitWorkDir,
            });

            console.log(toPrettyJSON(state));
        });
    commander
        .command("get-mail-meta")
        .argument("<message-id>")
        .description("Get the metadata for a given Message-ID")
        .action(async (messageID: string) => {
            console.log(toPrettyJSON(await ci.getMailMetadata(messageID)));
        });
    class OptionalRepoOwnerCommand extends Command {
        constructor(
            name: string,
            description: string,
            action: (repositoryOwner: string, pullRequestURL: string) => Promise<void>,
            verbatim2ndArgument = false,
        ) {
            super(name);
            super.argument("[repository-owner]");
            super.argument("<pr-number>");
            super.description(description);
            super.action(async (...args: string[]) => {
                if (args[1] === undefined) {
                    args[1] = args[0];
                    args[0] = config.repo.owner;
                }
                const [repositoryOwner, prNumber] = args;
                const pullRequestURL =
                    verbatim2ndArgument || prNumber.match(/^http/)
                        ? prNumber
                        : `https://github.com/${repositoryOwner}/${config.repo.name}/pull/${prNumber}`;
                return await action(repositoryOwner, pullRequestURL);
            });
        }
        // Commander does not understand when optional arguments come before required ones
        protected _checkNumberOfArguments() {
            if (this.args.length < 1 || this.args.length > 2) {
                // Nasty hack: `_checkNumberOfArguments` is a private method, so we can't call it directly
                // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, no-underscore-dangle
                (Command.prototype as unknown as { _checkNumberOfArguments: Function })._checkNumberOfArguments.call(
                    this,
                );
            }
        }
    }
    commander.addCommand(
        new OptionalRepoOwnerCommand(
            "get-pr-meta",
            "Get the metadata for a given Pull Request",
            async (_repositoryOwner: string, pullRequestURL: string) => {
                console.log(toPrettyJSON(await ci.getPRMetadata(pullRequestURL)));
            },
        ),
    );
    commander.addCommand(
        new OptionalRepoOwnerCommand(
            "get-pr-commits",
            "Get the commits for a given Pull Request",
            async (_repositoryOwner, pullRequestURL) => {
                const prMeta = await ci.getPRMetadata(pullRequestURL);
                if (!prMeta) {
                    throw new Error(`No metadata found for ${pullRequestURL}`);
                }
                console.log(toPrettyJSON(await ci.getOriginalCommitsForPR(prMeta)));
            },
        ),
    );
    commander.addCommand(
        new OptionalRepoOwnerCommand(
            "handle-pr",
            "Handle a given Pull Request (add it to open PRs, update commit <-> message ID mapping, etc.)",
            async (_repositoryOwner, pullRequestURL) => {
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
                        if (messageID && options.activeMessageIDs[messageID] === undefined) {
                            options.activeMessageIDs[messageID] = rev;
                            optionsUpdated = true;
                            if (await ci.updateCommitMapping(messageID)) {
                                notesUpdated = true;
                            }
                        }
                    }
                }

                const [notesUpdated2, optionsUpdated2] = await ci.handlePR(pullRequestURL, options);
                if (notesUpdated2 || optionsUpdated || optionsUpdated2) {
                    notesUpdated = true;
                }
                console.log(`Notes were ${notesUpdated ? "" : "not "}updated`);
            },
        ),
    );
    commander
        .command("add-pr-comment")
        .argument("<pr-url>")
        .argument("<comment>")
        .description("Add a comment to a given Pull Request")
        .action(async (pullRequestURL: string, comment: string) => {
            if (pullRequestURL.match(/^[0-9]+$/)) {
                pullRequestURL = `https://github.com/gitgitgadget/${config.repo.name}/pull/${commander.args[1]}`;
            }

            const glue = new GitHubGlue(ci.workDir, config.repo.owner, config.repo.name);
            await glue.addPRComment(pullRequestURL, comment);
        });
    commander
        .command("set-app-token")
        .argument("[args...]")
        .description("Set the GitHub App token in the Git config")
        .action(async (args: string[]) => {
            const set = async (options: { appID: number; installationID?: number; name: string }): Promise<void> => {
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
                        privateKey: key.replace(/\\n/g, `\n`),
                    },
                });

                if (options.installationID === undefined) {
                    options.installationID = (
                        await client.rest.apps.getRepoInstallation({
                            owner: options.name,
                            repo: config.repo.name,
                        })
                    ).data.id;
                }
                const result = await client.rest.apps.createInstallationAccessToken({
                    installation_id: options.installationID,
                });
                const configKey =
                    options.name === config.app.name
                        ? `${config.app.name}.githubToken`
                        : `gitgitgadget.${options.name}.githubToken`;
                await git(["config", configKey, result.data.token]);
            };

            await set(config.app);
            for (const org of args) {
                await set({ appID: 46807, name: org });
            }
        });
    commander.addCommand(
        new OptionalRepoOwnerCommand(
            "handle-pr-comment",
            "Handle a comment on a Pull Request",
            async (repositoryOwner: string, commentID: string) => {
                if (repositoryOwner === undefined) repositoryOwner = config.repo.owner;
                await configureNotesPushToken();
                await ci.handleComment(repositoryOwner, parseInt(commentID, 10));
            },
            true,
        ),
    );
    commander.addCommand(
        new OptionalRepoOwnerCommand(
            "handle-pr-push",
            "Handle a push to a Pull Request",
            async (repositoryOwner: string, prNumber: string) => {
                await configureNotesPushToken();
                await ci.handlePush(repositoryOwner, parseInt(prNumber, 10));
            },
            true,
        ),
    );
    commander
        .command("handle-new-mails")
        .description("Handle new mails in the mail archive")
        .action(async () => {
            await configureNotesPushToken();
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
        });
    await commander.parseAsync(argv, { from: "user" });
})().catch((reason: Error) => {
    console.log(`Caught error ${reason}:\n${reason.stack}\n`);
    process.stderr.write(`Caught error ${reason}:\n${reason.stack}\n`);
    process.exit(1);
});
