import { CIHelper } from "./ci-helper.js";
import { isDirectory } from "./fs-util.js";
import { getConfig } from "./gitgitgadget-config.js";
import { IConfig, loadConfig, setConfig } from "./project-config.js";
import path from "path";

export interface PRUpdateInterface {
    action: string;
    repositoryDir: string;
    configRepositoryDir: string;
    config: string;
    repoOwner: string;
    repoName: string;
    repoBaseowner: string;
    pullRequestNumber: string;
    commentId?: string | undefined;
    skipUpdate?: string | undefined;
}

/**
 * Handle an update to a pull request.  It may be a create or sync of changes or a comment.
 *
 * @param parms
 */

export async function handlePRUpdate(parms: PRUpdateInterface): Promise<void> {
    const config: IConfig = parms.config ? setConfig(await getExternalConfig(parms.config)) : getConfig();

    // Update with current values
    config.repo.name = parms.repoName;
    config.repo.owner = parms.repoOwner;
    config.repo.baseOwner = parms.repoBaseowner;
    setConfig(config);

    lintConfig(config);

    if (!(await isDirectory(parms.repositoryDir))) {
        throw new Error(`git WorkDir '${parms.repositoryDir}' not found.`);
    }

    const ci = new CIHelper(parms.repositoryDir, config, parms.skipUpdate ? true : false, parms.configRepositoryDir);

    if (parms.action === "comment") {
        if (parms.commentId) {
            const commentId = parseInt(parms.commentId, 10);
            await ci.handleComment(parms.repoOwner, commentId);
        } else {
            throw new Error(`Action '${parms.action}' requires a comment-id.`);
        }
    } else if (parms.action === "push") {
        const pullRequestNumber = parseInt(parms.pullRequestNumber, 10);
        await ci.handlePush(parms.repoOwner, pullRequestNumber);
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
            `User configurations must have a 'project:'.  Not found in\n${JSON.stringify(config, null, 2)}`,
        );
    }

    if (!config.repo.owner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'owner' ${config.repo.owner} in\n${JSON.stringify(config, null, 2)}`);
    }

    if (!config.repo.baseOwner.match(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)) {
        throw new Error(`Invalid 'baseOwner' ${config.repo.baseOwner} in\n${JSON.stringify(config, null, 2)}`);
    }
}
