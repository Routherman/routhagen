const axios = require('axios');
const db = require('./database');
const { processMessageWithAI } = require('./groqService');

/**
 * Servicio de Integración con WASender API (wasenderapi.com)
 * Línea asignada: WA_S***5239 (Teléfono +54 11 7825 5239, Sesión Colab)
 */
class WasenderService {
    constructor() {
        this.baseUrl = 'https://wasenderapi.com/api';
    }

    /**
     * Obtiene la configuración de WASender para una empresa
     */
    async getConfig(codigoEmpresa = 'KRZMJI') {
        if (!db.pool) {
            try { await db.initDB(); } catch(e) {}
        }
        const pool = db.pool;
        if (!pool) return null;
        try {
            const [rows] = await pool.query('SELECT cuentas_vinculadas FROM empresas WHERE codigo = ?', [codigoEmpresa]);
            let cv = rows[0]?.cuentas_vinculadas || {};
            if (typeof cv === 'string') {
                try { cv = JSON.parse(cv); } catch (e) { cv = {}; }
            }
            return cv.wasender || {
                session_name: 'Colab',
                phone_number: '+54 11 7825 5239',
                phone_last4: '5239',
                line_code: 'WA_S***5239',
                connected: true,
                block_outgoing: false
            };
        } catch (e) {
            console.error('Error obteniendo config de WASender:', e.message);
            return null;
        }
    }

    /**
     * Formatea el código visual de la línea: WA_S***XXXX
     */
    formatLineCode(phone) {
        const clean = (phone || '').replace(/\D/g, '');
        const last4 = clean.length >= 4 ? clean.slice(-4) : '5239';
        return `WA_S***${last4}`;
    }

    /**
     * Envío de mensaje vía WASender API
     * Regla de negocio: El bloqueo anti-spam solo restringe campañas masivas automáticas (isCampaign: true).
     * Envíos manuales desde el CRM, respuestas del Bot o individuales SIEMPRE están habilitados.
     */
    async sendMessage(to, text, codigoEmpresa = 'KRZMJI', options = {}) {
        const config = await this.getConfig(codigoEmpresa);
        const { isBotReply = false, forceSend = false, isCampaign = false } = options;

        // El bloqueo anti-spam solo restringe campañas masivas automáticas
        if (isCampaign && config?.block_outgoing && !forceSend) {
            console.warn(`🔒 [WASender ${config?.line_code || 'WA_S***5239'}] Campaña masiva pausada por regla anti-spam para ${to}`);
            return {
                success: false,
                blocked: true,
                message: `Campaña masiva pausada por regla anti-spam en la línea ${config?.line_code || 'WA_S***5239'}.`
            };
        }

        const apiKey = config?.api_key || process.env.WASENDER_API_KEY;
        const cleanTo = (to || '').replace(/\D/g, '');

        if (!apiKey || apiKey === 'wasender_live_token_globalloan') {
            console.log(`[WASender Simulado ${config?.line_code || 'WA_S***5239'}] Despachando a ${cleanTo}: "${text.substring(0, 60)}..."`);
            return {
                success: true,
                simulated: true,
                line: config?.line_code || 'WA_S***5239',
                to: cleanTo,
                text
            };
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/send-message`,
                { to: cleanTo, text },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                }
            );

            return {
                success: true,
                data: response.data,
                line: config?.line_code || 'WA_S***5239'
            };
        } catch (error) {
            console.error('Error enviando mensaje vía WASender:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                line: config?.line_code || 'WA_S***5239'
            };
        }
    }

    /**
     * Genera la respuesta del Bot para la línea WASender (Agentes RE/MAX y Pauta Redes)
     */
    async generateBotReply(cleanPhone, userText, contact, codigoEmpresa) {
        const textLower = (userText || '').toLowerCase().trim();

        // 0. Parsear metadatos actuales del contacto
        let meta = contact?.metadata_extra;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
        } else if (!meta) {
            meta = {};
        }

        // Helper para persistir metadatos
        const saveMeta = async (newFields) => {
            meta = { ...meta, ...newFields };
            try {
                if (contact?.id && db && db.pool) {
                    await db.pool.query(
                        'UPDATE contactos SET metadata_extra = ? WHERE id = ?',
                        [JSON.stringify(meta), contact.id]
                    );
                }
            } catch (err) {
                console.warn('[WASender] Error guardando metadata:', err.message);
            }
        };

        const emailMatch = userText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const slotChoiceMatch = userText.match(/\b([1-6])\b|opci[oó]n\s*([1-6])|slot_([1-6])/i);
        const detectedSlot = slotChoiceMatch ? (slotChoiceMatch[1] || slotChoiceMatch[2] || slotChoiceMatch[3]) : null;

        // 1. Detección de EMAIL (con o sin número de slot) -> PROCESAR RESERVA
        if (emailMatch) {
            try {
                const detectedEmail = emailMatch[0].toLowerCase().trim();
                const slotChoice = detectedSlot || meta.pending_slot_choice || '1';
                
                let detectedName = userText
                    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                    .replace(/\bopci[oó]n\s*[1-6]\b|\bslot_[1-6]\b|\b[1-6]\b/gi, '')
                    .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                    .replace(/[,\-;]/g, ' ')
                    .trim();
                if (!detectedName || detectedName.length < 2) {
                    detectedName = contact?.nombre && !contact.nombre.startsWith('Lead') ? contact.nombre : 'Asesor Candidato';
                }

                const { processBooking } = require('./googleCalendarService');
                const bookingRes = await processBooking({
                    slotChoice,
                    customerName: detectedName,
                    customerEmail: detectedEmail,
                    customerPhone: cleanPhone,
                    codigoEmpresa,
                    category: 'asesores',
                    canal: 'wasender'
                });

                await saveMeta({
                    pending_slot_choice: null,
                    awaiting_webinar_booking: false,
                    slot_id: bookingRes.chosenSlot?.id || slotChoice,
                    email_registrado: detectedEmail,
                    nombre_registrado: detectedName
                });

                if (bookingRes && bookingRes.whatsappResponse) {
                    return bookingRes.whatsappResponse;
                }
            } catch (bookErr) {
                console.warn('Error en processBooking de WASender:', bookErr.message);
            }
        }

        // 2. Si el usuario ya está esperando agendar webinar Y envía un número de opción (1 a 6) sin email:
        if (detectedSlot && (meta.awaiting_webinar_booking || /opci[oó]n|turno|slot/i.test(textLower) || meta.pending_slot_choice)) {
            try {
                const { getAvailableWebinarSlots } = require('./googleCalendarService');
                const slots = await getAvailableWebinarSlots(codigoEmpresa, 'asesores');
                const chosen = slots.find(s => s.id === parseInt(detectedSlot, 10)) || slots[0];

                await saveMeta({
                    pending_slot_choice: detectedSlot,
                    awaiting_webinar_booking: true
                });

                if (chosen.modalidad === 'PRESENCIAL') {
                    return `¡Excelente elección! 🏢 Reservaste tu lugar para la *${chosen.titulo}*:\n\n` +
                           `🗓️ *Fecha:* ${chosen.fechaStr}\n` +
                           `⏰ *Horario:* ${chosen.horarioStr}\n` +
                           `📍 *Lugar:* ${chosen.ubicacion}\n\n` +
                           `👉 Para emitir tu invitación formal y acreditación en recepción, por favor indícanos tu *Nombre completo* y tu *Correo electrónico* (ej. *Juan Pérez juan@gmail.com*):`;
                }

                return `¡Excelente elección! 📅 Reservaste tu lugar para el *${chosen.titulo}*:\n\n` +
                       `🗓️ *Fecha:* ${chosen.fechaStr}\n` +
                       `⏰ *Horario:* ${chosen.horarioStr}\n` +
                       `💻 *Modalidad:* Google Meet\n\n` +
                       `👉 Para emitir tu invitación formal y enviarte el link de acceso a Google Meet, por favor indícanos tu *Nombre completo* y tu *Correo electrónico* (ej. *Juan Pérez juan@gmail.com*):`;
            } catch (slotErr) {
                console.warn('Error procesando elección de slot en WASender:', slotErr.message);
            }
        }

        // 3. Saludos iniciales o reinicio de menú
        if (/^(hola|buenas|buen d[ií]a|buenas tardes|buenas noches|inicio|empezar|men[uú]|comenzar|\?)$/i.test(textLower) || textLower === 'hola') {
            await saveMeta({ awaiting_webinar_booking: false, pending_slot_choice: null });
            return `¡Hola! Gracias por comunicarte con la línea oficial de Global Loan S.A. — Colaboratium (Registro BCRA Nº 40.015).\n\n` +
                   `Si llegaste por un anuncio en redes sociales o formas parte de la red de agentes inmobiliarios (RE/MAX, Century 21 o independientes), desarrollamos un modelo exclusivo de *Comisiones de alto rendimiento* para monetizar operaciones inmobiliarias y calzar créditos puente en 48 hs.\n\n` +
                   `¿Cómo te gustaría continuar?\n` +
                   `1️⃣ Escribe *1* si eres Agente Inmobiliario y deseas conocer el programa de alianzas y próximas capacitaciones.\n` +
                   `2️⃣ Escribe *2* si viste una publicación sobre créditos / inversión.\n` +
                   `3️⃣ Escribe *humano* para coordinar con un asesor ejecutivo.`;
        }

        // 4. Opción 1: Agente Inmobiliario O consulta expresa de Webinar/Capacitación/Reunión
        const isOp1 = textLower === '1' || /agente|inmobiliari|re\/?max|century|c21|alianza|corredor/i.test(textLower);
        const isWebinarQuery = /webinar|virtual|capacitaci[oó]n|reuni[oó]n|fechas|horarios|turno|agendar|agendame/i.test(textLower);

        if (isOp1 || isWebinarQuery) {
            await saveMeta({ awaiting_webinar_booking: true });

            let calendarText = '';
            try {
                const { formatCalendarOptionsText } = require('./googleCalendarService');
                calendarText = await formatCalendarOptionsText(codigoEmpresa, 'asesores');
            } catch (calErr) {
                console.warn('Error obteniendo opciones de calendario para WASender:', calErr.message);
            }

            if (isOp1) {
                return `🤝 *Programa de Alianzas para Agentes Inmobiliarios (RE/MAX, C21 e Independientes)*\n\n` +
                       `Como agente o corredor podés monetizar las operaciones trabadas de tus clientes:\n` +
                       `• *Créditos Puente y Refacciones*: Calce ágil en 48 a 72 hs con garantía real o fiduciaria.\n` +
                       `• *Comisiones de alto rendimiento*: Cobro bancarizado al calce efectivo de cada operación.\n` +
                       `• *Seguridad BCRA*: Operación respaldada bajo Registro Oficial BCRA Nº 40.015 con Banco BIND y Coinag.\n\n` +
                       `📌 *Próximas Sesiones de Capacitación Virtual (Vía Google Meet):*\n\n` +
                       (calendarText || `• *Jueves 12 de Noviembre* — 12:00 hs o 19:00 hs (Google Meet)\n\n👉 Responde con tu *Opción*, *Nombre completo* y *Email* para agendarte.`);
            }

            return calendarText || `💻 *Webinar Virtual de Capacitación & Alianzas*\n\nNuestras próximas sesiones son:\n• *Jueves 12 de Noviembre* — 12:00 hs o 19:00 hs (Google Meet)\n\n👉 Responde con tu *Opción*, *Nombre completo* y *Email* para agendarte.`;
        }

        // 5. Opción 2: Créditos / Inversión
        if (textLower === '2' || /invers|cr[eé]dito|pr[eé]stamo|tasa|rendimiento/i.test(textLower)) {
            await saveMeta({ awaiting_webinar_booking: false });
            return `📈 *Colaboratium — Plataforma de Créditos e Inversión P2P*\n\n• *Para Inversores*: Rendimientos atractivos en dólares o pesos. 0% comisión para el inversor (el tomador paga el costo de la plataforma). Operación 100% bancarizada desde tu propia cuenta en Banco BIND / Coinag.\n• *Para Tomadores*: Créditos ágiles calzados en 48 hs con condiciones transparentes.\n• *Marco Regulatorio*: Registro Oficial BCRA Nº 40.015.\n\n¿Deseas recibir la propuesta informativa para *Inversores* o solicitar un *Crédito*? Responde con *Inversor* o *Crédito*.`;
        }

        // 6. Opción 3 o Humano
        if (textLower === '3' || /humano|asesor|representante|persona|hablar|llamar/i.test(textLower)) {
            try {
                if (db && db.crearTicket) {
                    await db.crearTicket(
                        codigoEmpresa,
                        contact?.id || null,
                        cleanPhone,
                        contact?.nombre || `Lead WA_S (${cleanPhone.slice(-4)})`,
                        'pending_auth',
                        `Solicitud de contacto humano en línea WASender: "${userText}"`,
                        null,
                        'Equipo Admisiones'
                    );
                }
            } catch (tErr) {
                console.warn('Error creando ticket derivación humano:', tErr.message);
            }
            return `👨‍💼 *Derivación a Asesor Ejecutivo*\n\nHemos registrado tu solicitud con alta prioridad en nuestro sistema de atención.\nUno de nuestros ejecutivos comerciales se pondrá en contacto contigo a la brevedad por este medio.\n\n¡Muchas gracias por comunicarte con Global Loan S.A. — Colaboratium!`;
        }

        // 7. Consultas generales asistidas por IA RAG
        try {
            if (typeof processMessageWithAI === 'function') {
                const aiPromptContext = {
                    codigo: codigoEmpresa,
                    nombre: 'Global Loan S.A. — Colaboratium',
                    systemPromptOverride: 'Eres el asistente virtual en la línea WA_S***5239 para Agentes RE/MAX y publicidad de redes de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015). Recuerda: NUNCA menciones porcentajes fijos de comisión; utiliza siempre el término "Comisiones de alto rendimiento". Enfatiza el calce en 48 hs, 0% costo al inversor, respaldo de Banco BIND y Coinag. Si preguntan por webinars o reuniones, indícales las opciones de fechas del calendario oficial y pídeles su número de opción, nombre completo y correo electrónico para agendarlos.'
                };
                const history = contact?.id ? await db.obtenerHistorialMensajes(contact.id, 6) : [];
                const aiReply = await processMessageWithAI(userText, history, aiPromptContext);
                if (aiReply && aiReply.length > 10 && !aiReply.includes('Lo siento, en este momento no puedo')) {
                    return aiReply.replace(/\[ROLE:.*?\]/ig, '').replace(/\[HANDOFF\]/g, '').trim();
                }
            }
        } catch (aiErr) {
            console.warn('[WASender AI] Error llamando a IA:', aiErr.message);
        }

        // Fallback al menú principal
        return `¡Hola! Gracias por comunicarte con Global Loan S.A. — Colaboratium (BCRA Nº 40.015).\n\n¿En qué podemos ayudarte?\n1️⃣ Escribe *1* si eres Agente Inmobiliario (RE/MAX, C21 o independiente).\n2️⃣ Escribe *2* para información sobre Inversiones o Créditos.\n3️⃣ Escribe *humano* para hablar con un asesor.`;
    }

    /**
     * Procesa los webhooks entrantes de WASender (wasenderapi.com)
     */
    async handleWebhook(payload, headers = {}, codigoEmpresa = 'KRZMJI') {
        if (!db.pool) {
            try { await db.initDB(); } catch(e) {}
        }
        const pool = db.pool;

        const event = String(payload?.event || payload?.type || 'messages.received').toLowerCase();
        console.log(`📥 [WASender Webhook] Evento recibido: ${event}`);

        const config = await this.getConfig(codigoEmpresa);
        const lineCode = config?.line_code || 'WA_S***5239';

        // 1. Filtrar eventos de sistema, recibos de lectura y presencia
        if (
            event.includes('receipt') || 
            event.includes('reaction') || 
            (event.includes('update') && !event.includes('upsert')) ||
            event.includes('chats.') ||
            event.includes('contacts.')
        ) {
            return { success: true, ignored: true, event };
        }

        // 2. Procesar mensajes entrantes (personal o grupos)
        const isMessageEvent = event.includes('message') || event.includes('upsert') || !!payload?.messages || !!payload?.data?.messages;
        if (isMessageEvent) {
            // Extraer objeto de mensaje soportando todos los formatos de WASender
            let msgObj = null;
            const rawMessages = payload?.data?.messages || payload?.messages;
            if (Array.isArray(rawMessages) && rawMessages.length > 0) {
                msgObj = rawMessages[0];
            } else if (rawMessages && typeof rawMessages === 'object') {
                msgObj = rawMessages;
            } else if (payload?.data && typeof payload.data === 'object' && (payload.data.key || payload.data.messageBody || payload.data.message)) {
                msgObj = payload.data;
            } else {
                msgObj = payload;
            }

            // Ignorar mensajes salientes propios (fromMe: true)
            const isFromMe = msgObj?.key?.fromMe === true || payload?.key?.fromMe === true || msgObj?.fromMe === true;
            if (isFromMe) {
                console.log(`ℹ️ [WASender ${lineCode}] Ignorando mensaje saliente propio (fromMe=true)`);
                return { success: true, ignored: true, reason: 'Mensaje saliente propio' };
            }

            // Desduplicación por message ID (WASender dispara messages.upsert, messages.received y messages-personal.received para el mismo mensaje)
            const msgId = msgObj?.key?.id || payload?.data?.key?.id || payload?.key?.id;
            if (msgId) {
                if (!this.processedMsgIds) {
                    this.processedMsgIds = new Map();
                }
                const now = Date.now();
                for (const [id, time] of this.processedMsgIds.entries()) {
                    if (now - time > 300000) this.processedMsgIds.delete(id);
                }
                if (this.processedMsgIds.has(msgId)) {
                    console.log(`ℹ️ [WASender ${lineCode}] Mensaje duplicado ya procesado (id: ${msgId})`);
                    return { success: true, ignored: true, reason: 'Mensaje duplicado ya procesado' };
                }
                this.processedMsgIds.set(msgId, now);
            }

            // Extraer remitente priorizando el número de teléfono limpio sobre el JID o LID
            let rawFrom = 
                msgObj?.key?.cleanedSenderPn ||
                msgObj?.key?.senderPn ||
                msgObj?.key?.remoteJid ||
                msgObj?.from ||
                msgObj?.sender ||
                msgObj?.participant ||
                payload?.from ||
                '';

            // Ignorar grupos o broadcasts
            if (
                rawFrom.includes('@g.us') || 
                msgObj?.key?.remoteJid?.includes('@g.us') || 
                rawFrom.includes('@broadcast') || 
                rawFrom.includes('status@broadcast')
            ) {
                return { success: true, ignored: true, reason: 'Grupo o estado ignorado' };
            }

            let from = String(rawFrom).replace(/@.*$/, '').replace(/\D/g, '');
            let text = (
                msgObj?.messageBody || 
                msgObj?.body || 
                msgObj?.text || 
                msgObj?.message?.conversation || 
                msgObj?.message?.extendedTextMessage?.text || 
                msgObj?.message?.imageMessage?.caption ||
                msgObj?.message?.videoMessage?.caption ||
                ''
            ).trim();

            if (!from || !text) {
                console.log(`⚠️ [WASender ${lineCode}] Evento sin remitente (${from}) o texto (${text})`);
                return { success: true, ignored: true, reason: 'Sin remitente o texto' };
            }

            console.log(`📱 [WASender ${lineCode}] Mensaje entrante de ${from}: "${text}"`);

            // 1. Registrar o actualizar contacto en CRM
            try {
                let cleanPhone = from;
                if (!cleanPhone.startsWith('549') && cleanPhone.startsWith('54')) {
                    cleanPhone = '549' + cleanPhone.slice(2);
                } else if (!cleanPhone.startsWith('549') && cleanPhone.startsWith('11')) {
                    cleanPhone = '549' + cleanPhone;
                }

                const [existing] = await pool.query(
                    'SELECT id, nombre, grupo, flujo_activo_id, nodo_actual_id FROM contactos WHERE (telefono = ? OR telefono = ?) AND codigo_empresa = ? LIMIT 1',
                    [cleanPhone, from, codigoEmpresa]
                );

                let contacto = null;
                let contactoId = null;

                if (existing && existing.length > 0) {
                    contacto = existing[0];
                    contactoId = contacto.id;
                    await pool.query(
                        'UPDATE contactos SET linea_wa = ?, canal = \'wasender\' WHERE id = ?',
                        [lineCode, contactoId]
                    );
                } else {
                    const [insContact] = await pool.query(`
                        INSERT INTO contactos (telefono, nombre, codigo_empresa, grupo, rol_asignado, estado_resolucion, metadata_extra, linea_wa, canal)
                        VALUES (?, ?, ?, 'PROSPECTO ASESORES', 'Asesores', 'PENDIENTE', ?, ?, 'wasender')
                    `, [
                        cleanPhone,
                        `Lead WA_S (${cleanPhone.slice(-4)})`,
                        codigoEmpresa,
                        JSON.stringify({ origen: 'WASENDER', canal_linea: lineCode, remax_ads: true }),
                        lineCode
                    ]);
                    contactoId = insContact.insertId;
                    contacto = { id: contactoId, telefono: cleanPhone, nombre: `Lead WA_S (${cleanPhone.slice(-4)})` };
                }

                // 2. Registrar mensaje entrante en tabla mensajes
                const metaMsgId = `was_in_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                await pool.query(`
                    INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
                    VALUES (?, ?, 'ENTRANTE', 'texto', ?, 'recibido', ?)
                `, [contactoId, metaMsgId, text, lineCode]);

                // 3. Generar respuesta automática del Bot
                const botReplyText = await this.generateBotReply(cleanPhone, text, contacto, codigoEmpresa);

                if (botReplyText) {
                    console.log(`🤖 [WASender ${lineCode}] Despachando respuesta automática a ${cleanPhone}...`);
                    const sendRes = await this.sendMessage(cleanPhone, botReplyText, codigoEmpresa, { isBotReply: true, forceSend: true });

                    if (sendRes.success) {
                        const outMsgId = `was_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                        await pool.query(`
                            INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
                            VALUES (?, ?, 'SALIENTE', 'texto', ?, 'enviado', ?)
                        `, [contactoId, outMsgId, botReplyText, lineCode]);
                        console.log(`✅ [WASender ${lineCode}] Respuesta entregada con éxito a ${cleanPhone}`);
                    } else {
                        console.error(`❌ [WASender ${lineCode}] Error enviando respuesta a ${cleanPhone}:`, sendRes.error);
                    }
                }

                return { success: true, processed: true, contactId: contactoId, line: lineCode };
            } catch (dbErr) {
                console.error('Error procesando webhook de WASender en DB:', dbErr.message);
                return { success: false, error: dbErr.message };
            }
        }

        // Otros eventos de WASender (session.status, qrcode.updated, etc.)
        if (event.includes('session') || event.includes('status') || event.includes('qrcode')) {
            console.log(`ℹ️ [WASender ${lineCode}] Evento de sesión/estado:`, payload?.data?.status || payload?.status || event);
            return { success: true, event };
        }

        return { success: true, ignored: true, event };
    }
}

module.exports = new WasenderService();
