const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const gmailUser = process.env.SMTP_USER || process.env.EMAIL_USER || 'colaboratium@gmail.com';
const gmailPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s+/g, '');

function getImapClient() {
    if (!gmailPass) {
        throw new Error("No hay contraseña de aplicación configurada en SMTP_PASS");
    }
    return new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: {
            user: gmailUser,
            pass: gmailPass
        },
        logger: false
    });
}

function getNodemailerTransport() {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: gmailUser,
            pass: gmailPass
        }
    });
}

/**
 * Obtiene la lista de correos recientes del Inbox de Gmail
 */
async function getInboxEmails(limit = 35) {
    const client = getImapClient();
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
        const status = await client.status("INBOX", { messages: true, unseen: true });
        const total = status.messages || 0;
        const startSeq = Math.max(1, total - limit);

        const emailList = [];
        for await (const msg of client.fetch(`${startSeq}:*`, {
            envelope: true,
            flags: true
        })) {
            const env = msg.envelope;
            emailList.push({
                uid: msg.uid,
                seq: msg.seq,
                seen: msg.flags?.has("\\Seen"),
                date: env?.date || new Date(),
                subject: env?.subject || "(Sin Asunto)",
                from: env?.from?.[0]?.name
                    ? `${env.from[0].name} <${env.from[0].address}>`
                    : env?.from?.[0]?.address || "Desconocido",
                fromEmail: env?.from?.[0]?.address || "",
                fromName: env?.from?.[0]?.name || env?.from?.[0]?.address?.split('@')[0] || "",
                to: env?.to?.[0]?.address || "",
                messageId: env?.messageId || ""
            });
        }

        // Ordenar del más nuevo al más viejo
        emailList.reverse();

        return {
            success: true,
            stats: { total: status.messages, unseen: status.unseen },
            emails: emailList,
            account: gmailUser
        };
    } finally {
        lock.release();
        await client.logout();
    }
}

/**
 * Descarga y parsea el cuerpo completo de un correo por su UID
 */
async function getEmailBody(uid) {
    const client = getImapClient();
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
        const msg = await client.download(uid, undefined, { uid: true });
        if (!msg || !msg.content) {
            return { success: false, error: "Mensaje no encontrado" };
        }

        const parsed = await simpleParser(msg.content);

        return {
            success: true,
            email: {
                uid: Number(uid),
                subject: parsed.subject || "(Sin Asunto)",
                from: parsed.from?.text || "",
                fromEmail: parsed.from?.value?.[0]?.address || "",
                fromName: parsed.from?.value?.[0]?.name || "",
                to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(", ") : parsed.to.text) : "",
                date: parsed.date || new Date(),
                text: parsed.text || "",
                html: parsed.html || parsed.textAsHtml || "",
                messageId: parsed.messageId,
                attachmentsCount: parsed.attachments?.length || 0
            }
        };
    } finally {
        lock.release();
        await client.logout();
    }
}

/**
 * Envía una respuesta de correo desde Gmail SMTP
 */
async function sendReplyEmail({ to, subject, body, inReplyTo }) {
    const transporter = getNodemailerTransport();
    const mailOptions = {
        from: `"Colaboratium Oficial" <${gmailUser}>`,
        to,
        subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
        text: body,
        html: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${body}</div>`,
        headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : {}
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
}

module.exports = {
    getInboxEmails,
    getEmailBody,
    sendReplyEmail
};
