const axios = require('axios');
const db = require('./database');
const { handleFlowEngine } = require('./flowEngine');

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
                block_outgoing: true
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
     * Respeta la regla: si block_outgoing está activo, se bloquea la salida
     */
    async sendMessage(to, text, codigoEmpresa = 'KRZMJI', options = {}) {
        const config = await this.getConfig(codigoEmpresa);
        const { isBotReply = false, forceSend = false } = options;

        // Regla solicitada por el usuario:
        // "todo mensaje entrante quiero blokear la comunicacion saliente en esta linea porahora"
        if (config?.block_outgoing && !isBotReply && !forceSend) {
            console.warn(`🔒 [WASender ${config?.line_code || 'WA_S***5239'}] Comunicación saliente bloqueada por configuración de prueba para ${to}`);
            return {
                success: false,
                blocked: true,
                message: `Comunicación saliente bloqueada en la línea ${config?.line_code || 'WA_S***5239'} (Modo Prueba / Solo Entrante Activo).`
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
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
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
     * Procesa los webhooks entrantes de WASender (wasenderapi.com)
     */
    async handleWebhook(payload, headers = {}, codigoEmpresa = 'KRZMJI') {
        const pool = db.pool;
        const event = payload?.event || payload?.type || 'messages.received';
        console.log(`📥 [WASender Webhook] Evento recibido: ${event}`);

        const config = await this.getConfig(codigoEmpresa);
        const lineCode = config?.line_code || 'WA_S***5239';

        // Procesar mensajes entrantes (personal o grupos si no están ignorados)
        if (event === 'messages.received' || event === 'messages-personal.received' || event === 'message.received') {
            const data = payload?.data || payload;
            let from = data?.from || data?.key?.remoteJid || data?.sender || data?.participant || '';
            let text = data?.text || data?.body || data?.content || data?.message?.conversation || '';

            // Limpiar número remitente (eliminar @s.whatsapp.net o @c.us)
            from = from.replace(/@.*$/, '').replace(/\D/g, '');
            if (!from || !text) {
                return { success: true, ignored: true, reason: 'Sin remitente o mensaje' };
            }

            console.log(`📱 [WASender ${lineCode}] Mensaje de ${from}: "${text}"`);

            // 1. REGLA PEDIDA POR EL USUARIO:
            // "todo mensaje entrante quiero blokear la comunicacion saliente en esta linea porahora"
            // Aseguramos que la línea mantenga bloqueada la comunicación saliente de campañas masivas
            try {
                const [empRows] = await pool.query('SELECT cuentas_vinculadas FROM empresas WHERE codigo = ?', [codigoEmpresa]);
                let cv = empRows[0]?.cuentas_vinculadas || {};
                if (typeof cv === 'string') {
                    try { cv = JSON.parse(cv); } catch (e) { cv = {}; }
                }
                if (cv.wasender && cv.wasender.block_outgoing !== true) {
                    cv.wasender.block_outgoing = true;
                    await pool.query('UPDATE empresas SET cuentas_vinculadas = ? WHERE codigo = ?', [JSON.stringify(cv), codigoEmpresa]);
                    console.log(`🔒 [WASender ${lineCode}] Bloqueo de salida confirmado automáticamente tras mensaje entrante.`);
                }
            } catch (lockErr) {
                console.error('Error aplicando bloqueo de salida WASender:', lockErr.message);
            }

            // 2. Registrar o actualizar contacto en CRM
            try {
                let cleanPhone = from;
                if (!cleanPhone.startsWith('549') && cleanPhone.startsWith('54')) {
                    cleanPhone = '549' + cleanPhone.slice(2);
                } else if (!cleanPhone.startsWith('549')) {
                    cleanPhone = '549' + cleanPhone;
                }

                const [existing] = await pool.query(
                    'SELECT id, nombre, grupo, flujo_activo_id, nodo_actual_id FROM contactos WHERE telefono = ? AND codigo_empresa = ? LIMIT 1',
                    [cleanPhone, codigoEmpresa]
                );

                let contactoId = null;
                let flujoActivoId = null;
                let nodoActualId = null;

                if (existing && existing.length > 0) {
                    contactoId = existing[0].id;
                    flujoActivoId = existing[0].flujo_activo_id;
                    nodoActualId = existing[0].nodo_actual_id;
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
                }

                // 3. Registrar mensaje en tabla mensajes
                const metaMsgId = `was_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                await pool.query(`
                    INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, estado_entrega, linea_wa)
                    VALUES (?, ?, 'ENTRANTE', 'texto', ?, 'recibido', ?)
                `, [contactoId, metaMsgId, text, lineCode]);

                // 4. Activar el Bot para este lead (Flujo WA_S: Agentes RE/MAX y Publicidad Redes)
                // Buscar el flujo ID 15 o por nombre
                const [flowRows] = await pool.query(
                    'SELECT id, nombre, data_json FROM flujos WHERE nombre LIKE \'%WA_S%\' AND activo = 1 LIMIT 1'
                );

                if (flowRows.length > 0) {
                    const flow = flowRows[0];
                    const targetFlowId = flow.id;

                    console.log(`🤖 [WASender ${lineCode}] Ejecutando Flujo "${flow.nombre}" (ID ${targetFlowId}) para ${cleanPhone}...`);

                    // Si no tiene flujo activo o es nuevo mensaje, asignamos el flujo WA_S
                    await pool.query(
                        'UPDATE contactos SET flujo_activo_id = ?, nodo_actual_id = COALESCE(nodo_actual_id, \'node_start\') WHERE id = ?',
                        [targetFlowId, contactoId]
                    );

                    // Ejecutar motor de flujos si está disponible
                    if (typeof handleFlowEngine === 'function') {
                        try {
                            const flowContact = {
                                id: contactoId,
                                telefono: cleanPhone,
                                flujo_activo_id: targetFlowId,
                                nodo_actual_id: nodoActualId || 'node_start',
                                codigo_empresa: codigoEmpresa
                            };
                            await handleFlowEngine(cleanPhone, text, flowContact, codigoEmpresa);
                        } catch (flowErr) {
                            console.error('Error ejecutando flowEngine en WASender:', flowErr.message);
                        }
                    }
                }

                return { success: true, processed: true, contactId: contactoId, line: lineCode };
            } catch (dbErr) {
                console.error('Error guardando mensaje de WASender en DB:', dbErr.message);
                return { success: false, error: dbErr.message };
            }
        }

        // Otros eventos de WASender (session.status, qrcode.updated, etc.)
        if (event === 'session.status' || event === 'qrcode.updated') {
            console.log(`ℹ️ [WASender ${lineCode}] Estado de sesión:`, payload?.data?.status || payload?.status);
            return { success: true, event };
        }

        return { success: true, ignored: true };
    }
}

module.exports = new WasenderService();
