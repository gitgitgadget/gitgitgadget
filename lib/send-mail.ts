import { createTransport, SendMailOptions } from "nodemailer";
import SMTPTransport = require("nodemailer/lib/smtp-transport");
import { decode } from "rfc2047";

export interface IParsedMBox {
    body: string;
    cc?: string[];
    date?: string;
    from?: string;
    headers?: Array<{ key: string; value: string }>;
    messageId?: string;
    sender?: string;
    subject?: string;
    to?: string;
    raw: string;
}

export interface ISMTPOptions {
    smtpUser: string;
    smtpHost: string;
    smtpOpts?: string;
    smtpPass: string;
}

export async function parseHeadersAndSendMail(mbox: string,
                                              smtpOptions: ISMTPOptions):
    Promise<string> {
    return await sendMail(await parseMBox(mbox), smtpOptions);
}

function replaceAll(input: string, pattern: string, replacement: string):
    string {
    return input.split(pattern).join(replacement);
}

/**
 * Parses a mail in mbox format, in preparation for sending it.
 *
 * Note: this function does *not* validate the input. For example, it does not
 * error out if, say, duplicate `Date:` headers were provided.
 *
 * @param {string} mbox The mail, in mbox format
 * @returns {IParsedMBox} the parsed headers/body
 */
export async function parseMBox(mbox: string, gentle?: boolean):
    Promise<IParsedMBox> {
    const headerEnd = mbox.indexOf("\n\n");
    if (headerEnd < 0) {
        throw new Error("Could not parse mail");
    }
    const headerStart = mbox.startsWith("From ") ? mbox.indexOf("\n") + 1 : 0;

    const header = mbox.substr(headerStart, headerEnd - headerStart);
    const body = mbox.substr(headerEnd + 2);

    let cc: string[] | undefined;
    let date: string | undefined;
    let from: string | undefined;
    const headers = new Array<{ key: string; value: string }>();
    let messageId: string | undefined;
    let sender: string | undefined;
    let subject: string | undefined;
    let to: string | undefined;

    for (const line of header.split(/\n(?![ \t])/)) {
        const colon = line.indexOf(": ");
        if (colon < 0) {
            throw new Error(`Failed to parse header line '${line}`);
        }
        const key = line.substr(0, colon);
        const value = replaceAll(line.substr(colon + 2), "\n ", " ");
        switch (key.toLowerCase()) {
            case "cc": cc = (cc || []).concat(value.split(", ")); break;
            case "date": date = value; break;
            case "fcc": break;
            case "from": from = decode(value.trim()); break;
            case "message-id": messageId = value; break;
            case "sender": sender = value.trim(); break;
            case "subject": subject = value; break;
            case "to": to = value; break;
            default:
                headers.push({ key, value });
        }
    }

    if (!gentle && (!to || !subject || !from)) {
        throw new Error(`Missing To, Subject and/or From header:\n${header}`);
    }

    return {
        body,
        cc,
        date,
        from,
        headers,
        messageId,
        raw: mbox,
        sender,
        subject,
        to,
    };
}

export async function parseMBoxMessageIDAndReferences(mbox: string):
        Promise<{messageID: string; references: string[]}> {
    const parsed = await parseMBox(mbox, true);
    if (!parsed.headers) {
        throw new Error(`Could not parse ${mbox}`);
    }
    const references: string[] = [];
    const seen: Set<string> = new Set<string>();
    /*
     * This regular expression parses whitespace-separated lists of the form
     * <MESSAGE-ID> [(COMMENT ["QUOTED"])], i.e. lists of message IDs that are
     * enclosed in pointy brackets, possibly followed by a comment that is
     * enclosed in parentheses which possibly contains one quoted string.
     *
     * This is in no way a complete parser for RFC2822 (which is not possible
     * using regular expressions due to its recursive nature) but seems to be
     * good enough for the Git mailing list.
     */
    const msgIdRegex =
        /^\s*<([^>]+)>(\s*|,)(\([^")]*("[^"]*")?\)\s*|\([^)]*\)$)?(<.*)?$/;
    for (const header of parsed.headers) {
        if (header.key === "In-Reply-To" || header.key === "References") {
            let value: string = header.value;
            while (value) {
                const match = value.match(msgIdRegex);
                if (!match) {
                    if (value !== undefined && !value.match(/^\s*$/)) {
                        throw new Error(`Error parsing Message-ID '${value}'`);
                    }
                    break;
                }
                if (!seen.has(match[1])) {
                    references.push(match[1]);
                    seen.add(match[1]);
                }
                value = match[5];
            }
        }
    }
    if (!parsed.messageId) {
        throw new Error(`No Message-ID found in ${mbox}`);
    }
    const messageID = parsed.messageId.match(/^<(.*)>$/);
    if (!messageID) {
        throw new Error(`Unexpected Message-ID format: ${parsed.messageId}`);
    }
    return { messageID: messageID[1], references };
}

export async function sendMail(mail: IParsedMBox,
                               smtpOptions: ISMTPOptions):
    Promise<string> {
    const transportOpts: SMTPTransport.Options | any = {
        auth: {
            pass: smtpOptions.smtpPass,
            user: smtpOptions.smtpUser,
        },
        host: smtpOptions.smtpHost,
        secure: true,
    };

    if (smtpOptions.smtpOpts) {
        // Add quoting for JSON.parse
        const smtpOpts = smtpOptions.smtpOpts
            .replace(/([ {])([a-zA-Z0-9.]+?) *?:/g,"$1\"$2\":");
        Object.entries(JSON.parse(smtpOpts))
            .forEach(([key, value]) => transportOpts[key] = value);
    }

    return new Promise<string>((resolve, reject) => {
        const transporter = createTransport( transportOpts );

        // setup email data with unicode symbols
        const mailOptions: SendMailOptions = {
            envelope: {
                cc: mail.cc ? mail.cc.join(", ") : undefined,
                from: mail.from,
                to: mail.to,
            },
            raw: mail.raw,
            sender: mail.sender ? mail.sender : undefined,
        };

        transporter.sendMail(mailOptions, (error, info): void => {
            if (error) {
                reject(error);
            } else {
                resolve(info.messageId);
            }
        });
    });
}
