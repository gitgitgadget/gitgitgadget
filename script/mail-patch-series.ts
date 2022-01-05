#!/usr/bin/env node

/*
 * This script is intended to help submit patch series to projects which want
 * contributions to be sent to a mailing list. The process is not quite as
 * painless for the contributor as opening Pull Requests, but at least it is
 * much less painful than having to all the steps manually.
 *
 * Example usage:
 *
 *    /path/to/mail-patch-series.sh
 *
 * (All relevant information, such as the mailing list to which this patch
 * series needs to be sent, the current iteration of the patch series, etc is
 * inferred from the current branch in the current repository.)
 *
 * Currently, this script supports submitting patch series (or single patches)
 * to only two projects: Git and Cygwin, with the upstream remotes being called
 * 'upstream' and 'cygwin', respectively.
 *
 * To make use of this script, you first have to have a topic branch. It needs
 * to be rebased to the latest `master` (or `next` in the case of Git).
 *
 * Further, you need an alias called `send-mbox` that takes an mbox on stdin
 * and puts the individual mails into the Drafts folder of your maildir, ready
 * to send. Example for alias.send-mbox:
 *
 * [alias]
 *    send-mbox = !git mailsplit -o\"$HOME\"/Mail/Drafts/new
 *
 * When running this script on a newer iteration of the same topic branch, it
 * will detect that and use the appropriate [PATCH v<iteration>] prefix.
 *
 * This script will also use the branch description as cover letter. Unlike
 * plain format-patch, the first line will be used as subject and the rest as
 * mail body, without any ugly "*** Subject/Blurb here ***".
 *
 * Note that this script will demand a branch description (which can be added
 * or edited using `git branch --edit-description`) if the current topic branch
 * contains more that a single patch; For single-patch "series", the branch
 * description is optional.
 *
 * This script will also try to Cc: original authors when sending patches on
 * their behalf, and people mentioned in the Cc: footer of commit messages.
 *
 * To Cc: the entire patch series to, say, reviewers who commented on some
 * iteration of the patch series, the script supports being called with the
 * `--cc 'R E Viewer <reviewer@email.com>'` option; This information is then
 * stored in the config, and used when sending the next iteration.
 *
 * Furthermore, for a second or later iteration of a patch series, this script
 * will insert an range-diff, and reply to the cover letter of the
 * previous iteration. It stores the relevant information in local tags whose
 * names reflect the branch name and the iteration.
 *
 * Lastly, if the mail.publishtoremote is set in the config, the branch as well
 * as the generated tag(s) will be pushed to the remote of that name. If this
 * remote's URL points to GitHub, the URL to the tag will be sent together with
 * the patch series.
 *
 * If anything goes awry, an iteration can be regenerated/resent with the
 * `--redo` option.
 */

import { git, gitConfig } from "../lib/git";
import { PatchSeries } from "../lib/patch-series";
import { PatchSeriesOptions } from "../lib/patch-series-options";
import { ProjectOptions } from "../lib/project-options";

async function main(argv: string[]) {
    let i: number;
    let match: RegExpMatchArray | null;

    const logger = console;
    const options = new PatchSeriesOptions();
    let publishToRemote = "";

    for (i = 2; i < argv.length; i++) {
        let arg = argv[i];
        if (arg === "--redo") {
            options.redo = true;
        } else if (arg === "--dry-run" || arg === "-n") {
            options.dryRun = true;
            options.noUpdate = true;
        } else if (arg === "--rfc") {
            options.rfc = true;
            // tslint:disable-next-line:no-conditional-assignment
        } else if (match = arg.match(/^--publish-to-remote=.*/)) {
            publishToRemote = match[1];
        } else if (arg === "--patience") {
            options.patience = true;
        } else if (arg === "--cc") {
            const key = "branch." + await ProjectOptions.getBranchName(".")
                + ".cc";
            arg = i + 1 < argv.length ? argv[++i] : "";
            if (i + 1 !== argv.length) {
                throw new Error("Too many arguments");
            }
            if (!arg) {
                logger.log(await git(["config", "--get-all", key]));
            } else if (arg.match(/>.*>/) || arg.match(/>,/)) {
                await arg.replace(/> /g, ">,").split(",")
                    .map(async (email: string) => {
                        email = email.trim();
                        if (email) {
                            await git(["config", "--add", key, email]);
                        }
                    });
            } else if (arg.match(/@/)) {
                await git(["config", "--add", key, arg]);
            } else {
                const id = await git(["log", "-1", "--format=%an <%ae>",
                                      "--author=" + arg]);
                if (!id) {
                    throw new Error("Not an email address: " + arg);
                }
                logger.log("Adding Cc: " + id);
                await git(["config", "--add", key, id]);
            }
            return;
            // tslint:disable-next-line:no-conditional-assignment
        } else if (match = arg.match(/^--basedon=(.*)/)) {
            const key = "branch." + await ProjectOptions.getBranchName(".")
                + ".basedon";
            await git(["config", key, arg]);
            return;
        } else if (arg === "--basedon") {
            const key = "branch." + await ProjectOptions.getBranchName(".")
                + ".basedon";
            if (i + 1 === argv.length) {
                logger.log(gitConfig(key));
            } else if (i + 2 === argv.length) {
                await git(["config", key, argv[++i]]);
            } else {
                throw new Error("Too many arguments");
            }
            return;
        } else {
            break;
        }
    }

    if (i < argv.length) {
        throw new Error("Usage: " + argv[1] +
            " [--redo] [--publish-to-remote=<remote>] |\n" +
            "--cc [<email-address>] | --basedon [<branch>]");
    }

    if (!publishToRemote ||
        ! await gitConfig("remote." + publishToRemote + ".url")) {
        throw new Error("No valid remote: " + publishToRemote);
    }

    let finishDryRun = () => {
        return;
    };

    if (options.dryRun &&
        typeof (process.env.GIT_PAGER_IN_USE) === "undefined") {
        const childProcess = require("child_process");
        const args: string[] = [];
        if (typeof (process.env.LESS) === "undefined") {
            args.push("-FRX");
        }
        const spawnOptions = { stdio: ["pipe", "inherit", "inherit"] };
        const less = childProcess.spawn("less", args, spawnOptions);
        console.log = (msg: string) => {
            less.stdin.write(msg + "\n");
        };
        finishDryRun = () => {
            less.stdin.end();
            less.on("exit", () => { process.exit(); });
        };
        process.env.GIT_PAGER_IN_USE = "true";
    }

    const project = await ProjectOptions.getLocal();
    const patchSeries = await PatchSeries.getFromTag(options, project);
    await patchSeries.generateAndSend(console);

    if (finishDryRun) {
        finishDryRun();
    }
}

main(process.argv).catch((err) => {
    process.stderr.write(err + "\n");
    process.exit(1);
});
