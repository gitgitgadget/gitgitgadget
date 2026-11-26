import { simpleParser, SimpleParserOptions } from "mailparser";
import { createTransport, SendMailOptions } from "nodemailer";
import addressparser from "nodemailer/lib/addressparser/index.js";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import rfc2047 from "rfc2047";

export interface IParsedMBox {
    body: string;
    cc?: string[];
    ccHeader?: string;
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

function createSMTPTransport(smtpOptions: ISMTPOptions) {
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

    return createTransport(transportOpts);
}

/** Validate static transport configuration before reserving a send attempt. */
export function validateSMTPOptions(smtpOptions: ISMTPOptions): void {
    createSMTPTransport(smtpOptions);
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
    let ccHeader: string | undefined;
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
                ccHeader = [ccHeader, value.replace(/\r?\n/g, " ").trim()].filter(Boolean).join(", ");
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
                subject = parsed.subject || value;
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
        ccHeader,
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
    return new Promise<string>((resolve, reject) => {
        const transporter = createSMTPTransport(smtpOptions);

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

/** Reply to a mirrored mailing-list message, keeping the list as To and copying its participants. */
export async function sendReplyMail(
    original: IParsedMBox,
    body: string,
    smtpOptions: ISMTPOptions,
    options: { author: string; from: string; list: string; messageID: string; sender: string },
): Promise<void> {
    if (!original.messageId) throw new Error("The original mail has no Message-ID");
    const listAddress = addressparser(options.list, { flatten: true })[0]?.address;
    if (!listAddress) throw new Error("Invalid mailing list recipient");
    const excluded = new Set([listAddress, options.from].map((address) => address.toLowerCase()));
    const participants = [original.from, original.to, original.ccHeader || original.cc?.join(", ")]
        .filter((address): address is string => !!address)
        .flatMap((header) => addressparser(header, { flatten: true }))
        .filter((address) => address.address && !excluded.has(address.address.toLowerCase()));
    const seen = new Set<string>();
    const cc = participants
        .filter(({ address }) => {
            const key = address.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(({ name, address }) => (name ? `"${name.replace(/["\\]/g, "\\$&")}" <${address}>` : address));
    const cleanHeader = (value: string): string =>
        value
            .split("")
            .map((character) => {
                const code = character.charCodeAt(0);
                return code < 0x20 || code === 0x7f ? " " : character;
            })
            .join("");
    const subject = cleanHeader(original.subject || "[PATCH]").trim();
    const fromName = cleanHeader(`${options.author} via ${options.sender}`).replace(/["\\]/g, " ");
    const messageID = original.messageId.replace(/^<|>$/g, "");
    const references = (original.headers || [])
        .filter(({ key }) => /^(In-Reply-To|References)$/i.test(key))
        .flatMap(({ value }) => value.match(/<[^>]+>/g) || []);
    references.push(`<${messageID}>`);
    const uniqueReferences = [...new Set(references)];
    const raw = [
        `From: "${fromName}" <${options.from}>`,
        `To: ${listAddress}`,
        ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
        `Subject: ${rfc2047.encode(/^re:/i.test(subject) ? subject : `Re: ${subject}`)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${options.messageID}>`,
        `In-Reply-To: <${messageID}>`,
        `References: ${uniqueReferences.join(" ")}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        body,
        "",
    ].join("\r\n");
    const mail = await parseMBox(raw);
    mail.from = options.from;
    mail.to = listAddress;
    mail.cc = cc;
    await sendMail(mail, smtpOptions);
}
