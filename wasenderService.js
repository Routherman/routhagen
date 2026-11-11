const axios = require('axios');
const db = require('./database');
const { processMessageWithAI } = require('./groqService');
const { sanitizeBotReplyText } = require('./aiRouter');

/**
 * Servicio de Integración con WASender API (wasenderapi.com)
 * Línea asignada: WA_S***5062 (Teléfono +54 9 11 2473 5062, Sesión Colab)
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
                phone_number: '+54 9 11 2473 5062',
                phone_last4: '5062',
                line_code: 'WA_S***5062',
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
        const last4 = clean.length >= 4 ? clean.slice(-4) : '5062';
        return `WA_S***${last4}`;
    }

    /**
     * Normaliza números argentinos y limpia caracteres no numéricos
     */
    normalizePhone(raw) {
        let digits = String(raw || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (!digits) return '';
        if (!digits.startsWith('549') && digits.startsWith('54')) {
            digits = '549' + digits.slice(2);
        } else if (!digits.startsWith('549') && digits.startsWith('11')) {
            digits = '549' + digits;
        }
        return digits;
    }

    /**
     * Despacho compartido hacia POST https://wasenderapi.com/api/send-message (texto o poll)
     */
    async postWasenderPayload(payloadBody, codigoEmpresa = 'KRZMJI', options = {}) {
        const config = await this.getConfig(codigoEmpresa);
        const { forceSend = false, isCampaign = false } = options;

        // El bloqueo anti-spam solo restringe campañas masivas automáticas
        if (isCampaign && config?.block_outgoing && !forceSend) {
            console.warn(`🔒 [WASender ${config?.line_code || 'WA_S***5062'}] Campaña masiva pausada por regla anti-spam para ${payloadBody.to}`);
            return {
                success: false,
                blocked: true,
                message: `Campaña masiva pausada por regla anti-spam en la línea ${config?.line_code || 'WA_S***5062'}.`
            };
        }

        const apiKey = config?.api_key || process.env.WASENDER_API_KEY;
        const cleanTo = this.normalizePhone(payloadBody.to);
        const finalBody = { ...payloadBody, to: cleanTo };

        if (!apiKey || apiKey === 'wasender_live_token_globalloan') {
            const preview = finalBody.text
                ? `"${finalBody.text.substring(0, 60)}..."`
                : `[POLL: ${finalBody.poll?.question}]`;
            console.log(`[WASender Simulado ${config?.line_code || 'WA_S***5062'}] Despachando a ${cleanTo}: ${preview}`);
            return {
                success: true,
                simulated: true,
                line: config?.line_code || 'WA_S***5062',
                to: cleanTo,
                ...finalBody
            };
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/send-message`,
                finalBody,
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
                line: config?.line_code || 'WA_S***5062'
            };
        } catch (error) {
            console.error('Error enviando mensaje vía WASender:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                line: config?.line_code || 'WA_S***5062'
            };
        }
    }

    /**
     * Envío de mensaje de texto vía WASender API
     * Regla de negocio: El bloqueo anti-spam solo restringe campañas masivas automáticas (isCampaign: true).
     * Envíos manuales desde el CRM, respuestas del Bot o individuales SIEMPRE están habilitados.
     */
    async sendMessage(to, text, codigoEmpresa = 'KRZMJI', options = {}) {
        const cleanText = sanitizeBotReplyText(text);
        return await this.postWasenderPayload({ to, text: cleanText }, codigoEmpresa, options);
    }

    /**
     * Envío de encuesta interactiva tocable desde el celular (Poll Message) vía WASender API
     */
    async sendPoll(to, pollPayload, codigoEmpresa = 'KRZMJI', options = {}) {
        if (!pollPayload?.question || !Array.isArray(pollPayload.options) || pollPayload.options.length < 2) {
            return { success: false, error: 'Poll requiere pregunta y al menos 2 opciones.' };
        }
        const poll = {
            question: sanitizeBotReplyText(String(pollPayload.question)),
            options: pollPayload.options.slice(0, 12).map(o => sanitizeBotReplyText(String(o))),
            multiSelect: Boolean(pollPayload.multiSelect)
        };
        return await this.postWasenderPayload({ to, poll }, codigoEmpresa, options);
    }

    /**
     * Genera la respuesta y metadatos de formulario interactivo para la línea WASender
     */
    async generateBotReplyBundle(cleanPhone, userText, contact, codigoEmpresa) {
        const textLower = (userText || '').toLowerCase().trim();
        const {
            getAvailableWebinarSlots,
            formatCalendarOptionsText,
            buildPublicWebinarUrl,
            processBooking
        } = require('./googleCalendarService');

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
        const slotChoiceMatch = userText.match(/opci[oó]n\s*(\d{1,2})|slot_(\d{1,2})|\b([1-9]|1[0-2])\b/i);
        const detectedSlot = slotChoiceMatch ? (slotChoiceMatch[1] || slotChoiceMatch[2] || slotChoiceMatch[3]) : null;
        const inferredCategory = /l[ií]der|equipo|broker/i.test(textLower)
            ? 'lideres'
            : (meta.pending_webinar_category || 'asesores');

        // 1. Detección de EMAIL (con o sin número de slot) -> PROCESAR RESERVA
        if (emailMatch) {
            try {
                const detectedEmail = emailMatch[0].toLowerCase().trim();
                const slotChoice = detectedSlot || meta.pending_slot_choice || '1';

                let detectedName = userText
                    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                    .replace(/\bopci[oó]n\s*\d{1,2}\b|\bslot_\d{1,2}\b|\b([1-9]|1[0-2])\b/gi, '')
                    .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                    .replace(/[,\-;]/g, ' ')
                    .trim();
                if (!detectedName || detectedName.length < 2) {
                    detectedName = contact?.nombre && !contact.nombre.startsWith('Lead') ? contact.nombre : 'Asesor Candidato';
                }

                const bookingRes = await processBooking({
                    slotChoice,
                    customerName: detectedName,
                    customerEmail: detectedEmail,
                    customerPhone: cleanPhone,
                    codigoEmpresa,
                    category: inferredCategory,
                    canal: 'wasender'
                });

                await saveMeta({
                    pending_slot_choice: null,
                    awaiting_webinar_booking: false,
                    pending_webinar_category: null,
                    slot_id: bookingRes.slot?.id || bookingRes.chosenSlot?.id || slotChoice,
                    email_registrado: detectedEmail,
                    nombre_registrado: detectedName
                });

                if (bookingRes && bookingRes.whatsappResponse) {
                    return { text: sanitizeBotReplyText(bookingRes.whatsappResponse), webinarFormCategory: null };
                }
            } catch (bookErr) {
                console.warn('Error en processBooking de WASender:', bookErr.message);
            }
        }

        // 2. Si el usuario ya está esperando agendar webinar Y selecciona un turno (por texto o encuesta):
        if (detectedSlot && (meta.awaiting_webinar_booking || /opci[oó]n|turno|slot/i.test(textLower) || meta.pending_slot_choice)) {
            try {
                const slots = await getAvailableWebinarSlots(codigoEmpresa, inferredCategory);
                const chosen = slots.find(s => s.id === parseInt(detectedSlot, 10)) || slots[0];

                await saveMeta({
                    pending_slot_choice: String(chosen?.id || detectedSlot),
                    awaiting_webinar_booking: true,
                    pending_webinar_category: inferredCategory
                });

                const formUrl = buildPublicWebinarUrl({
                    phone: cleanPhone,
                    category: inferredCategory,
                    codigoEmpresa,
                    slotId: chosen?.id || detectedSlot
                });

                if (chosen.modalidad === 'PRESENCIAL') {
                    return {
                        text: `¡Excelente elección! 🏢 Pre-seleccionaste *Opción ${chosen.id}* (${chosen.titulo}):\n\n` +
                              `🗓️ *Fecha:* ${chosen.fechaStr}\n` +
                              `⏰ *Horario:* ${chosen.horarioStr}\n` +
                              `📍 *Lugar:* ${chosen.ubicacion}\n\n` +
                              `📝 *Completá tu Nombre y Email desde tu celular aquí:*\n👉 ${formUrl}\n\n` +
                              `O respondeme por acá con tu *Nombre completo* y *Correo electrónico* (ej. *Juan Pérez juan@gmail.com*):`,
                        webinarFormCategory: null
                    };
                }

                return {
                    text: `¡Excelente elección! 📅 Pre-seleccionaste *Opción ${chosen.id}* (${chosen.titulo}):\n\n` +
                          `🗓️ *Fecha:* ${chosen.fechaStr}\n` +
                          `⏰ *Horario:* ${chosen.horarioStr}\n` +
                          `💻 *Modalidad:* Google Meet\n\n` +
                          `📝 *Completá tu Nombre y Email en 1 paso desde tu celular aquí:*\n👉 ${formUrl}\n\n` +
                          `O respondeme por acá con tu *Nombre completo* y *Correo electrónico* (ej. *Juan Pérez juan@gmail.com*):`,
                    webinarFormCategory: null
                };
            } catch (slotErr) {
                console.warn('Error procesando elección de slot en WASender:', slotErr.message);
            }
        }

        // 3. Saludos iniciales o reinicio de menú
        if (/^(hola|buenas|buen d[ií]a|buenas tardes|buenas noches|inicio|empezar|men[uú]|comenzar|\?)$/i.test(textLower) || textLower === 'hola') {
            await saveMeta({ awaiting_webinar_booking: false, pending_slot_choice: null });
            return {
                text: `¡Hola! Gracias por comunicarte con la línea oficial de Global Loan S.A. — Colaboratium (Registro BCRA Nº 40.015).\n\n` +
                      `Si llegaste por un anuncio en redes sociales o formas parte de la red de agentes inmobiliarios (RE/MAX, Century 21 o independientes), desarrollamos un modelo exclusivo de *Comisiones de alto rendimiento* para monetizar operaciones inmobiliarias y calzar créditos puente en 48 hs.\n\n` +
                      `¿Cómo te gustaría continuar?\n` +
                      `1️⃣ Escribe *1* si eres Agente Inmobiliario y deseas conocer el programa de alianzas y próximas capacitaciones.\n` +
                      `2️⃣ Escribe *2* si viste una publicación sobre créditos / inversión.\n` +
                      `3️⃣ Escribe *humano* para coordinar con un asesor ejecutivo.`,
                webinarFormCategory: null
            };
        }

        // 4. Opción 1: Agente Inmobiliario O consulta expresa de Webinar/Capacitación/Reunión/Formulario
        const isOp1 = textLower === '1' || /agente|inmobiliari|re\/?max|century|c21|alianza|corredor/i.test(textLower);
        const isWebinarQuery = /webinar|virtual|capacitaci[oó]n|reuni[oó]n|fechas|horarios|turno|agendar|agendame|inscribirme|anotarme|formulario.*(webinar|turno|fecha|reuni[oó]n)/i.test(textLower);

        if (isOp1 || isWebinarQuery) {
            const targetCategory = /l[ií]der|equipo|broker/i.test(textLower) ? 'lideres' : 'asesores';
            await saveMeta({
                awaiting_webinar_booking: true,
                pending_webinar_category: targetCategory
            });

            let calendarText = '';
            try {
                calendarText = await formatCalendarOptionsText(codigoEmpresa, targetCategory, {
                    includeFormLink: true,
                    includePollHint: true,
                    phone: cleanPhone
                });
            } catch (calErr) {
                console.warn('Error obteniendo opciones de calendario para WASender:', calErr.message);
            }

            const fallbackFormUrl = buildPublicWebinarUrl({ phone: cleanPhone, category: targetCategory, codigoEmpresa });

            if (isOp1) {
                return {
                    text: `🤝 *Programa de Alianzas para Agentes Inmobiliarios (RE/MAX, C21 e Independientes)*\n\n` +
                          `Como agente o corredor podés monetizar las operaciones trabadas de tus clientes:\n` +
                          `• *Créditos Puente y Refacciones*: Calce ágil en 48 a 72 hs con garantía real o fiduciaria.\n` +
                          `• *Comisiones de alto rendimiento*: Cobro bancarizado al calce efectivo de cada operación.\n` +
                          `• *Seguridad BCRA*: Operación respaldada bajo Registro Oficial BCRA Nº 40.015 con Banco BIND y Coinag.\n\n` +
                          (calendarText || `📌 *Próximas Sesiones de Capacitación Virtual (Vía Google Meet):*\n📝 *Inscribite desde tu celular:* ${fallbackFormUrl}`),
                    webinarFormCategory: targetCategory
                };
            }

            return {
                text: calendarText || `💻 *Webinar Virtual de Capacitación & Alianzas*\n\n📝 *Elegí fecha y reservá tu lugar desde tu celular:*\n👉 ${fallbackFormUrl}`,
                webinarFormCategory: targetCategory
            };
        }

        // 5. Opción 2: Créditos / Inversión
        if (textLower === '2' || /invers|cr[eé]dito|pr[eé]stamo|tasa|rendimiento/i.test(textLower)) {
            await saveMeta({ awaiting_webinar_booking: false });
            return {
                text: `📈 *Colaboratium — Plataforma de Créditos e Inversión P2P*\n\n• *Para Inversores*: Rendimientos atractivos en dólares o pesos, sin costo ni comisión alguna para el inversor (el tomador paga el costo de la plataforma). Operación totalmente bancarizada desde tu propia cuenta en Banco BIND / Coinag.\n• *Para Tomadores*: Créditos ágiles calzados en 48 hs con condiciones transparentes.\n• *Marco Regulatorio*: Registro Oficial BCRA Nº 40.015.\n\n¿Deseas recibir la propuesta informativa para *Inversores* o solicitar un *Crédito*? Responde con *Inversor* o *Crédito*.`,
                webinarFormCategory: null
            };
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
            return {
                text: `👨‍💼 *Derivación a Asesor Ejecutivo*\n\nHemos registrado tu solicitud con alta prioridad en nuestro sistema de atención.\nUno de nuestros ejecutivos comerciales se pondrá en contacto contigo a la brevedad por este medio.\n\n¡Muchas gracias por comunicarte con Global Loan S.A. — Colaboratium!`,
                webinarFormCategory: null
            };
        }

        // 6b. Consultas directas sobre cómo acceder o enlace a la aplicación principal
        const asksAppAccess = /(c[oó]mo|d[oó]nde|por d[oó]nde|quiero|puedo|link|enlace|url|web|p[aá]gina).*(acced|ingres|entrar|registr|abrir|app|aplicaci[oó]n|plataforma|colaboratium)|(acceder|ingresar|entrar|registrarme|enlace de la app|link de la app)/i.test(textLower);
        const mentionsMeetingOrWebinar = /webinar|capacitaci[oó]n|reuni[oó]n|meet|horario|turno|formulario/i.test(textLower);
        if (asksAppAccess && !mentionsMeetingOrWebinar) {
            await saveMeta({ awaiting_webinar_booking: false });
            return {
                text: `🌐 *Acceso a la App Principal de Colaboratium*\n\n` +
                      `Podés ingresar, registrarte y operar directamente desde nuestra plataforma web oficial:\n` +
                      `👉 https://colaboratium.com.ar/\n\n` +
                      `Recordá que la operatoria es totalmente digital y No Custodial (con respaldo de Banco BIND y Banco Coinag, Registro BCRA Nº 40.015), sin descargas ni intermediarios.\n\n` +
                      `¿Necesitás ayuda para registrarte o preferís que coordinemos una capacitación en vivo?`,
                webinarFormCategory: null
            };
        }

        // 7. Consultas generales asistidas por IA RAG
        try {
            if (typeof processMessageWithAI === 'function') {
                const aiPromptContext = {
                    codigo: codigoEmpresa,
                    nombre: 'Global Loan S.A. — Colaboratium',
                    systemPromptOverride: 'Eres el asistente virtual en la línea oficial WA_S***5062 (+54 9 11 2473 5062) para Agentes y publicidad de redes de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015). La aplicación/plataforma principal es https://colaboratium.com.ar/: SIEMPRE que cualquier persona pregunte cómo acceder, ingresar, registrarse o pida el link de la app/plataforma, envíala a https://colaboratium.com.ar/ (no existe consola.colaboratium.com.ar ni app descargable ni wallet interno). PROHIBIDO ABSOLUTO escribir símbolos "%" ni "por ciento" ni cifras porcentuales de comisiones, tasas u overriding por escrito; habla solo de "Comisiones de alto rendimiento" con cobro al calce, residual en cuotas y reinversiones, cuyo detalle numérico se ve en el Webinar. Enfatiza el calce en 48 hs, sin costo ni comisión al inversor, respaldo de Banco BIND y Coinag. Si preguntan por webinars o capacitación, invítalos indicando las opciones disponibles del calendario (el sistema adjuntará automáticamente la encuesta interactiva y el formulario móvil).'
                };
                const history = contact?.id ? await db.obtenerHistorialMensajes(contact.id, 6) : [];
                const aiReply = await processMessageWithAI(userText, history, aiPromptContext);
                if (aiReply && aiReply.length > 10 && !aiReply.includes('Lo siento, en este momento no puedo')) {
                    let cleanAi = sanitizeBotReplyText(aiReply.replace(/\[ROLE:.*?\]/ig, '').replace(/\[HANDOFF\]/g, '').trim());
                    const aiOffersWebinar = /(pr[oó]ximos?\s*webinars?|elige.*opci[oó]n|meet\.google\.com|horarios?\s+disponibles|capacitaci[oó]n\s+virtual)/i.test(cleanAi);
                    if (aiOffersWebinar) {
                        const aiCategory = /l[ií]der|equipo|broker/i.test(textLower + ' ' + cleanAi) ? 'lideres' : 'asesores';
                        await saveMeta({
                            awaiting_webinar_booking: true,
                            pending_webinar_category: aiCategory
                        });
                        const formUrl = buildPublicWebinarUrl({ phone: cleanPhone, category: aiCategory, codigoEmpresa });
                        if (!cleanAi.includes('/webinar')) {
                            cleanAi += `\n\n📝 *Elegí fecha, nombre y email en 1 paso desde tu celular:*\n👉 ${formUrl}\n👇 *O tocá tu horario directamente en la encuesta de abajo.*`;
                        }
                        return { text: cleanAi, webinarFormCategory: aiCategory };
                    }
                    return { text: cleanAi, webinarFormCategory: null };
                }
            }
        } catch (aiErr) {
            console.warn('[WASender AI] Error llamando a IA:', aiErr.message);
        }

        // Fallback al menú principal
        return {
            text: `¡Hola! Gracias por comunicarte con Global Loan S.A. — Colaboratium (BCRA Nº 40.015).\n\n¿En qué podemos ayudarte?\n1️⃣ Escribe *1* si eres Agente Inmobiliario (RE/MAX, C21 o independiente).\n2️⃣ Escribe *2* para información sobre Inversiones o Créditos.\n3️⃣ Escribe *humano* para hablar con un asesor.`,
            webinarFormCategory: null
        };
    }

    /**
     * Genera la respuesta de texto del Bot para la línea WASender (compatible con llamadores existentes)
     */
    async generateBotReply(cleanPhone, userText, contact, codigoEmpresa) {
        const bundle = await this.generateBotReplyBundle(cleanPhone, userText, contact, codigoEmpresa);
        return sanitizeBotReplyText(bundle?.text || '');
    }

    /**
     * Obtiene o crea el contacto WASender y normaliza su teléfono
     */
    async ensureContact(pool, rawPhoneDigits, codigoEmpresa, lineCode) {
        const cleanPhone = this.normalizePhone(rawPhoneDigits);
        const [existing] = await pool.query(
            'SELECT id, nombre, telefono, grupo, flujo_activo_id, nodo_actual_id, metadata_extra FROM contactos WHERE (telefono = ? OR telefono = ?) AND codigo_empresa = ? LIMIT 1',
            [cleanPhone, rawPhoneDigits, codigoEmpresa]
        );

        if (existing && existing.length > 0) {
            const contacto = existing[0];
            await pool.query(
                "UPDATE contactos SET linea_wa = ?, canal = 'wasender' WHERE id = ?",
                [lineCode, contacto.id]
            );
            return { contacto, contactoId: contacto.id, cleanPhone };
        }

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
        const contactoId = insContact.insertId;
        return {
            contacto: { id: contactoId, telefono: cleanPhone, nombre: `Lead WA_S (${cleanPhone.slice(-4)})` },
            contactoId,
            cleanPhone
        };
    }

    /**
     * Despacha respuesta de texto y, si corresponde, adjunta la encuesta tocable (Poll) de Webinar
     */
    async dispatchAndLogReply(pool, contactoId, cleanPhone, replyBundle, codigoEmpresa, lineCode) {
        const botReplyText = sanitizeBotReplyText(replyBundle?.text || '');
        if (!botReplyText) return;

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

        if (replyBundle?.webinarFormCategory) {
            try {
                const { formatWebinarPollPayload } = require('./googleCalendarService');
                const pollPayload = await formatWebinarPollPayload(codigoEmpresa, replyBundle.webinarFormCategory);
                if (pollPayload?.options?.length >= 2) {
                    await new Promise(r => setTimeout(r, 350));
                    const pollRes = await this.sendPoll(cleanPhone, pollPayload, codigoEmpresa, { isBotReply: true, forceSend: true });
                    if (pollRes.success) {
                        const pollOutId = `was_poll_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                        await pool.query(`
                            INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
                            VALUES (?, ?, 'SALIENTE', 'poll', ?, 'enviado', ?)
                        `, [contactoId, pollOutId, `[Encuesta Webinar] ${pollPayload.question}\n${pollPayload.options.join('\n')}`, lineCode]);
                        console.log(`🗳️ [WASender ${lineCode}] Encuesta interactiva de Webinar enviada a ${cleanPhone}`);
                    }
                }
            } catch (pollErr) {
                console.warn(`⚠️ [WASender ${lineCode}] No se pudo enviar encuesta de Webinar:`, pollErr.message);
            }
        }
    }

    /**
     * Procesa votos entrantes en encuestas interactivas de WhatsApp (poll.results)
     */
    async handlePollResultsEvent(pool, payload, config, codigoEmpresa, lineCode) {
        const dataObj = payload?.data || payload;
        const pollResult = dataObj?.pollResult || payload?.pollResult;
        if (!Array.isArray(pollResult) || pollResult.length === 0) {
            return { success: true, ignored: true, reason: 'Sin resultados de encuesta' };
        }

        const key = dataObj?.key || payload?.key || {};
        const botDigits = this.normalizePhone(config?.phone_number || '5491124735062');
        const normalizeVoterJid = (v) => (typeof v === 'string' ? v : (v?.jid || v?.id || ''));

        const pickedItems = [];
        for (const item of pollResult) {
            const voters = Array.isArray(item?.voters) ? item.voters.map(normalizeVoterJid).filter(Boolean) : [];
            const customerVoters = voters.filter(v => {
                const digits = this.normalizePhone(v);
                return digits && digits !== botDigits;
            });
            if (customerVoters.length > 0 && item?.name) {
                pickedItems.push({ optionName: String(item.name).trim(), customerVoters });
            }
        }

        if (pickedItems.length === 0) {
            return { success: true, ignored: true, reason: 'Encuesta sin voto de usuario' };
        }

        const firstVoterPhoneJid = pickedItems[0].customerVoters.find(v => v.includes('@s.whatsapp.net')) || pickedItems[0].customerVoters[0];
        const rawFrom =
            key?.cleanedSenderPn ||
            key?.senderPn ||
            key?.remoteJidAlt ||
            key?.participantAlt ||
            firstVoterPhoneJid ||
            key?.remoteJid ||
            '';

        if (!rawFrom || String(rawFrom).includes('@g.us')) {
            return { success: true, ignored: true, reason: 'Voto sin remitente válido o de grupo' };
        }

        const rawDigits = String(rawFrom).replace(/@.*$/, '').replace(/\D/g, '');
        const cleanPhone = this.normalizePhone(rawDigits);
        const pollMsgId = key?.id || 'poll';

        if (!this.processedPollVotes) {
            this.processedPollVotes = new Map();
        }
        const now = Date.now();
        for (const [k, v] of this.processedPollVotes.entries()) {
            if (now - v.time > 300000) this.processedPollVotes.delete(k);
        }

        const voteKey = `${pollMsgId}:${cleanPhone}`;
        const prevVote = this.processedPollVotes.get(voteKey);
        const selectedOption = pickedItems.find(p => p.optionName !== prevVote?.optionName) || pickedItems[0];
        if (prevVote && prevVote.optionName === selectedOption.optionName) {
            return { success: true, ignored: true, reason: 'Voto de encuesta ya procesado' };
        }
        this.processedPollVotes.set(voteKey, { optionName: selectedOption.optionName, time: now });

        console.log(`🗳️ [WASender ${lineCode}] Selección en encuesta de ${cleanPhone}: "${selectedOption.optionName}"`);

        const { contacto, contactoId } = await this.ensureContact(pool, rawDigits, codigoEmpresa, lineCode);

        // Asegurar awaiting_webinar_booking activo antes de resolver el turno elegido
        let meta = contacto?.metadata_extra;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
        } else if (!meta) {
            meta = {};
        }
        meta.awaiting_webinar_booking = true;
        if (/l[ií]der/i.test(selectedOption.optionName)) {
            meta.pending_webinar_category = 'lideres';
        }
        contacto.metadata_extra = meta;

        const inMsgId = `was_pollvote_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await pool.query(`
            INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
            VALUES (?, ?, 'ENTRANTE', 'poll_vote', ?, 'recibido', ?)
        `, [contactoId, inMsgId, `[Selección Encuesta] ${selectedOption.optionName}`, lineCode]);

        const replyBundle = await this.generateBotReplyBundle(cleanPhone, selectedOption.optionName, contacto, codigoEmpresa);
        await this.dispatchAndLogReply(pool, contactoId, cleanPhone, replyBundle, codigoEmpresa, lineCode);

        return { success: true, processed: true, pollVote: selectedOption.optionName, contactId: contactoId, line: lineCode };
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
        const lineCode = config?.line_code || 'WA_S***5062';

        // 0. Procesar votos de encuestas interactivas (poll.results) ANTES del filtro de updates/fromMe
        if (event.includes('poll') || Array.isArray(payload?.data?.pollResult) || Array.isArray(payload?.pollResult)) {
            try {
                return await this.handlePollResultsEvent(pool, payload, config, codigoEmpresa, lineCode);
            } catch (pollErr) {
                console.error('Error procesando poll.results de WASender:', pollErr.message);
                return { success: false, error: pollErr.message };
            }
        }

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
            const rawMessages = payload?.data?.messages?.messages || payload?.data?.messages || payload?.messages?.messages || payload?.messages;
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
                msgObj?.key?.remoteJidAlt ||
                msgObj?.key?.participantAlt ||
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
            const innerMsg = msgObj?.message?.ephemeralMessage?.message || msgObj?.message || {};
            let text = (
                msgObj?.messageBody || 
                msgObj?.body || 
                msgObj?.text || 
                innerMsg?.conversation || 
                innerMsg?.extendedTextMessage?.text || 
                innerMsg?.imageMessage?.caption ||
                innerMsg?.videoMessage?.caption ||
                innerMsg?.buttonsResponseMessage?.selectedDisplayText ||
                innerMsg?.templateButtonReplyMessage?.selectedDisplayText ||
                innerMsg?.listResponseMessage?.title ||
                innerMsg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                ''
            ).trim();

            if (!from || !text) {
                console.log(`⚠️ [WASender ${lineCode}] Evento sin remitente (${from}) o texto (${text})`);
                return { success: true, ignored: true, reason: 'Sin remitente o texto' };
            }

            console.log(`📱 [WASender ${lineCode}] Mensaje entrante de ${from}: "${text}"`);

            try {
                // 1. Registrar o actualizar contacto en CRM
                const { contacto, contactoId, cleanPhone } = await this.ensureContact(pool, from, codigoEmpresa, lineCode);

                // 2. Registrar mensaje entrante en tabla mensajes
                const metaMsgId = `was_in_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                await pool.query(`
                    INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
                    VALUES (?, ?, 'ENTRANTE', 'texto', ?, 'recibido', ?)
                `, [contactoId, metaMsgId, text, lineCode]);

                // 3. Generar respuesta automática del Bot y adjuntar encuesta interactiva si corresponde
                const replyBundle = await this.generateBotReplyBundle(cleanPhone, text, contacto, codigoEmpresa);
                await this.dispatchAndLogReply(pool, contactoId, cleanPhone, replyBundle, codigoEmpresa, lineCode);

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
