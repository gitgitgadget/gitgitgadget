import { createTransport, SendMailOptions } from "nodemailer";

export interface IParsedMBox {
    body: string;
    cc?: string[];
    date?: string;
    from: string;
    headers?: Array<{ key: string; value: string; }>;
    messageId?: string;
    subject: string;
    to: string;
}

export interface ISMTPOptions {
    smtpUser: string;
    smtpHost: string;
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
export async function parseMBox(mbox: string): Promise<IParsedMBox> {
    const headerEnd = mbox.indexOf("\n\n");
    if (headerEnd < 0) {
        throw new Error(`Could not parse mail`);
    }
    const headerStart = mbox.startsWith("From ") ? mbox.indexOf("\n") + 1 : 0;

    const header = mbox.substr(headerStart, headerEnd - headerStart);
    const body = mbox.substr(headerEnd + 2);

    let cc: string[] | undefined;
    let date: string | undefined;
    let from: string | undefined;
    const headers = new Array<{ key: string, value: string }>();
    let messageId: string | undefined;
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
            case "cc": cc = value.split(", "); break;
            case "date": date = value; break;
            case "fcc": break;
            case "from": from = value; break;
            case "message-id": messageId = value; break;
            case "subject": subject = value; break;
            case "to": to = value; break;
            default:
                headers.push({ key, value });
        }
    }

    if (!to || !subject || !from) {
        throw new Error(`Missing To, Subject and/or From header:\n${header}`);
    }

    return {
        body,
        cc,
        date,
        from,
        headers,
        messageId,
        subject,
        to,
    };
}

export async function sendMail(mail: IParsedMBox,
                               smtpOptions: ISMTPOptions):
    Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const transporter = createTransport({
            auth: {
                pass: smtpOptions.smtpPass,
                user: smtpOptions.smtpUser,
            },
            host: smtpOptions.smtpHost,
            secure: true,
        });

        // setup email data with unicode symbols
        const mailOptions: SendMailOptions = {
            cc: mail.cc || [],
            date: mail.date,
            from: mail.from,
            headers: mail.headers,
            messageId: mail.messageId,
            subject: mail.subject,
            text: mail.body,
            to: mail.to,
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
