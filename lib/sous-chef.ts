/*
 * This class is designed to parse the "What's cooking" mails sent to
 * the Git mailing list about twice a week by the Git maintainer.
 */

export class SousChef {
    public readonly mbox: string;
    public readonly messageID: string | undefined;
    public readonly subject: string | undefined;
    public readonly branches = new Map<string, { merged: string | undefined; sectionName: string; text: string }>();

    public constructor(mbox: string) {
        this.mbox = mbox;

        const sections = mbox.split(/^-{10,}\n\[([^\]]+)\]\n/gm);
        for (let i = 1; i < sections.length; i += 2) {
            const sectionName = sections[i];

            const branches = sections[i + 1].split(/\n\* ([a-z][^]+?)\n\n/m);
            for (let j = 1; j < branches.length; j += 2) {
                const match = branches[j].match(/([^ ]+).*\n *(\(merged to [^)]+\))?/m);
                if (!match) {
                    continue;
                }

                const branchName = match[1];
                const merged = match[2];
                const text = branches[j + 1].replace(/^ /gm, "").replace(/\s*$/, "");
                this.branches.set(branchName, { merged, sectionName, text });
            }
        }

        const messageIDMatch = `\n${sections[0]}`.match(/\nMessage-ID: <([^>]+)>/i);
        this.messageID = messageIDMatch?.[1];
        const subjectMatch = `\n${sections[0]}`.match(/\nSubject: (.*)/i);
        this.subject = subjectMatch?.[1];
    }
}
