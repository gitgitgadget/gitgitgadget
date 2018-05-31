import * as fs from "fs";
import * as util from "util";
import { git } from "../lib/git";

const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const realpath = util.promisify(fs.realpath);
const rmdir = util.promisify(fs.rmdir);
const stat = util.promisify(fs.stat);
const unlink = util.promisify(fs.unlink);

export async function isDirectory(path: string): Promise<boolean> {
    try {
        if ((await stat(path)).isDirectory()) {
            return true;
        }
    } catch (reason) {
        /* it's okay */
    }
    return false;
}

export async function removeRecursively(path: string): Promise<void> {
    if (!await isDirectory(path)) {
        await unlink(path);
    } else {
        const items = await readdir(path);
        for (const name of items) {
            await removeRecursively(`${path}/${name}`);
        }
        await rmdir(path);
    }
}

export async function testCreateRepo(name: string) {
    const tmp = await realpath(`${__dirname}/../.test-dir/`);
    if (!await isDirectory(tmp)) {
        await mkdir(tmp);
    }

    const match = name.match(/^(.*[\\/])?(.*?)(\.test)?\.ts$/);
    if (match) {
        name = `trash directory.${match[2]}`;
    }

    const dir = `${tmp}/${name}`;
    if (await isDirectory(dir)) {
        await removeRecursively(dir);
        if (await isDirectory(dir)) {
            throw new Error(`rm -rf ${dir} failed!`);
        }
    }

    await git(["init", dir]);
    return dir;
}
