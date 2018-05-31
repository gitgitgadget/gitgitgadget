import { createTransport, SendMailOptions } from "nodemailer";

export function sendMail(to: string, cc: string | undefined,
                         subject: string, body: string,
                         smtpHost: string, smtpUser: string, smtpPass: string,
                         from?: string, date?: string, messageId?: string):
    Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const transporter = createTransport({
            auth: {
                pass: smtpPass,
                user: smtpUser,
            },
            host: smtpHost,
            secure: true,
        });

        // setup email data with unicode symbols
        const mailOptions: SendMailOptions = {
            date,
            from,
            subject,
            text: body,
            to,
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
