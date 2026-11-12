const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const emailService = require('./emailService');

let isMonitoringReplies = false;

function getAvailableInboxAccounts() {
    return emailService.getPublicEmailAccounts();
}

function getImapClient(accountIdOrEmail = null) {
    const resolved = emailService.resolveEmailAccount(accountIdOrEmail);
    const imapCfg = resolved?.imap || {
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: parseInt(process.env.IMAP_PORT || '993', 10),
        secure: process.env.IMAP_SECURE !== undefined ? (process.env.IMAP_SECURE === 'true') : true,
        user: process.env.IMAP_USER || process.env.GMAIL_IMAP_USER || process.env.EMAIL_FROM || 'colaboratium@gmail.com',
        pass: String(process.env.IMAP_PASS || process.env.GMAIL_IMAP_PASS || '').replace(/\s+/g, '')
    };

    if (!imapCfg.pass) {
        throw new Error(`No hay contraseña IMAP configurada para ${imapCfg.user}`);
    }
    const client = new ImapFlow({
        host: imapCfg.host,
        port: imapCfg.port,
        secure: imapCfg.secure,
        auth: {
            user: imapCfg.user,
            pass: imapCfg.pass
        },
        connectionTimeout: 9000,
        greetingTimeout: 7000,
        socketTimeout: 10000,
        logger: false
    });

    // Capturar evento 'error' en ImapFlow para evitar crash por ECONNRESET/ETIMEDOUT de Gmail o mail corporativo
    client.on('error', (err) => {
        console.warn(`[ImapFlow Warning] (${imapCfg.user}) Evento de error en socket IMAP (${err.code || err.message}). Manejado de forma resiliente.`);
    });

    return { client, account: resolved };
}

function getNodemailerTransport(accountIdOrEmail = null) {
    return emailService.getTransporterForAccount(accountIdOrEmail);
}

const db = require('./database');

/**
 * Obtiene la lista de correos recientes de una o todas las casillas IMAP configuradas y vincula datos de CRM
 */
async function getSingleAccountInboxEmails(limit = 35, codigoEmpresa = 'KRZMJI', accountIdOrEmail = null) {
    const resolvedAcc = emailService.resolveEmailAccount(accountIdOrEmail);
    const activeEmail = resolvedAcc?.email || 'colaboratium@gmail.com';
    const availableAccounts = getAvailableInboxAccounts();
    let client = null;
    let lock = null;

    if (!resolvedAcc || !resolvedAcc.imap?.pass) {
        console.log(`[inboxService] Sin contraseña IMAP configurada para ${activeEmail}. Retornando inbox seguro.`);
        return {
            success: true,
            stats: { total: 0, unseen: 0 },
            emails: [],
            account: activeEmail,
            accountLabel: resolvedAcc?.label || activeEmail,
            accounts: availableAccounts,
            warning: `Bandeja IMAP de ${activeEmail} no configurada o desconectada temporalmente.`
        };
    }

    try {
        const imapConn = getImapClient(resolvedAcc.email);
        client = imapConn.client;
        await client.connect();
        lock = await client.getMailboxLock("INBOX");

        const status = await client.status("INBOX", { messages: true, unseen: true });
        const total = status.messages || 0;
        if (total === 0) {
            return {
                success: true,
                stats: { total: 0, unseen: status.unseen || 0 },
                emails: [],
                account: activeEmail,
                accountLabel: resolvedAcc.label,
                accounts: availableAccounts
            };
        }
        const safeLimit = Math.max(1, Math.min(Number(limit) || 35, 80));
        const startSeq = Math.max(1, total - safeLimit + 1);

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
                to: env?.to?.[0]?.address || activeEmail,
                messageId: env?.messageId || "",
                account: activeEmail,
                accountLabel: resolvedAcc.label,
                contact: null
            });
        }

        // Ordenar del más nuevo al más viejo
        emailList.reverse();

        // Cruzar con la base de datos de contactos y prospectos B2B para traer datos CRM
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

                    const missingEmails = uniqueEmails.filter(e => !contactMap[e]);
                    const prospectMap = {};
                    if (missingEmails.length > 0) {
                        try {
                            const [pRows] = await db.pool.query(
                                "SELECT id, first_name, last_name, email, phone_e164, phone_raw, office_name, company_or_board, city, detected_role FROM b2b_prospects WHERE LOWER(email) IN (?) AND codigo_empresa = ?",
                                [missingEmails, codigoEmpresa]
                            );
                            (pRows || []).forEach(p => {
                                if (p.email) prospectMap[p.email.toLowerCase().trim()] = p;
                            });
                        } catch (pErr) {}
                    }

                    emailList.forEach(em => {
                        const matched = contactMap[em.fromEmail];
                        const prospect = !matched ? prospectMap[em.fromEmail] : null;
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
                            if (matched.nombre && matched.nombre.trim().length > 1) {
                                em.fromName = matched.nombre;
                            }
                        } else if (prospect) {
                            const fullName = `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || prospect.office_name || 'Prospecto B2B';
                            em.contact = {
                                id: `b2b_${prospect.id}`,
                                nombre: fullName,
                                email: prospect.email,
                                telefono: prospect.phone_e164 || prospect.phone_raw || '',
                                grupo: prospect.detected_role === 'LIDER_BROKER_POTENCIAL' ? 'B2B_LIDERES' : 'B2B_ASESORES',
                                rol_asignado: prospect.office_name || prospect.company_or_board || 'Prospecto B2B',
                                isB2B: true,
                                metadata_extra: {
                                    office_name: prospect.office_name,
                                    company_or_board: prospect.company_or_board,
                                    city: prospect.city
                                }
                            };
                            if (fullName.length > 1) {
                                em.fromName = fullName;
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
            account: activeEmail,
            accountLabel: resolvedAcc.label,
            accounts: availableAccounts
        };
    } catch (err) {
        console.warn(`[inboxService] Advertencia al leer IMAP de ${activeEmail}: ${err.message}`);
        return {
            success: true,
            stats: { total: 0, unseen: 0 },
            emails: [],
            account: activeEmail,
            accountLabel: resolvedAcc?.label || activeEmail,
            accounts: availableAccounts,
            warning: err.message
        };
    } finally {
        if (lock) {
            try { lock.release(); } catch (e) {}
        }
        if (client) {
            try {
                await Promise.race([
                    client.logout().catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 1200))
                ]);
            } catch (e) {}
            try { client.close(); } catch (e) {}
        }
    }
}

async function getInboxEmails(limit = 35, codigoEmpresa = 'KRZMJI', accountIdOrEmail = null) {
    const accounts = getAvailableInboxAccounts();
    const key = String(accountIdOrEmail || '').trim().toLowerCase();
    if (key === 'all' || key === 'todas') {
        const receiveAccounts = accounts.filter(a => a.canReceive);
        if (receiveAccounts.length === 0) {
            return { success: true, stats: { total: 0, unseen: 0 }, emails: [], account: 'all', accountLabel: 'Todas las casillas', accounts };
        }
        const perAccountLimit = Math.max(10, Math.min(25, Math.ceil((Number(limit) || 35) / receiveAccounts.length) + 8));
        const runAccountWithTimeout = (acc) => Promise.race([
            getSingleAccountInboxEmails(perAccountLimit, codigoEmpresa, acc.email),
            new Promise((resolve) => setTimeout(() => resolve({
                success: true,
                stats: { total: 0, unseen: 0 },
                emails: [],
                account: acc.email,
                accountLabel: acc.label || acc.email,
                accounts,
                warning: `Tiempo de espera agotado para ${acc.email}`
            }), 12000))
        ]);
        const settled = await Promise.allSettled(
            receiveAccounts.map(acc => runAccountWithTimeout(acc))
        );
        const mergedEmails = [];
        let total = 0;
        let unseen = 0;
        const warnings = [];
        for (const item of settled) {
            if (item.status === 'fulfilled' && item.value) {
                total += Number(item.value.stats?.total || 0);
                unseen += Number(item.value.stats?.unseen || 0);
                if (Array.isArray(item.value.emails)) {
                    mergedEmails.push(...item.value.emails);
                }
                if (item.value.warning) warnings.push(item.value.warning);
            } else if (item.status === 'rejected') {
                warnings.push(item.reason?.message || 'Error leyendo casilla');
            }
        }
        mergedEmails.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return {
            success: true,
            stats: { total, unseen },
            emails: mergedEmails.slice(0, Number(limit) || 40),
            account: 'all',
            accountLabel: 'Todas las casillas',
            accounts,
            ...(warnings.length ? { warning: warnings.join(' | ') } : {})
        };
    }

    return getSingleAccountInboxEmails(limit, codigoEmpresa, accountIdOrEmail);
}

/**
 * Descarga y parsea el cuerpo completo de un correo por su UID y casilla
 */
async function getEmailBody(uid, accountIdOrEmail = null) {
    let client = null;
    let lock = null;
    let resolvedAcc = null;

    try {
        const imapConn = getImapClient(accountIdOrEmail);
        client = imapConn.client;
        resolvedAcc = imapConn.account;
        await client.connect();
        lock = await client.getMailboxLock("INBOX");

        const msg = await client.download(uid, undefined, { uid: true });
        if (!msg || !msg.content) {
            return { success: false, error: "Mensaje no encontrado" };
        }

        const parsed = await simpleParser(msg.content);

        return {
            success: true,
            email: {
                uid: Number(uid),
                account: resolvedAcc?.email || null,
                accountLabel: resolvedAcc?.label || null,
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
        if (lock) {
            try { lock.release(); } catch (e) {}
        }
        if (client) {
            try {
                await Promise.race([
                    client.logout().catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 1200))
                ]);
            } catch (e) {}
            try { client.close(); } catch (e) {}
        }
    }
}

/**
 * Envía una respuesta de correo vía SMTP usando la casilla seleccionada
 */
async function sendReplyEmail({ to, subject, body, inReplyTo, account = null }) {
    const resolvedAcc = emailService.resolveEmailAccount(account);
    const cfg = emailService.getEmailConfig();
    const transporter = resolvedAcc
        ? getNodemailerTransport(resolvedAcc.email)
        : getNodemailerTransport();
    const fromEmail = resolvedAcc?.email || cfg.fromEmail;
    const fromName = resolvedAcc?.fromName || cfg.fromName;
    const replyTo = resolvedAcc?.replyTo || fromEmail || cfg.replyToEmail;
    const safeSubject = String(subject || '(Sin Asunto)').trim();

    const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to,
        replyTo,
        subject: safeSubject.startsWith("Re:") ? safeSubject : `Re: ${safeSubject}`,
        text: body,
        html: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${body}</div>`,
        headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : {}
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId, fromEmail };
}

function isIgnoredSystemEmail(fromEmail = '', subject = '') {
    const email = String(fromEmail || '').toLowerCase().trim();
    const subj = String(subject || '').toLowerCase().trim();
    if (!email) return true;

    const ignoredSenderPatterns = [
        'colaboratium@gmail.com',
        'asesores@colaboratium.com.ar',
        'mkt@colaboratium.com.ar',
        'cpanel@',
        'root@',
        'cron@',
        'whm@',
        'daemon@',
        'mailer-daemon',
        'postmaster@',
        'noreply',
        'no-reply',
        'donotreply',
        'do-not-reply',
        'notification',
        'bounce',
        'alert@',
        'alerts@',
        'security@',
        '@google.com',
        '@accounts.google.com',
        '@youtube.com',
        '@facebookmail.com',
        'brevo.com',
        't.brevo.com',
        'brevosend.com',
        'sendinblue.com',
        'mercadopago.com',
        'mercadolibre.',
        'hubspotemail.net',
        'fathom.video',
        'accounts.dev',
        'computrabajo.com',
        'payulatam.com',
        'googleapis.com',
        'vercel.com'
    ];
    if (ignoredSenderPatterns.some(p => email.includes(p))) {
        return true;
    }

    const ignoredSubjectPatterns = [
        'delivery status notification',
        'mail delivery subsystem',
        'undeliverable',
        'undelivered mail',
        'address not found',
        'no se pudo entregar',
        'message blocked',
        'código de verificación',
        'codigo de verificacion',
        'verificación de inicio',
        'critical security alert',
        'alerta de seguridad',
        'nuevo asesor inscripto',
        'nuevo inscripto',
        'nuevo líder de equipo',
        'nuevo inversor registrado',
        'automatic reply',
        'respuesta automática',
        'respuesta automatica',
        'out of office',
        'fuera de la oficina',
        '[colaboratium.com.ar]',
        'autossl',
        'disk usage',
        'cpanel'
    ];
    return ignoredSubjectPatterns.some(p => subj.includes(p));
}

function stripQuotedReply(rawText = '') {
    const normalized = String(rawText || '').replace(/\r\n/g, '\n');
    const quoteDelimiters = [
        /\n\s*El\s+(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom|\d{1,2})[\s\S]*?escribi[oó]:\s*\n/i,
        /\n\s*On\s+[\s\S]{5,120}\s+wrote:\s*\n/i,
        /\n\s*-{3,}\s*(?:Original Message|Mensaje original|Forwarded message|Mensaje reenviado)\s*-{3,}/i,
        /\n\s*De:\s+.+\n\s*(?:Enviado|Fecha|Date|Para|To):/i,
        /\n\s*From:\s+.+\n\s*(?:Sent|Date|To):/i
    ];

    let head = normalized;
    for (const rx of quoteDelimiters) {
        const idx = head.search(rx);
        if (idx !== -1) {
            head = head.slice(0, idx);
        }
    }

    const cleanLines = head
        .split('\n')
        .filter(line => !line.trimStart().startsWith('>'));

    return cleanLines.join('\n').trim();
}

function isOptOutReply(replyText = '') {
    const text = String(replyText || '').trim().toLowerCase();
    if (!text) return false;
    return /(?:^|\s|\n)baja(?:\s|[.!?,]|$)|dar(?:me)? de baja|no me escriban|no contactar|desuscrib|unsubscribe|remover de la lista|sacar de la lista/i.test(text);
}

async function findContactOrProspect(dbPool, fromEmail, codigoEmpresa) {
    if (!dbPool || !fromEmail) return null;
    const cleanEmail = fromEmail.toLowerCase().trim();

    const [cRows] = await dbPool.query(
        "SELECT id, nombre, email, telefono, grupo, rol_asignado FROM contactos WHERE LOWER(email) = ? AND codigo_empresa = ? LIMIT 1",
        [cleanEmail, codigoEmpresa]
    );
    if (cRows && cRows.length > 0) {
        return { ...cRows[0], source: 'contactos' };
    }

    try {
        const [pRows] = await dbPool.query(
            "SELECT id, first_name, last_name, email, phone_e164, phone_raw, office_name, company_or_board, city, detected_role, campaign_status FROM b2b_prospects WHERE LOWER(email) = ? AND codigo_empresa = ? ORDER BY opt_out_at IS NULL DESC LIMIT 1",
            [cleanEmail, codigoEmpresa]
        );
        if (pRows && pRows.length > 0) {
            const p = pRows[0];
            return {
                id: `b2b_${p.id}`,
                b2bId: p.id,
                nombre: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.office_name || 'Prospecto B2B',
                email: p.email,
                telefono: p.phone_e164 || p.phone_raw || '',
                grupo: p.detected_role === 'LIDER_BROKER_POTENCIAL' ? 'B2B_LIDERES' : 'B2B_ASESORES',
                rol_asignado: p.office_name || p.company_or_board || 'Prospecto B2B',
                source: 'b2b_prospects'
            };
        }
    } catch (e) {}

    return null;
}

async function claimInboxMessage(dbPool, { messageId, fromEmail, subject, intent }) {
    if (!dbPool) return true;
    const [res] = await dbPool.query(
        "INSERT IGNORE INTO email_inbox_processed (message_id, from_email, subject, intent, ticket_id) VALUES (?, ?, ?, ?, NULL)",
        [String(messageId).slice(0, 255), String(fromEmail).slice(0, 150), String(subject || '').slice(0, 255), String(intent || 'PROCESSING').slice(0, 50)]
    );
    return (res?.affectedRows || 0) > 0;
}

/**
 * Monitor Inteligente de Mails: Detecta respuestas reales de candidatos en Gmail/IMAP,
 * filtra sistemas/rebotes/citas anteriores, agenda lugar en webinar cuando corresponde,
 * notifica también por WhatsApp si hay teléfono registrado y suma conversiones reales.
 */
async function monitorAndProcessIncomingReplies(codigoEmpresa = 'KRZMJI', deps = {}) {
    if (isMonitoringReplies && !deps.bypassMutex) {
        return { success: true, checked: 0, confirmed: 0, consultas: 0, optOuts: 0, whatsappSent: 0, tickets: [], skippedConcurrent: true };
    }
    isMonitoringReplies = true;

    const gcal = deps.googleCalendarService || require('./googleCalendarService');
    const processBooking = deps.processBooking || gcal.processBooking;
    const activeDb = deps.db || db;
    const fetchInbox = deps.getInboxEmails || getInboxEmails;
    const fetchBody = deps.getEmailBody || getEmailBody;
    const wasender = deps.wasenderService || require('./wasenderService');

    const results = {
        checked: 0,
        ignoredSystem: 0,
        optOuts: 0,
        confirmed: 0,
        consultas: 0,
        whatsappSent: 0,
        tickets: []
    };

    try {
        const useInjectedFetcher = typeof deps.getInboxEmails === 'function';
        const targetAccounts = useInjectedFetcher
            ? [{ email: null }]
            : getAvailableInboxAccounts().filter(a => a.canReceive);

        const aggregatedEmails = [];
        for (const acc of targetAccounts) {
            const inboxData = useInjectedFetcher
                ? await fetchInbox(20, codigoEmpresa)
                : await fetchInbox(20, codigoEmpresa, acc.email);
            if (inboxData && Array.isArray(inboxData.emails)) {
                for (const em of inboxData.emails) {
                    aggregatedEmails.push({
                        ...em,
                        _mailboxAccount: em.account || acc.email || null
                    });
                }
            }
        }

        if (aggregatedEmails.length === 0) {
            return { success: true, ...results, message: 'No hay correos recientes en las bandejas' };
        }

        for (const msg of aggregatedEmails) {
            results.checked++;
            const fromEmail = (msg.fromEmail || '').toLowerCase().trim();
            const preliminarySubject = (msg.subject || '').trim();

            if (isIgnoredSystemEmail(fromEmail, preliminarySubject)) {
                results.ignoredSystem++;
                continue;
            }

            const mailboxScope = msg._mailboxAccount ? `${msg._mailboxAccount}_` : '';
            const msgIdentifier = msg.messageId || `uid_${mailboxScope}${msg.uid}_${fromEmail}`;

            // 1. Verificar / reclamar atómicamente antes de descargar cuerpo o procesar
            if (activeDb && activeDb.pool) {
                const [procRows] = await activeDb.pool.query(
                    "SELECT id FROM email_inbox_processed WHERE message_id = ? LIMIT 1",
                    [msgIdentifier]
                );
                if (procRows && procRows.length > 0) {
                    continue;
                }
            }

            // 2. Descargar el cuerpo completo del correo
            let fullEmail = msg.fullEmail || null;
            if (!fullEmail) {
                try {
                    const bRes = useInjectedFetcher
                        ? await fetchBody(msg.uid)
                        : await fetchBody(msg.uid, msg._mailboxAccount);
                    if (bRes && bRes.success) fullEmail = bRes.email;
                } catch (errBody) {
                    console.warn(`No se pudo descargar cuerpo para UID ${msg.uid}:`, errBody.message);
                }
            }

            const subject = (msg.subject || fullEmail?.subject || '').trim();
            if (isIgnoredSystemEmail(fromEmail, subject)) {
                results.ignoredSystem++;
                continue;
            }

            const rawText = (fullEmail?.text || fullEmail?.html?.replace(/<[^>]*>?/gm, ' ') || msg.snippet || '').trim();
            const strippedReply = stripQuotedReply(rawText);
            const replyOrSnippet = strippedReply || rawText.slice(0, 200);

            // Reclamo atómico anti-duplicado antes de efectos secundarios (tickets/emails/WA)
            if (activeDb && activeDb.pool) {
                const claimed = await claimInboxMessage(activeDb.pool, {
                    messageId: msgIdentifier,
                    fromEmail,
                    subject,
                    intent: 'PROCESSING'
                });
                if (!claimed) {
                    continue;
                }
            }

            // 3. Buscar datos del contacto en CRM o en b2b_prospects (para traer teléfono y nombre)
            let contact = msg.contact || null;
            if ((!contact || !contact.telefono) && activeDb && activeDb.pool) {
                const dbMatch = await findContactOrProspect(activeDb.pool, fromEmail, codigoEmpresa);
                if (dbMatch) contact = dbMatch;
            }

            const customerName = contact?.nombre || msg.fromName || fromEmail.split('@')[0] || 'Candidato Asesor';
            const customerPhone = contact?.telefono || '';

            // 4. Manejar solicitudes explícitas de BAJA / desuscripción antes de clasificar webinars
            if (isOptOutReply(replyOrSnippet)) {
                results.optOuts++;
                try {
                    if (activeDb && activeDb.registrarDesuscripcion) {
                        await activeDb.registrarDesuscripcion(codigoEmpresa, fromEmail, 'Respuesta BAJA vía email');
                    }
                    if (activeDb && activeDb.pool) {
                        await activeDb.pool.query(
                            "UPDATE b2b_prospects SET campaign_status = 'OPT_OUT_BAJA', opt_out_at = COALESCE(opt_out_at, NOW()) WHERE LOWER(email) = ? AND codigo_empresa = ?",
                            [fromEmail, codigoEmpresa]
                        );
                        await activeDb.pool.query(
                            "UPDATE email_inbox_processed SET intent = 'BAJA_OPT_OUT' WHERE message_id = ?",
                            [msgIdentifier]
                        );
                    }
                } catch (optErr) {
                    console.warn("Error registrando BAJA por correo:", optErr.message);
                }
                continue;
            }

            // 5. Analizar intención SOLO sobre lo que escribió el remitente (sin texto citado anterior)
            const subjectAction = subject.replace(/^(?:re|fwd|fw|rv):\s*/i, '').trim();
            const replyLower = replyOrSnippet.toLowerCase();
            const isExplicitNegative = /\bno\s+(?:puedo|quiero|voy|asist|me\s+interesa|gracias)\b|\bno\s+estoy\s+interesad/i.test(replyLower);
            const isShortAmbiguous = replyOrSnippet.replace(/[?¿!.,\s]/g, '').length < 2;

            const isAffirmative = !isExplicitNegative && !isShortAmbiguous && (
                /confirm|asist|reserv|lugar|quiero|anot|sumo|me interesa|opci[oó]n\s*[1-4]|martes|mi[eé]rcoles|jueves|viernes|\bs[ií]\b|dale|ok\b/i.test(replyLower) ||
                /confirm|asist|reserv|opci[oó]n\s*[1-4]/i.test(subjectAction)
            );
            const isWebinarContext = !isExplicitNegative && !isShortAmbiguous && (
                /webinar|capacitaci[oó]n|reuni[oó]n|encuentro|meet|horario|cu[aá]ndo|link\b|enlace/i.test(replyLower)
            );

            if (isAffirmative || isWebinarContext) {
                const combinedForSlot = `${subjectAction} ${replyOrSnippet}`;
                let slotChoice = 'slot_1';
                if (/opci[oó]n\s*2|16:15|4:15|19:00|tarde/i.test(combinedForSlot)) {
                    slotChoice = 'slot_2';
                } else if (/opci[oó]n\s*3|mi[eé]rcoles|lunes\s*16\/11.*12:00/i.test(combinedForSlot)) {
                    slotChoice = 'slot_3';
                } else if (/opci[oó]n\s*4|l[ií]der|lunes\s*16\/11.*19:00/i.test(combinedForSlot)) {
                    slotChoice = 'slot_4';
                }

                console.log(`\n📬 [EMAIL MONITOR] Procesando respuesta de ${customerName} (${fromEmail}) -> Slot: ${slotChoice}...`);

                let bookingResult = null;
                try {
                    bookingResult = await processBooking({
                        slotChoice,
                        customerName,
                        customerEmail: fromEmail,
                        customerPhone,
                        codigoEmpresa,
                        category: contact?.grupo === 'B2B_LIDERES' ? 'lideres' : 'asesores',
                        canal: 'email'
                    });
                } catch (bErr) {
                    console.error("Error en processBooking para email monitor:", bErr.message);
                }

                const ticketId = bookingResult?.ticketId || null;
                results.confirmed++;
                if (ticketId) results.tickets.push(ticketId);

                // Enviar confirmación también por WhatsApp si el prospecto tiene teléfono
                if (customerPhone && bookingResult?.whatsappResponse && wasender && typeof wasender.sendMessage === 'function') {
                    try {
                        const waRes = await wasender.sendMessage(customerPhone, bookingResult.whatsappResponse, codigoEmpresa, { isBotReply: true, forceSend: true });
                        if (waRes && waRes.success !== false) {
                            results.whatsappSent++;
                        }
                    } catch (waErr) {
                        console.warn(`⚠️ No se pudo notificar por WhatsApp a ${customerPhone}:`, waErr.message);
                    }
                }

                if (activeDb && activeDb.pool) {
                    try {
                        await activeDb.pool.query(
                            "UPDATE campanas SET conversiones = COALESCE(conversiones, 0) + 1, respondidos = COALESCE(respondidos, 0) + 1 WHERE codigo_empresa = ? AND (tipo = 'email' OR plantilla_id IS NOT NULL) ORDER BY id DESC LIMIT 1",
                            [codigoEmpresa]
                        );
                    } catch (cErr) {
                        console.warn("No se pudo actualizar contador de conversiones de campaña:", cErr.message);
                    }

                    try {
                        await activeDb.pool.query(
                            "UPDATE b2b_prospects SET campaign_status = 'REGISTRADO_WEBINAR', last_contacted_at = NOW() WHERE LOWER(email) = ? AND codigo_empresa = ?",
                            [fromEmail, codigoEmpresa]
                        );
                    } catch (pErr) {}

                    try {
                        await activeDb.pool.query(
                            "UPDATE email_inbox_processed SET intent = 'CONFIRMACION_WEBINAR', ticket_id = ? WHERE message_id = ?",
                            [ticketId, msgIdentifier]
                        );
                    } catch (e) {}
                }
            } else if (activeDb && activeDb.pool) {
                try {
                    const ticketId = await activeDb.crearTicket(
                        codigoEmpresa,
                        typeof contact?.id === 'number' ? contact.id : null,
                        customerPhone || fromEmail,
                        customerName,
                        'open',
                        `Consulta por Correo de ${customerName}: ${subject} - "${replyOrSnippet.substring(0, 140)}"`,
                        null,
                        'Soporte'
                    );
                    results.consultas++;
                    if (ticketId) results.tickets.push(ticketId);

                    await activeDb.pool.query(
                        "UPDATE campanas SET respondidos = COALESCE(respondidos, 0) + 1 WHERE codigo_empresa = ? AND (tipo = 'email' OR plantilla_id IS NOT NULL) ORDER BY id DESC LIMIT 1",
                        [codigoEmpresa]
                    );
                    if (contact?.source === 'b2b_prospects') {
                        await activeDb.pool.query(
                            "UPDATE b2b_prospects SET campaign_status = 'RESPONDIO_INTERESADO', last_contacted_at = NOW() WHERE LOWER(email) = ? AND codigo_empresa = ? AND campaign_status NOT IN ('OPT_OUT_BAJA', 'CONVERTIDO_ASESOR', 'CONVERTIDO_CRM')",
                            [fromEmail, codigoEmpresa]
                        );
                    }
                    await activeDb.pool.query(
                        "UPDATE email_inbox_processed SET intent = 'CONSULTA_GENERAL', ticket_id = ? WHERE message_id = ?",
                        [ticketId, msgIdentifier]
                    );
                } catch (e) {
                    console.warn("Error registrando consulta general de correo:", e.message);
                }
            }
        }

        return { success: true, ...results };
    } catch (error) {
        console.error("Error en monitorAndProcessIncomingReplies:", error);
        return { success: false, error: error.message };
    } finally {
        isMonitoringReplies = false;
    }
}

module.exports = {
    getAvailableInboxAccounts,
    getInboxEmails,
    getEmailBody,
    sendReplyEmail,
    monitorAndProcessIncomingReplies,
    isIgnoredSystemEmail,
    stripQuotedReply,
    isOptOutReply
};
