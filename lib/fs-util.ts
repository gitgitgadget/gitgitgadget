import * as fs from "fs";
import * as util from "util";
const stat = util.promisify(fs.stat);

/**
 * Determine whether a given path refers to an existing directory.
 *
 * @param {string} path the path to the directory
 * @returns {boolean} whether the specified path points to an existing directory
 */
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

/**
 * Determine whether a given path refers to an existing file.
 *
 * @param {string} path the path to the file
 * @returns {boolean} whether the specified path points to an existing file
 */
export async function isFile(path: string): Promise<boolean> {
    try {
        if ((await stat(path)).isFile()) {
            return true;
        }
    } catch (reason) {
        /* it's okay */
    }
    return false;
}
