import { CIHelper } from "./ci-helper.js";
import { isDirectory } from "./fs-util.js";
import { getConfig } from "./gitgitgadget-config.js";
import { getVar } from "./gitgitgadget.js";
import { IConfig, loadConfig, setConfig } from "./project-config.js";
import path from "path";

export interface actionInterface {
    action: string;
    repositoryDir: string;
    configRepositoryDir: string;
    config: string;
    repoOwner: string;
    repoName: string;
    skipUpdate?: string | undefined;
}

/**
 * Handle various gitgitgadget requests.
 *
 * @param parms
 */

export async function handleAction(parms: actionInterface): Promise<void> {
    const config: IConfig = parms.config ? setConfig(await getExternalConfig(parms.config)) : getConfig();

    // Update with current values
    config.repo.name = parms.repoName;
    config.repo.owner = parms.repoOwner;
    setConfig(config);

    lintConfig(config);

    if (!(await isDirectory(parms.repositoryDir))) {
        throw new Error(`git WorkDir '${parms.repositoryDir}' not found.`);
    }

    const ci = new CIHelper(parms.repositoryDir, config, parms.skipUpdate ? true : false, parms.configRepositoryDir);

    if (parms.action === "update-open-prs") {
        const result = await ci.updateOpenPrs();
        console.log(`Updated notes: ${result}`);
    } else if (parms.action === "update-commit-mappings") {
        const result = await ci.updateCommitMappings();
        console.log(`Updated notes: ${result}`);
    } else if (parms.action === "handle-open-prs") {
        const options = await ci.getGitGitGadgetOptions();
        if (!options.openPRs) {
            throw new Error("No open PRs?");
        }
        const result = await ci.handleOpenPRs();
        console.log(`Updated notes: ${result}`);
    } else if (parms.action === "handle-new-mails") {
        const mailArchiveGitDir = await getVar("loreGitDir", undefined);

        if (!mailArchiveGitDir) {
            throw new Error("Need a lore.kernel/git worktree.");
        }

        await ci.handleNewMails(mailArchiveGitDir);
    } else {
        throw new Error(`Unknown action '${parms.action}'.`);
    }
}

async function getExternalConfig(file: string): Promise<IConfig> {
    return await loadConfig(path.resolve(file));
}

function lintConfig(config: IConfig): void {
    if (!Object.prototype.hasOwnProperty.call(config, "project")) {
        throw new Error(
            `User configurations must have a 'project:'.  Not found in:\n${JSON.stringify(config, null, 2)}`,
        );
    }

    if (!config.repo.owner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'owner' ${config.repo.owner} in\n${JSON.stringify(config, null, 2)}`);
    }

    if (!config.repo.baseOwner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'baseOwner' ${config.repo.baseOwner} in\n${JSON.stringify(config, null, 2)}`);
    }
}
