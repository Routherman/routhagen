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

const db = require('./database');

/**
 * Obtiene la lista de correos recientes del Inbox de Gmail y vincula datos de CRM de contactos
 */
async function getInboxEmails(limit = 35, codigoEmpresa = 'KRZMJI') {
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
                fromEmail: (env?.from?.[0]?.address || "").toLowerCase().trim(),
                fromName: env?.from?.[0]?.name || env?.from?.[0]?.address?.split('@')[0] || "",
                to: env?.to?.[0]?.address || "",
                messageId: env?.messageId || "",
                contact: null
            });
        }

        // Ordenar del más nuevo al más viejo
        emailList.reverse();

        // Cruzar con la base de datos de contactos para traer datos CRM (Juan Ramón Valle, Rol, Ticket, etc.)
        if (db && db.pool && emailList.length > 0) {
            try {
                const uniqueEmails = [...new Set(emailList.map(e => e.fromEmail).filter(Boolean))];
                if (uniqueEmails.length > 0) {
                    const [contactRows] = await db.pool.query(
                        "SELECT id, nombre, email, telefono, grupo, rol_asignado, metadata_extra FROM contactos WHERE LOWER(email) IN (?) AND codigo_empresa = ?",
                        [uniqueEmails, codigoEmpresa]
                    );

                    const contactMap = {};
                    (contactRows || []).forEach(c => {
                        if (c.email) contactMap[c.email.toLowerCase().trim()] = c;
                    });

                    emailList.forEach(em => {
                        const matched = contactMap[em.fromEmail];
                        if (matched) {
                            let meta = matched.metadata_extra;
                            if (typeof meta === 'string') {
                                try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                            }
                            em.contact = {
                                id: matched.id,
                                nombre: matched.nombre,
                                email: matched.email,
                                telefono: matched.telefono,
                                grupo: matched.grupo || 'ASESORES',
                                rol_asignado: matched.rol_asignado || 'General',
                                metadata_extra: meta
                            };
                            // Si en la base de datos está registrado su nombre real, mostrarlo con prioridad
                            if (matched.nombre && matched.nombre.trim().length > 1) {
                                em.fromName = matched.nombre;
                            }
                        }
                    });
                }
            } catch (errDB) {
                console.error("Error enriqueciendo correos con contactos DB:", errDB.message);
            }
        }

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

/**
 * Monitor Inteligente de Mails: Detecta respuestas de candidatos en Gmail,
 * agenda automáticamente su lugar en el webinar, genera tickets en Helpdesk,
 * envía el correo de confirmación con el link de Google Meet y suma las conversiones a la campaña.
 */
async function monitorAndProcessIncomingReplies(codigoEmpresa = 'KRZMJI') {
    const { processBooking, getAvailableWebinarSlots } = require('./googleCalendarService');
    const db = require('./database');

    const results = {
        checked: 0,
        confirmed: 0,
        consultas: 0,
        tickets: []
    };

    try {
        const inboxData = await getInboxEmails(20, codigoEmpresa);
        if (!inboxData || !inboxData.emails || inboxData.emails.length === 0) {
            return { success: true, ...results, message: 'No hay correos recientes en la bandeja' };
        }

        for (const msg of inboxData.emails) {
            results.checked++;
            const fromEmail = (msg.fromEmail || '').toLowerCase().trim();
            const isSystemEmail = !fromEmail ||
                fromEmail.includes('colaboratium@gmail.com') ||
                fromEmail.includes('mailer-daemon') ||
                fromEmail.includes('noreply') ||
                fromEmail.includes('no-reply') ||
                fromEmail.includes('notification') ||
                fromEmail.includes('bounce') ||
                fromEmail.endsWith('@google.com') ||
                fromEmail.endsWith('@youtube.com') ||
                fromEmail.endsWith('@facebookmail.com');

            if (isSystemEmail) {
                continue;
            }

            const msgIdentifier = msg.messageId || `uid_${msg.uid}_${fromEmail}`;

            // 1. Verificar si ya fue procesado previamente
            if (db && db.pool) {
                const [procRows] = await db.pool.query(
                    "SELECT id FROM email_inbox_processed WHERE message_id = ? LIMIT 1",
                    [msgIdentifier]
                );
                if (procRows && procRows.length > 0) {
                    continue; // Ya procesado
                }
            }

            // 2. Descargar el cuerpo completo del correo
            let fullEmail = null;
            try {
                const bRes = await getEmailBody(msg.uid);
                if (bRes.success) fullEmail = bRes.email;
            } catch (errBody) {
                console.warn(`No se pudo descargar cuerpo para UID ${msg.uid}:`, errBody.message);
            }

            const subject = (msg.subject || fullEmail?.subject || '').trim();
            const textContent = (fullEmail?.text || fullEmail?.html?.replace(/<[^>]*>?/gm, '') || '').trim();
            const combinedText = `${subject} ${textContent}`.toLowerCase();

            // 3. Buscar datos del contacto en el CRM
            let contact = msg.contact;
            if (!contact && db && db.pool) {
                const [cRows] = await db.pool.query(
                    "SELECT id, nombre, email, telefono, grupo, rol_asignado FROM contactos WHERE LOWER(email) = ? AND codigo_empresa = ? LIMIT 1",
                    [fromEmail, codigoEmpresa]
                );
                if (cRows && cRows.length > 0) contact = cRows[0];
            }

            const customerName = contact?.nombre || msg.fromName || fromEmail.split('@')[0] || 'Candidato Asesor';
            const customerPhone = contact?.telefono || '';

            // 4. Analizar si es una confirmación de asistencia o consulta de webinar
            const isAffirmative = /confirm|asist|reserv|lugar|quiero|anot|opcion|opción|martes|mi[eé]rcoles|jueves|viernes|\bs[ií]\b/i.test(combinedText);
            const isWebinarContext = /webinar|capacitaci[oó]n|reuni[oó]n|asesor|encuentro|meet|horario|cu[aá]ndo/i.test(combinedText);

            if (isAffirmative || isWebinarContext) {
                // Determinar el turno elegido
                let slotChoice = 'slot_1';
                if (/opci[oó]n\s*2|16:15|4:15|tarde/i.test(combinedText)) {
                    slotChoice = 'slot_2';
                } else if (/opci[oó]n\s*3|mi[eé]rcoles/i.test(combinedText)) {
                    slotChoice = 'slot_3';
                } else if (/opci[oó]n\s*4|l[ií]der/i.test(combinedText)) {
                    slotChoice = 'slot_4';
                }

                console.log(`\n📬 [EMAIL MONITOR] Procesando respuesta de ${customerName} (${fromEmail}) -> Slot: ${slotChoice}...`);

                // Ejecutar inscripción automática y despacho de confirmación con Google Meet
                let bookingResult = null;
                try {
                    bookingResult = await processBooking({
                        slotChoice,
                        customerName,
                        customerEmail: fromEmail,
                        customerPhone,
                        codigoEmpresa,
                        category: 'asesores'
                    });
                } catch (bErr) {
                    console.error("Error en processBooking para email monitor:", bErr.message);
                }

                const ticketId = bookingResult?.ticketId || null;
                results.confirmed++;
                if (ticketId) results.tickets.push(ticketId);

                // 5. Incrementar conversiones en la campaña de email más reciente
                if (db && db.pool) {
                    try {
                        await db.pool.query(
                            "UPDATE campanas SET conversiones = COALESCE(conversiones, 0) + 1, respondidos = COALESCE(respondidos, 0) + 1 WHERE codigo_empresa = ? AND (tipo = 'email' OR plantilla_id IS NOT NULL) ORDER BY id DESC LIMIT 1",
                            [codigoEmpresa]
                        );
                        console.log(`📈 [CAMPAIGN] Conversión incrementada con éxito para ${customerName}.`);
                    } catch (cErr) {
                        console.warn("No se pudo actualizar contador de conversiones de campaña:", cErr.message);
                    }

                    // Registrar mensaje procesado
                    try {
                        await db.pool.query(
                            "INSERT INTO email_inbox_processed (message_id, from_email, subject, intent, ticket_id) VALUES (?, ?, ?, 'CONFIRMACION_WEBINAR', ?)",
                            [msgIdentifier, fromEmail, subject, ticketId]
                        );
                    } catch (e) {}
                }
            } else {
                // Si es otro tipo de correo entrante de un contacto de la empresa, registrar ticket en helpdesk
                if (db && db.pool && contact) {
                    try {
                        const ticketId = await db.crearTicket(
                            codigoEmpresa,
                            contact.id,
                            customerPhone || fromEmail,
                            customerName,
                            'open',
                            `Consulta por Correo de ${customerName}: ${subject} - "${textContent.substring(0, 140)}..."`,
                            null,
                            'Soporte'
                        );
                        results.consultas++;
                        results.tickets.push(ticketId);

                        await db.pool.query(
                            "INSERT INTO email_inbox_processed (message_id, from_email, subject, intent, ticket_id) VALUES (?, ?, ?, 'CONSULTA_GENERAL', ?)",
                            [msgIdentifier, fromEmail, subject, ticketId]
                        );
                    } catch (e) {}
                }
            }
        }

        return { success: true, ...results };
    } catch (error) {
        console.error("Error en monitorAndProcessIncomingReplies:", error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    getInboxEmails,
    getEmailBody,
    sendReplyEmail,
    monitorAndProcessIncomingReplies
};
