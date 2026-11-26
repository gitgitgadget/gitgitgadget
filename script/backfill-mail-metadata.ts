import { spawnSync } from "child_process";
import { GitNotes } from "../lib/git-notes.js";
import { IMailMetadata } from "../lib/mail-metadata.js";
import { git } from "../lib/git.js";

const [mirrorDir, notesDir, remote] = process.argv.slice(2);
if (!mirrorDir || !notesDir || !remote) {
    throw new Error("Usage: node build/script/backfill-mail-metadata.js <mirror.git> <gitgitgadget.git> <remote>");
}

function catBatch(workDir: string, oids: string[]): Buffer[] {
    if (!oids.length) return [];
    const result = spawnSync("git", ["cat-file", "--batch"], {
        cwd: workDir,
        input: `${oids.join("\n")}\n`,
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr.toString());
    const contents: Buffer[] = [];
    let offset = 0;
    for (const oid of oids) {
        const endOfHeader = result.stdout.indexOf(10, offset);
        if (endOfHeader < 0) throw new Error("Unexpected output from git cat-file --batch");
        const header = result.stdout.subarray(offset, endOfHeader).toString("ascii").split(" ");
        if (header[0] !== oid || header[1] !== "blob") throw new Error(`Missing blob ${oid}`);
        const size = Number(header[2]);
        const start = endOfHeader + 1;
        contents.push(result.stdout.subarray(start, start + size));
        offset = start + size + 1;
    }
    return contents;
}

const notes = new GitNotes(notesDir);
const noteEntries = (await git(["notes", `--ref=${notes.notesRef}`, "list"], { workDir: notesDir }))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[0]);
const noteBlobs = catBatch(notesDir, noteEntries);
const missing = new Map<string, IMailMetadata>();
for (const blob of noteBlobs) {
    const metadata = JSON.parse(blob.toString("utf8")) as IMailMetadata;
    if (metadata.messageID && !metadata.mailBlobOID) missing.set(metadata.messageID, metadata);
}
if (!missing.size) {
    console.log("All mail notes already have a mailing-list blob OID");
    process.exit(0);
}

const commits = (await git(["log", "--all", "--format=%H", "--", "m"], { workDir: mirrorDir }))
    .trim()
    .split("\n")
    .filter(Boolean);
let updated = 0;
for (let i = 0; i < commits.length && missing.size; i += 500) {
    const chunk = commits.slice(i, i + 500);
    const blobOids = (await git(["rev-parse", ...chunk.map((commit) => `${commit}:m`)], { workDir: mirrorDir }))
        .trim()
        .split("\n");
    const blobs = catBatch(mirrorDir, blobOids);
    for (let j = 0; j < blobs.length; j++) {
        const headers = blobs[j].subarray(0, blobs[j].indexOf(Buffer.from("\n\n"))).toString("utf8");
        const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
        const messageID = unfolded.match(/^Message-ID:\s*<([^>]+)>\s*$/im)?.[1];
        const metadata = messageID && missing.get(messageID);
        if (!metadata) continue;
        metadata.mailBlobOID = blobOids[j];
        await notes.set(messageID, metadata, true);
        missing.delete(messageID);
        updated++;
    }
    console.log(
        `Scanned ${Math.min(i + chunk.length, commits.length)} of ${commits.length} mirror mails; updated ${updated}`,
    );
}

await notes.push(remote);
if (missing.size) console.warn(`${missing.size} notes could not be matched to a mirror email`);
console.log(`Backfilled ${updated} Message-ID to blob OID mappings`);
