import { expect, jest, test } from "@jest/globals";
import { git, gitConfig } from "../lib/git.js";
import logger from "./logger.js";

jest.setTimeout(180000);

// init config in env
const configCount = 20;
process.env.GIT_CONFIG_COUNT = `${configCount}`;
for (let i = 0; i < configCount; i++) {
    process.env[`GIT_CONFIG_KEY_${i}`] = `TEST.TS.case${i}`;
    process.env[`GIT_CONFIG_VALUE_${i}`] = `test.case${i} value`;
}

const sleep = async (ms: number) => {
    await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), ms);
    });
};

test("finds core.bare", async () => {
    expect(await gitConfig("core.bare")).toMatch(/true|false/);
});

test("serialization", async () => {
    let waitTime = 10;
    type vars = { myWait: number; waitTime: number };
    const times = new Array<vars>();

    const lineHandler = async (): Promise<void> => {
        if (waitTime) {
            const myWait = --waitTime;
            logger(`waiting ${myWait}`);
            await sleep(waitTime * 50 + waitTime % 2 * 60); // odd/even have different waits
            logger(`waiting ${myWait} done`);
            // track waitTime before and after wait
            times.push({ myWait, waitTime });
        }
    };

    expect(await git(["config", "--get-regexp", "TEST"], { lineHandler })).toMatch("");
    times.map((el) => {
        logger(el.waitTime, el.myWait);
    });
    times.map((el) => {
        expect(el.waitTime).toEqual(el.myWait);
    });
});

test("sequencing", async () => {
    let waitTime = configCount;
    let buffer = "";

    const lineHandler = async (line: string): Promise<void> => {
        waitTime--;
        await sleep(waitTime * 50 + waitTime % 2 * 60); // odd/even have different waits
        buffer += `${line}\n`;
    };

    expect(await git(["config", "--get-regexp", "TEST"], { lineHandler })).toMatch("");
    expect(await git(["config", "--get-regexp", "TEST"], { trimTrailingNewline: false })).toEqual(buffer);
});

test("slow stdout", async () => {
    // ready for syntax checking
    const codeModel = `
    {
        let i = 30;
        const o = setInterval(() => {
            process.stdout.write('Printing line ' + i + '$nl');
            if (!--i) {
                clearInterval(o);
            }
        }, 100);
    }
    `;

    // compact spaces/newlines and add one as needed
    const code = codeModel.replace(/ +/g, " ").replace(/\n/g, "").replace(/\$nl/, "\\n");

    let buffer = "";

    // eslint-disable-next-line @typescript-eslint/require-await
    const lineHandler = async (line: string): Promise<void> => {
        buffer += `${line}\n`;
    };

    // set config (using "-c", `alias.node="!node"`, does not work - ! is escaped)
    process.env.GIT_CONFIG_COUNT = `1`;
    process.env.GIT_CONFIG_KEY_0 = `alias.node`;
    process.env.GIT_CONFIG_VALUE_0 = `!node`;

    expect(await git([`node`, `-e`, `${code}`], { lineHandler })).toEqual("");
    expect(await git([`node`, `-e`, `${code}`])).toEqual(buffer);
});
