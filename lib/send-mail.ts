import { simpleParser, SimpleParserOptions } from "mailparser";
import { createTransport, SendMailOptions } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import rfc2047 from "rfc2047";

export interface IParsedMBox {
    body: string;
    cc?: string[];
    date?: string;
    from?: string;
    headers?: Array<{ key: string; value: string }>;
    messageId?: string;
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

export async function parseHeadersAndSendMail(mbox: string, smtpOptions: ISMTPOptions): Promise<string> {
    return await sendMail(await parseMBox(mbox), smtpOptions);
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
export async function parseMBox(mbox: string, gentle?: boolean): Promise<IParsedMBox> {
    let cc: string[] | undefined;
    let date: string | undefined;
    let from: string | undefined;
    const headers = new Array<{ key: string; value: string }>();
    let messageId: string | undefined;
    let subject: string | undefined;
    let to: string | undefined;

    const options: SimpleParserOptions = {
        skipHtmlToText: true,
        skipTextLinks: true,
        skipTextToHtml: true,
    };

    const parsed = await simpleParser(mbox, options);

    for (const entry of parsed.headerLines) {
        // try to parse header line and consume a leading line break after the colon in folded headers
        const valueSet = entry.line.match(/(.*?):(?:\r\n)? *([^]*)$/);
        if (!valueSet) {
            if (entry.line[entry.line.length - 1] === ":") {
                continue;
            }
            throw new Error(`Failed to parse header line '${entry.line}'`);
        }
        const key = valueSet[1];
        const value = valueSet[2];

        switch (entry.key) {
            case "cc":
                cc = (cc || []).concat(
                    value
                        .replace(/\r?\n/g, " ")
                        .split(", ")
                        .map((item) => item.trim()),
                );
                break;
            case "date":
                date = value;
                break;
            case "fcc":
                break;
            case "from":
                from = rfc2047.decode(value.trim());
                break;
            case "message-id":
                messageId = value;
                break;
            case "subject":
                subject = value;
                break;
            case "to":
                to = value;
                break;
            default:
                headers.push({ key, value });
        }
    }

    if (!gentle && (!to || !subject || !from)) {
        throw new Error(`Missing To, Subject and/or From header:\n${mbox}`);
    }

    return {
        body: parsed.text || "",
        cc,
        date,
        from,
        headers,
        messageId,
        raw: mbox,
        subject,
        to,
    };
}

export function parseMBoxMessageIDAndReferences(parsed: IParsedMBox): { messageID: string; references: string[] } {
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
    // eslint-disable-next-line security/detect-unsafe-regex
    const msgIdRegex = /^\s*<([^>]+)>(\s*|,)(\([^")]*("[^"]*")?\)\s*|\([^)]*\)$)?(<.*)?$/;
    for (const header of parsed.headers ?? []) {
        if (header.key.match(/In-Reply-To|References/i)) {
            let value: string = header.value.replace(/[\r\n]/g, " ");
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
        throw new Error(`No Message-ID found in ${parsed.raw}`);
    }
    const messageID = parsed.messageId.match(/^<(.*)>$/);
    if (!messageID) {
        throw new Error(`Unexpected Message-ID format: ${parsed.messageId}`);
    }
    return { messageID: messageID[1], references };
}

export async function sendMail(mail: IParsedMBox, smtpOptions: ISMTPOptions): Promise<string> {
    const transportOpts: SMTPTransport.Options = {
        auth: {
            pass: smtpOptions.smtpPass,
            user: smtpOptions.smtpUser,
        },
        host: smtpOptions.smtpHost,
        secure: true,
    };

    if (smtpOptions.smtpOpts) {
        // Add quoting for JSON.parse
        const smtpOpts = smtpOptions.smtpOpts.replace(/([ {])([a-zA-Z0-9.]+?) *?:/g, '$1"$2":');
        Object.assign(transportOpts, JSON.parse(smtpOpts));
    }

    return new Promise<string>((resolve, reject) => {
        const transporter = createTransport(transportOpts);

        // setup email data with unicode symbols
        const mailOptions: SendMailOptions = {
            envelope: {
                cc: mail.cc ? mail.cc.join(", ") : undefined,
                from: mail.from,
                to: mail.to,
            },
            raw: mail.raw,
        };

        transporter.sendMail(mailOptions, (error, info: { messageId: string }): void => {
            if (error) {
                reject(error);
            } else {
                resolve(info.messageId);
            }
        });
    });
}
