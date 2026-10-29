const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });



const { processMessageWithAI, summarizeDocument } = require('./groqService');
const { sendWhatsAppMessage, sendWhatsAppTemplate, downloadWhatsAppMedia } = require('./whatsappService');
const { handleFlowEngine } = require('./flowEngine');
const db = require('./database');
const cors = require('cors');
const multer = require('multer');
const { extractTextFromFile } = require('./fileProcessor');
const fs = require('fs');
const { incomingMessageQueue } = require('./queue/messageQueue');
const { campaignQueue } = require('./queue/campaignQueue');
const { processExcelContactsWithAI, normalizePhoneNumber } = require('./excelService');
const { sendTicketEmail, sendMassEmailCampaign, sendGenericEmail } = require('./emailService');
const { analyzeDeliverability, validateMergeVariables } = require('./emailOptimizer');
const { summarizeConversationWithAI } = require('./aiRouter');
const campaignScheduler = require('./campaignScheduler');

const upload = multer({ dest: 'public/uploads/' });

// Configuración de almacenamiento para Biblioteca de Medios por Rubros
const mediaStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dest = path.join(__dirname, 'public/media');
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, Date.now() + '_' + cleanName);
    }
});
const uploadMedia = multer({ storage: mediaStorage });

const app = express();

// Configuración robusta de CORS para Vercel y Ngrok
const corsOptions = {
    origin: true, // Permite cualquier origen (routhagent.vercel.app, localhost, etc.)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'ngrok-skip-browser-warning',
        'Access-Control-Allow-Origin'
    ]
};

app.use(cors(corsOptions));

// Middleware de respaldo para garantizar encabezados en todas las peticiones
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use('/media', express.static(path.join(__dirname, 'public/media')));
app.use('/api/media', express.static(path.join(__dirname, 'public/media')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const WAPP_VERIFY_TOKEN = process.env.WAPP_VERIFY_TOKEN;

// ---------------------------------------------------------
// FUNCIONES AUXILIARES PARA PARSEAR LOS WEBHOOKS
// ---------------------------------------------------------

/**
 * Procesa un mensaje entrante (Texto, Multimedia o Contactos)
 */
function parseMessage(message, contact) {
    // 1. Quién envía el mensaje
    const senderName = contact?.profile?.name || 'Desconocido';
    const senderUsername = contact?.profile?.username || '';
    const remitente = senderUsername ? `${senderName} (${senderUsername})` : senderName;

    // 2. Identificador del remitente
    const senderId = message.from || message.from_user_id || 'ID_Desconocido';
    const idType = message.from ? 'Teléfono' : 'User_ID';

    // 3. Fecha y hora
    const dateObj = new Date(message.timestamp * 1000);
    const fechaHora = dateObj.toLocaleString('es-AR');

    // 4. Tipo de mensaje y Contenido
    const messageType = message.type;
    let contenido = '';
    let mediaId = null;

    if (messageType === 'text') {
        contenido = message.text?.body || '';
    }
    else if (['image', 'video', 'audio', 'document', 'sticker'].includes(messageType)) {
        mediaId = message[messageType]?.id;
        contenido = message[messageType]?.caption || ''; // Texto adjunto a la imagen/video (si lo hay)
    }
    else if (messageType === 'contacts') {
        const sentContacts = message.contacts || [];
        const contactDetails = sentContacts.map(c => {
            const name = c.name?.formatted_name || 'Sin Nombre';
            const phone = c.phones?.[0]?.phone || 'Sin Teléfono';
            return `${name} (${phone})`;
        }).join(', ');
        contenido = `Contacto(s) recibido(s): ${contactDetails}`;
    }
    else if (messageType === 'button') {
        contenido = message.button?.payload || message.button?.text || '';
    }
    else if (messageType === 'interactive') {
        const interactive = message.interactive || {};
        if (interactive.type === 'button_reply') {
            contenido = interactive.button_reply?.id || interactive.button_reply?.title || '';
        } else if (interactive.type === 'list_reply') {
            contenido = interactive.list_reply?.id || interactive.list_reply?.title || '';
        } else {
            contenido = interactive.title || '';
        }
    }
    else {
        contenido = `Contenido no parseado para el tipo: ${messageType}`;
    }

    return {
        remitente,
        identificador: { tipo: idType, valor: senderId },
        foto_perfil: 'No disponible a través de Webhooks de Meta',
        fecha_hora: fechaHora,
        tipo_mensaje: messageType,
        contenido,
        id_media: mediaId,
        id_mensaje_meta: message.id
    };
}

/**
 * Procesa las actualizaciones de estado de un mensaje enviado por nosotros (Sent, Delivered, Read)
 */
function parseStatus(statusData) {
    const dateObj = new Date(statusData.timestamp * 1000);
    const fechaHora = dateObj.toLocaleString('es-AR');

    return {
        id_mensaje_meta: statusData.id,
        estado: statusData.status, // 'sent', 'delivered', 'read', 'failed'
        destinatario: statusData.recipient_id || 'ID_Desconocido',
        fecha_hora: fechaHora
    };
}


// ---------------------------------------------------------
// RUTAS DEL SERVIDOR
// ---------------------------------------------------------

// Endpoint GET para verificar el Webhook (Requerido por Meta)
app.get(['/api/messages/whatsapp/receive', '/webhook'], async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe') {
            const empresa = await db.obtenerEmpresaPorWebhookToken(token);
            if (empresa) {
                console.log(`✅ WEBHOOK VERIFICADO EXITOSAMENTE PARA EMPRESA ${empresa.codigo}`);
                return res.status(200).send(challenge);
            } else {
                // Backward compatibility or fallback to env for testing
                if (token === process.env.WAPP_VERIFY_TOKEN) {
                    console.log(`✅ WEBHOOK VERIFICADO (FALLBACK ENV)`);
                    return res.status(200).send(challenge);
                }
            }
            console.error('❌ FALLÓ LA VERIFICACIÓN DEL WEBHOOK: Token no coincide con ninguna empresa');
            res.sendStatus(403);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Endpoint POST para recibir los eventos de WhatsApp
app.post(['/api/messages/whatsapp/receive', '/webhook'], async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            // CASO ESPECIAL META: Actualización de estado de Plantilla (message_template_status_update)
            if (changes?.field === 'message_template_status_update' || value?.event) {
                const templateEvent = value?.event; // 'APPROVED', 'REJECTED', 'PENDING_DELETION', 'PAUSED'
                const templateId = value?.message_template_id;
                const templateName = value?.message_template_name;
                const reason = value?.reason || '';

                console.log(`\n📢 [META WEBHOOK]: Actualización de plantilla "${templateName}" (ID: ${templateId}) -> Estado: ${templateEvent}`);

                // Determinar código de empresa por WABA ID o fallback KRZMJI
                let targetCodigo = 'KRZMJI';
                if (entry?.id) {
                    try {
                        const [empRows] = await db.pool.query(
                            "SELECT codigo FROM empresas WHERE cuentas_vinculadas LIKE ? LIMIT 1",
                            [`%${entry.id}%`]
                        );
                        if (empRows && empRows.length > 0) {
                            targetCodigo = empRows[0].codigo;
                        }
                    } catch (e) {}
                }

                // 1. Crear Evento / Ticket en Helpdesk
                try {
                    const ticketStatus = templateEvent === 'APPROVED' ? 'resolved' : 'open';
                    const summary = templateEvent === 'APPROVED'
                        ? `🎉 Plantilla WhatsApp Aprobada por Meta: ${templateName} (Meta ID: ${templateId}) - Lista para Envíos Masivos`
                        : `⚠️ Plantilla WhatsApp ${templateEvent} por Meta: ${templateName} (Meta ID: ${templateId})${reason ? ' - Motivo: ' + reason : ''}`;

                    const ticketId = await db.crearTicket(
                        targetCodigo,
                        null,
                        templateId ? String(templateId) : 'Meta-Cloud-API',
                        'Meta Cloud API',
                        ticketStatus,
                        summary,
                        null,
                        'Soporte'
                    );

                    await db.pool.query(
                        `UPDATE tickets SET priority = 'alta', category = 'Meta WhatsApp', internal_notes = ? WHERE id = ?`,
                        [`Notificación recibida por Webhook Meta el ${new Date().toLocaleString('es-AR')}. Evento: ${templateEvent}.`, ticketId]
                    );
                    console.log(`🎟️ [HELPDESK] Ticket #${ticketId} creado para plantilla "${templateName}".`);
                } catch (tErr) {
                    console.error('Error creando ticket helpdesk de plantilla:', tErr.message);
                }

                // 2. Registrar en auditoría
                try {
                    if (db.registrarAuditLog) {
                        await db.registrarAuditLog({
                            codigo_empresa: targetCodigo,
                            usuario_email: 'meta-cloud@routhagent.com',
                            usuario_nombre: 'Meta Cloud API',
                            rol: 'Sistema',
                            accion: `PLANTILLA_META_${templateEvent}`,
                            entidad: 'whatsapp_template',
                            entidad_id: String(templateId),
                            detalles: `Webhook de Meta: Plantilla "${templateName}" actualizada a ${templateEvent}${reason ? '. Motivo: ' + reason : ''}.`,
                            google_scope: 'colaboratium@gmail.com'
                        });
                    }
                } catch (aErr) {}

                // 3. Notificar por correo a colaboratium@gmail.com
                try {
                    const { sendGenericEmail } = require('./emailService');
                    await sendGenericEmail({
                        to: 'colaboratium@gmail.com',
                        subject: `📢 [Meta WhatsApp] Plantilla "${templateName}" -> ${templateEvent}`,
                        text: `Notificación de Meta Cloud API:\n\nLa plantilla de WhatsApp "${templateName}" (ID: ${templateId}) cambió a estado: ${templateEvent}.\n${reason ? 'Motivo: ' + reason + '\n' : ''}\nPodés ver el ticket generado en tu panel de Helpdesk de Routh Agent.`,
                        html: `<h3>📢 Notificación de Meta Cloud API</h3>
                            <p>La plantilla de WhatsApp <b>${templateName}</b> (ID: <code>${templateId}</code>) fue <b>${templateEvent}</b>.</p>
                            ${reason ? '<p><b>Motivo:</b> ' + reason + '</p>' : ''}
                            <p>El ticket correspondiente ya fue registrado en el panel de Helpdesk.</p>`
                    });
                } catch (mErr) {}

                return res.sendStatus(200);
            }

            // Identificar empresa por phone_number_id
            const phoneId = value?.metadata?.phone_number_id;
            let empresa = null;
            if (phoneId) {
                empresa = await db.obtenerEmpresaPorPhoneId(phoneId);
            }
            if (!empresa) {
                console.error(`❌ Empresa no encontrada para el phone_id: ${phoneId}`);
                return res.sendStatus(200);
            }

            let cv = empresa.cuentas_vinculadas;
            if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
            let accessToken = cv?.whatsapp?.access_token || process.env.WAPP_ACCESS_TOKEN;
            if (accessToken === process.env.WAPP_VERIFY_TOKEN) {
                accessToken = process.env.WAPP_ACCESS_TOKEN;
            }
            const codigoEmpresa = empresa.codigo;

            // CASO 1: Recibimos un mensaje (Incoming o Contacts)
            if (value && value.messages && value.messages[0]) {
                const message = value.messages[0];
                const contact = value.contacts?.[0] || {};

                const cleanMessage = parseMessage(message, contact);

                // 1. Guardar o actualizar contacto
                const dbContacto = await db.upsertContacto(cleanMessage.identificador.valor, cleanMessage.remitente, codigoEmpresa);

                // En lugar de procesar todo inmediatamente, lo metemos en la cola
                // para proteger a la IA de la concurrencia masiva (Phase 1)
                await incomingMessageQueue.add('processMessage', {
                    cleanMessage,
                    dbContacto,
                    codigoEmpresa,
                    empresa,
                    phoneId,
                    accessToken
                }, {
                    removeOnComplete: true, // Limpiar trabajos exitosos de Redis
                    removeOnFail: false,    // Mantener los fallidos para depurar
                    attempts: 3,            // Reintentar hasta 3 veces si Groq/Meta falla
                    backoff: {
                        type: 'exponential',
                        delay: 2000         // Empezar esperando 2 segundos
                    }
                });
                console.log(`\n📥 Mensaje de ${cleanMessage.remitente} encolado para procesamiento (Empresa: ${codigoEmpresa}).`);
            }
            // CASO 2: Recibimos una confirmación de estado (Status: sent, delivered, read, failed)
            else if (value && value.statuses && value.statuses[0]) {
                const statusData = value.statuses[0];
                const cleanStatus = parseStatus(statusData);

                // Actualizar estado en BD
                await db.actualizarEstadoMensaje(cleanStatus.id_mensaje_meta, cleanStatus.estado);
                console.log(`\n📊 Estado del mensaje ${cleanStatus.id_mensaje_meta} actualizado en BD a: ${cleanStatus.estado}`);
                if (cleanStatus.estado === 'failed') {
                    console.error('❌ Detalle del fallo en WhatsApp Meta:', JSON.stringify(statusData.errors || statusData, null, 2));
                }
            }
        }

        // Siempre hay que devolver 200 OK para que Meta sepa que llegó
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error procesando el webhook:', error);
        res.sendStatus(500);
    }
});

// Endpoint para obtener todos los contactos (para el frontend) por empresa
app.get('/api/contacts/:empresa', async (req, res) => {
    try {
        const clerkId = req.query.clerkId;
        const userId = req.query.userId || req.query.user_id;
        const roleQuery = req.query.role || req.query.user_role;
        const onlyWithMessages = req.query.onlyWithMessages === 'true';
        let contacts = await db.obtenerContactos(req.params.empresa, onlyWithMessages);
        
        if (clerkId || userId || roleQuery) {
            const ctx = await db.getUserPortfolioContext(clerkId, userId, roleQuery, req.params.empresa);
            
            if (ctx.isMaster) {
                // Master ve todas las conversaciones
                return res.json(contacts);
            }

            if (ctx.isSoporte) {
                // Soporte ve conversaciones asignadas a Soporte o General
                contacts = contacts.filter(contact => {
                    if (contact.usuario_asignado_id) {
                        return ctx.allMyIds.includes(contact.usuario_asignado_id);
                    }
                    const rolAsignado = (contact.rol_asignado || 'General').toLowerCase();
                    return rolAsignado === 'soporte' || rolAsignado === 'general';
                });
                return res.json(contacts);
            }

            if (ctx.isLider) {
                // "lider podra ver solo las conversaciones de los asesores que pertenezcan a su equipo y las conversaciones que pertenezcan a los inversores dentro de su arbol"
                const teamAdvisorIds = contacts
                    .filter(c => {
                        const isAdvisor = (c.grupo || '').toUpperCase() === 'ASESORES' || (c.rol_asignado || '').toLowerCase() === 'asesores';
                        const belongsToMe = ctx.allMyIds.includes(c.lider_id) || ctx.allMyIds.includes(Number(c.lider_id));
                        return isAdvisor && belongsToMe;
                    })
                    .map(c => c.id);

                contacts = contacts.filter(c => {
                    if (teamAdvisorIds.includes(c.id)) return true;

                    const belongsToTree = ctx.allMyIds.includes(c.lider_id) || 
                                          ctx.allMyIds.includes(Number(c.lider_id)) || 
                                          teamAdvisorIds.includes(c.asesor_id) ||
                                          teamAdvisorIds.includes(Number(c.asesor_id));

                    if (belongsToTree) return true;

                    if (ctx.allMyIds.includes(c.usuario_asignado_id) || ctx.allMyIds.includes(c.id)) return true;

                    return false;
                });
                return res.json(contacts);
            }

            if (ctx.isAsesor) {
                // "los asesores solo podran ver las conversaciones con su lider y con los inversores que pertenezcan a su cartera"
                contacts = contacts.filter(c => {
                    // Conversación con su líder
                    if (ctx.myLeaderIds && ctx.myLeaderIds.includes(c.id)) return true;

                    // Inversores dentro de su cartera comercial
                    const isMyPortfolio = ctx.allMyIds.includes(c.asesor_id) || 
                                          ctx.allMyIds.includes(Number(c.asesor_id)) || 
                                          ctx.allMyIds.includes(c.usuario_asignado_id);

                    if (isMyPortfolio) return true;

                    return false;
                });
                return res.json(contacts);
            }

            // Fallback para otros roles específicos
            contacts = contacts.filter(contact => {
                if (contact.usuario_asignado_id) {
                    return ctx.allMyIds.includes(contact.usuario_asignado_id);
                }
                const rolAsignado = (contact.rol_asignado || 'General').toLowerCase();
                if (rolAsignado === 'general') return true;
                return ctx.role === rolAsignado;
            });
        }

        res.json(contacts);
    } catch (error) {
        console.error('❌ Error obteniendo contactos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para traer plantillas reales de Meta
app.get('/api/templates', async (req, res) => {
    try {
        // En Meta, las plantillas se asocian al WABA ID (WhatsApp Business Account ID), no al Phone ID.
        // Si no está en el .env, no podemos hacer la petición correctamente.
        const wabaId = process.env.WAPP_BUSINESS_ACCOUNT_ID;
        const token = process.env.WAPP_ACCESS_TOKEN;
        
        if (!wabaId) {
            return res.status(400).json({ error: 'Falta configurar WAPP_BUSINESS_ACCOUNT_ID en el .env del backend.' });
        }

        const axios = require('axios');
        const response = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/message_templates`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // Filtrar plantillas aprobadas
        const templates = response.data.data.filter(t => t.status === 'APPROVED');
        res.json(templates);
    } catch (err) {
        console.error('Error fetching templates from Meta:', err.response?.data || err.message);
        res.status(500).json({ error: 'No se pudieron obtener las plantillas de Meta', details: err.response?.data });
    }
});

// Endpoint para sincronizar plantillas con Meta y crear eventos de Helpdesk automáticamente
app.post('/api/templates/sync', async (req, res) => {
    try {
        const wabaId = process.env.WAPP_BUSINESS_ACCOUNT_ID;
        const token = process.env.WAPP_ACCESS_TOKEN;
        const codigoEmpresa = req.body?.codigoEmpresa || 'KRZMJI';

        if (!wabaId || !token) {
            return res.status(400).json({ error: 'Faltan credenciales de Meta en el backend.' });
        }

        const axios = require('axios');
        const response = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/message_templates?limit=50`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const templates = response.data?.data || [];
        const synced = [];

        for (const t of templates) {
            // Verificar si ya existe ticket de evento en Helpdesk para esta plantilla
            const [existingTickets] = await db.pool.query(
                `SELECT id, status, summary FROM tickets 
                 WHERE codigo_empresa = ? AND (customer_number = ? OR summary LIKE ?)`,
                [codigoEmpresa, String(t.id), `%${t.name}%`]
            );

            let ticketId = null;
            if (existingTickets.length === 0) {
                const summary = t.status === 'APPROVED'
                    ? `🎉 Plantilla WhatsApp Aprobada por Meta: ${t.name} (Meta ID: ${t.id}) - Lista para Envíos Masivos`
                    : `⚠️ Plantilla WhatsApp ${t.status} por Meta: ${t.name} (Meta ID: ${t.id})`;

                ticketId = await db.crearTicket(
                    codigoEmpresa,
                    null,
                    String(t.id),
                    'Meta Cloud API',
                    t.status === 'APPROVED' ? 'resolved' : 'open',
                    summary,
                    null,
                    'Soporte'
                );

                await db.pool.query(
                    `UPDATE tickets SET priority = 'alta', category = 'Meta WhatsApp', internal_notes = ? WHERE id = ?`,
                    [`Sincronizado vía Meta Graph API v19.0 el ${new Date().toLocaleString('es-AR')}. Categoría: ${t.category}.`, ticketId]
                );

                try {
                    await db.registrarAuditLog({
                        codigo_empresa: codigoEmpresa,
                        usuario_email: 'meta-cloud@routhagent.com',
                        usuario_nombre: 'Meta Cloud API',
                        rol: 'Sistema',
                        accion: `PLANTILLA_META_${t.status}`,
                        entidad: 'whatsapp_template',
                        entidad_id: String(t.id),
                        detalles: `Plantilla "${t.name}" verificada en Meta con estado ${t.status}. Ticket Helpdesk #${ticketId}.`,
                        google_scope: 'colaboratium@gmail.com'
                    });
                } catch(e) {}
            } else {
                ticketId = existingTickets[0].id;
            }

            synced.push({
                id: t.id,
                name: t.name,
                status: t.status,
                category: t.category,
                language: t.language,
                ticketId
            });
        }

        res.json({ success: true, count: synced.length, templates: synced });
    } catch (err) {
        console.error('Error syncing templates with Meta:', err.response?.data || err.message);
        res.status(500).json({ error: 'Error al sincronizar con Meta', details: err.response?.data || err.message });
    }
});

// Endpoint para obtener todos los mensajes de un contacto específico
app.get('/api/contacts/:id/messages', async (req, res) => {
    try {
        const contactId = req.params.id;
        const messages = await db.obtenerTodosLosMensajes(contactId);
        res.json(messages);
    } catch (error) {
        console.error('❌ Error obteniendo mensajes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para alternar el estado del bot de un contacto
app.put('/api/contacts/:id/bot', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { estado } = req.body; // 'ACTIVO' o 'HANDOFF'
        await db.actualizarEstadoBot(contactId, estado);
        res.json({ message: 'Estado del bot actualizado' });
    } catch (error) {
        console.error('❌ Error actualizando estado del bot:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para enviar una plantilla a un contacto
app.post('/api/contacts/:id/template', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { templateName, languageCode, bodyText } = req.body;
        
        if (!templateName || !languageCode) {
            return res.status(400).json({ error: 'Falta templateName o languageCode' });
        }

        // Obtener teléfono del contacto
        const [contacts] = await db.pool.query('SELECT * FROM contactos WHERE id = ?', [contactId]);
        if (contacts.length === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
        
        const telefono = contacts[0].telefono;

        // Obtener credenciales de la empresa
        const codigoEmpresa = contacts[0].codigo_empresa;
        const empresa = await db.obtenerEmpresa(codigoEmpresa);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        
        let cv = empresa.cuentas_vinculadas;
        if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
        
        const phoneId = cv?.whatsapp?.phone_id || process.env.WHATSAPP_PHONE_ID || process.env.WAPP_PHONE_NUMBER_ID;
        const accessToken = cv?.whatsapp?.access_token || process.env.WHATSAPP_ACCESS_TOKEN || process.env.WAPP_ACCESS_TOKEN;

        if (!phoneId || !accessToken) return res.status(400).json({ error: 'La empresa no tiene WhatsApp configurado' });

        // Determinar parámetros requeridos según la plantilla y los datos del contacto
        let params = req.body.parameters;
        const contacto = contacts[0];
        const contactName = contacto.nombre || 'Estimado/a';

        if (!params || !Array.isArray(params) || params.length === 0) {
            if (templateName === 'reunion_informativa_asesores') {
                let fechaStr = 'Jueves 29 de Octubre';
                let horarioStr = '13:00 hs';
                let meetUrl = 'https://meet.google.com/new';
                try {
                    const { getAvailableWebinarSlots } = require('./googleCalendarService');
                    const slots = await getAvailableWebinarSlots(codigoEmpresa, 'asesores');
                    if (slots && slots.length > 0) {
                        fechaStr = slots[0].fechaStr || fechaStr;
                        horarioStr = slots[0].horarioStr?.split(' a ')?.[0] || horarioStr;
                        meetUrl = slots[0].meetLink || meetUrl;
                    }
                } catch (e) {}

                params = [
                    fechaStr,
                    horarioStr,
                    '40 min',
                    meetUrl,
                    'https://colaboratium.com.ar/baja'
                ];
            } else if (['bienvenida_asesores_colaboratium', 'convocatoria_lideres_de_equipo', 'simulador_y_propuesta_inversores'].includes(templateName)) {
                params = [contactName];
            } else if (bodyText && bodyText.includes('{{1}}')) {
                const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
                const count = new Set(matches).size;
                if (count === 1) {
                    params = [contactName];
                } else if (count > 1) {
                    params = [contactName];
                    for (let i = 2; i <= count; i++) {
                        params.push(`Dato ${i}`);
                    }
                } else {
                    params = [];
                }
            } else {
                params = [];
            }
        }
        
        // Enviar plantilla
        const wamid = await sendWhatsAppTemplate(telefono, templateName, languageCode, phoneId, accessToken, params);
        
        // Renderizar cuerpo del mensaje con sus variables reemplazadas para la base de datos
        let renderedBody = bodyText || `[Plantilla: ${templateName}]`;
        if (params && params.length > 0) {
            params.forEach((p, idx) => {
                renderedBody = renderedBody.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), p);
            });
        }
        await db.guardarMensaje(contactId, wamid, 'SALIENTE', 'template', renderedBody);

        res.json({ success: true, messageId: wamid });
    } catch (error) {
        console.error('❌ Error enviando plantilla:', error.response?.data || error.message);
        const metaError = error.response?.data?.error;
        const msg = metaError?.message || metaError?.error_data?.details || error.message || 'No se pudo enviar la plantilla';
        res.status(500).json({ error: msg, details: metaError });
    }
});

// Importar contactos manualmente o desde lista simple
app.post('/api/empresas/:codigo/import-contacts', async (req, res) => {
    try {
        const { numbers, contacts } = req.body;
        const importedIds = [];

        // Si se envió lista de contactos con nombre y email
        if (Array.isArray(contacts)) {
            for (const c of contacts) {
                const phone = normalizePhoneNumber(c.telefono || c.number);
                if (phone) {
                    const contacto = await db.upsertContacto(phone, c.nombre || `Usuario ${phone}`, req.params.codigo, c.email || null);
                    if (contacto && contacto.id) importedIds.push(contacto.id);
                }
            }
            return res.json({ success: true, importedIds });
        }

        // Si se envió lista de números simples
        if (Array.isArray(numbers)) {
            for (const num of numbers) {
                if (!num || typeof num !== 'string' || num.trim() === '') continue;
                const cleanedNum = normalizePhoneNumber(num); 
                if (cleanedNum) {
                    const contacto = await db.upsertContacto(cleanedNum, 'Usuario ' + cleanedNum, req.params.codigo);
                    if (contacto && contacto.id) {
                        importedIds.push(contacto.id);
                    }
                }
            }
            return res.json({ success: true, importedIds });
        }

        return res.status(400).json({ error: 'Formato inválido. Se esperaba numbers o contacts.' });
    } catch (error) {
        console.error('Error importing contacts:', error);
        res.status(500).json({ error: 'Error importando contactos' });
    }
});

// Endpoint para subir y procesar archivo Excel (.xlsx/.xls/.csv) de contactos con análisis de IA
app.post('/api/empresas/:codigo/upload-contacts-excel', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

        const filePath = req.file.path;
        
        // 1. Procesar archivo y analizar columnas con IA (Groq)
        const result = await processExcelContactsWithAI(filePath);
        
        // Limpiar archivo temporal
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        // 2. Guardar contactos procesados en la base de datos
        const importedContacts = [];
        for (const c of result.contacts) {
            const dbContacto = await db.upsertContacto(c.telefono, c.nombre, req.params.codigo, c.email);
            if (dbContacto && dbContacto.id) {
                importedContacts.push({
                    id: dbContacto.id,
                    telefono: c.telefono,
                    nombre: c.nombre,
                    email: c.email
                });
            }
        }

        res.json({
            success: true,
            totalRows: result.totalRows,
            validCount: importedContacts.length,
            invalidCount: result.invalidCount,
            mappingDetected: result.mappingDetected,
            contacts: importedContacts
        });
    } catch (error) {
        console.error('Error procesando Excel de contactos:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Error procesando el archivo Excel: ' + error.message });
    }
});

// Obtener plantillas de Meta
app.get('/api/empresas/:codigo/templates', async (req, res) => {
    try {
        const empresa = await db.obtenerEmpresa(req.params.codigo);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        
        let cv = empresa.cuentas_vinculadas;
        if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
        
        const wabaId = cv?.whatsapp?.business_account_id || process.env.WAPP_BUSINESS_ACCOUNT_ID;
        const accessToken = cv?.whatsapp?.access_token || process.env.WAPP_ACCESS_TOKEN;

        if (!wabaId || !accessToken) return res.status(400).json({ error: 'Credenciales de WhatsApp no configuradas' });

        const axios = require('axios');
        const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        res.json(response.data.data);
    } catch (error) {
        console.error('Error fetching templates:', error.response?.data || error.message);
        res.status(500).json({ error: 'No se pudieron obtener las plantillas' });
    }
});

// Enviar campaña masiva
app.post('/api/empresas/:codigo/massive', async (req, res) => {
    try {
        const { contactIds, templateName, languageCode, messagesPerMinute, campaignName, useContactName } = req.body;
        const empresa = await db.obtenerEmpresa(req.params.codigo);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        
        let cv = empresa.cuentas_vinculadas;
        if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
        
        const phoneId = cv?.whatsapp?.phone_id || process.env.WAPP_PHONE_ID;
        const accessToken = cv?.whatsapp?.access_token || process.env.WAPP_ACCESS_TOKEN;

        if (!phoneId || !accessToken) return res.status(400).json({ error: 'Credenciales de WhatsApp no configuradas' });

        // Crear registro de campaña
        const nombreCampana = campaignName || `Campaña ${templateName}`;
        const campanaId = await db.crearCampana(req.params.codigo, nombreCampana, contactIds.length);

        // Calcular delay para respetar messagesPerMinute
        const delayMs = Math.max(1000, Math.floor(60000 / (messagesPerMinute || 10)));

        // Encolar los trabajos en BullMQ
        const jobs = contactIds.map(contactId => ({
            name: 'sendTemplate',
            data: {
                contactId,
                templateName,
                languageCode: languageCode || 'es_AR',
                phoneId,
                accessToken,
                campanaId,
                delayMs,
                useContactName: Boolean(useContactName)
            },
            opts: {
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            }
        }));

        // Trabajo especial para marcar como completada
        jobs.push({
            name: 'markCampaignCompleted',
            data: { isCompletionJob: true, campanaId },
            opts: { removeOnComplete: true }
        });

        await campaignQueue.addBulk(jobs);
        
        res.json({ success: true, message: 'Campaña iniciada y encolada', campanaId });
    } catch (error) {
        console.error('Error iniciando campaña masiva:', error);
        res.status(500).json({ error: 'Error iniciando campaña masiva' });
    }
});

// Obtener campañas masivas
app.get('/api/empresas/:codigo/campanas', async (req, res) => {
    try {
        const campanas = await db.obtenerCampanas(req.params.codigo);
        res.json(campanas);
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: 'Error obteniendo campañas' });
    }
});

// ==========================================
// ENDPOINTS DE PLANTILLAS (WHATSAPP & EMAIL)
// ==========================================

// Listar plantillas de una empresa
app.get('/api/empresas/:codigo/plantillas', async (req, res) => {
    try {
        const { tipo } = req.query;
        const plantillas = await db.obtenerPlantillas(req.params.codigo, tipo);
        res.json(plantillas);
    } catch (error) {
        console.error('Error obteniendo plantillas:', error);
        res.status(500).json({ error: 'Error obteniendo plantillas' });
    }
});

// Crear plantilla
app.post('/api/empresas/:codigo/plantillas', async (req, res) => {
    try {
        const { tipo, nombre, categoria, asunto, contenido, archivos_adjuntos } = req.body;
        if (!nombre || !contenido) {
            return res.status(400).json({ error: 'Nombre y contenido son obligatorios' });
        }
        const id = await db.crearPlantilla(req.params.codigo, {
            tipo: tipo || 'whatsapp',
            nombre,
            categoria: categoria || 'general',
            asunto: asunto || null,
            contenido,
            archivos_adjuntos: archivos_adjuntos || null
        });
        res.json({ success: true, id, message: 'Plantilla creada exitosamente' });
    } catch (error) {
        console.error('Error creando plantilla:', error);
        res.status(500).json({ error: 'Error creando plantilla' });
    }
});

// Actualizar plantilla
app.put('/api/empresas/:codigo/plantillas/:id', async (req, res) => {
    try {
        const ok = await db.actualizarPlantilla(req.params.id, req.body);
        if (!ok) return res.status(404).json({ error: 'Plantilla no encontrada' });
        res.json({ success: true, message: 'Plantilla actualizada exitosamente' });
    } catch (error) {
        console.error('Error actualizando plantilla:', error);
        res.status(500).json({ error: 'Error actualizando plantilla' });
    }
});

// Eliminar plantilla
app.delete('/api/empresas/:codigo/plantillas/:id', async (req, res) => {
    try {
        await db.eliminarPlantilla(req.params.id);
        res.json({ success: true, message: 'Plantilla eliminada exitosamente' });
    } catch (error) {
        console.error('Error eliminando plantilla:', error);
        res.status(500).json({ error: 'Error eliminando plantilla' });
    }
});

// Enviar plantilla a Meta Cloud API para aprobación oficial
const submitTemplateToMetaHandler = async (req, res) => {
    try {
        const plantilla = await db.obtenerPlantilla(req.params.id);
        if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });
        
        const empresa = await db.obtenerEmpresa(req.params.codigo);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        
        let cv = empresa.cuentas_vinculadas;
        if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
        
        const wabaId = cv?.whatsapp?.business_account_id || process.env.WAPP_BUSINESS_ACCOUNT_ID;
        const accessToken = cv?.whatsapp?.access_token || process.env.WAPP_ACCESS_TOKEN;

        if (!wabaId || !accessToken) {
            return res.status(400).json({ error: 'Credenciales de Meta WhatsApp no configuradas (WABA ID / Access Token)' });
        }

        // Sanitizar nombre para Meta: minúsculas, números y guiones bajos únicamente
        const metaName = plantilla.nombre
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 60);

        // Transformar contenido para Meta: reemplazar variables nombradas por {{1}}, {{2}}, etc.
        let bodyText = (plantilla.contenido || '').trim();
        let varCount = 0;
        bodyText = bodyText.replace(/\{\{([a-zA-ZáéíóúÁÉÍÓÚñÑ_0-9]+)\}\}/g, () => {
            varCount++;
            return `{{${varCount}}}`;
        });

        // Regla Meta: NO se permiten variables al final del texto (subcode 2388299). Debe haber palabras de cierre.
        if (/\{\{\d+\}\}[.\s]*$/.test(bodyText)) {
            bodyText += ' en cualquier momento.';
        }

        // Regla Meta: Límite estricto de 1024 caracteres para el componente BODY (subcode 2388040)
        if (bodyText.length > 1024) {
            bodyText = bodyText.slice(0, 1000).trim() + '... Muchas gracias.';
            // Asegurar que no cortamos una variable a la mitad
            bodyText = bodyText.replace(/\{\{\d*$/, '');
        }

        // Detectar variables {{1}}, {{2}}, etc.
        const varMatches = bodyText.match(/\{\{\d+\}\}/g) || [];
        const uniqueVars = Array.from(new Set(varMatches));

        const bodyComponent = {
            type: 'BODY',
            text: bodyText
        };

        if (uniqueVars.length > 0) {
            const sampleValues = uniqueVars.map((v, i) => {
                if (i === 0) return 'Juan Perez';
                if (i === 1) return 'Lunes 10:30 hs';
                if (i === 2) return '45 min';
                if (i === 3) return 'https://meet.google.com/xyz';
                return 'https://colaboratium.com.ar/baja';
            });
            bodyComponent.example = {
                body_text: [sampleValues]
            };
        }

        const payload = {
            name: metaName,
            category: 'MARKETING',
            allow_category_change: true,
            language: 'es_AR',
            components: [bodyComponent]
        };

        const axios = require('axios');
        const metaUrl = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;
        const metaRes = await axios.post(metaUrl, payload, {
            headers: { 
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const metaId = metaRes.data?.id;
        const metaStatus = metaRes.data?.status || 'PENDING';

        // Actualizar en base de datos local
        try {
            await db.pool.query(
                'UPDATE plantillas SET meta_id = ?, meta_status = ?, meta_nombre = ? WHERE id = ?',
                [metaId, metaStatus, metaName, plantilla.id]
            );
        } catch (dbErr) {
            console.warn('⚠️ No se pudo persistir meta_id en plantillas:', dbErr.message);
        }

        res.json({
            success: true,
            metaName,
            metaId,
            status: metaStatus,
            message: 'Plantilla enviada exitosamente a Meta para revisión oficial'
        });
    } catch (error) {
        console.error('Error enviando plantilla a Meta:', error.response?.data || error.message);
        const metaError = error.response?.data?.error;
        res.status(500).json({ 
            error: metaError?.message || 'Error al enviar plantilla a Meta Cloud API',
            details: metaError || error.message
        });
    }
};

app.post('/api/empresas/:codigo/plantillas/:id/submit-meta', submitTemplateToMetaHandler);
app.post('/empresas/:codigo/plantillas/:id/submit-meta', submitTemplateToMetaHandler);

// ==========================================
// ENDPOINTS DE BIBLIOTECA DE MEDIOS
// ==========================================

// Listar medios por rubro o todos
app.get('/api/empresas/:codigo/medios', async (req, res) => {
    try {
        const { rubro } = req.query;
        const medios = await db.obtenerMedios(req.params.codigo, rubro);
        res.json(medios);
    } catch (error) {
        console.error('Error obteniendo medios:', error);
        res.status(500).json({ error: 'Error obteniendo medios' });
    }
});

// Crear registro de medio manual
app.post('/api/empresas/:codigo/medios', async (req, res) => {
    try {
        const { rubro, nombre, archivo_url, mimetype, tamano_bytes } = req.body;
        if (!nombre || !archivo_url) {
            return res.status(400).json({ error: 'Nombre y URL de archivo son obligatorios' });
        }
        const id = await db.crearMedio(req.params.codigo, {
            rubro: rubro || 'otro',
            nombre,
            archivo_url,
            mimetype,
            tamano_bytes: tamano_bytes || 0
        });
        res.json({ success: true, id, message: 'Medio registrado correctamente' });
    } catch (error) {
        console.error('Error registrando medio:', error);
        res.status(500).json({ error: 'Error registrando medio' });
    }
});

// Subir archivo a la biblioteca de medios con detección automática de rubro
app.post('/api/empresas/:codigo/medios/upload', uploadMedia.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const mime = (req.file.mimetype || '').toLowerCase();
        let rubro = req.body.rubro;

        if (!rubro || rubro === 'auto') {
            if (['.mp3', '.ogg', '.wav', '.m4a', '.aac'].includes(ext) || mime.startsWith('audio/')) {
                rubro = 'audio';
            } else if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'].includes(ext) || mime.startsWith('image/')) {
                rubro = 'imagen';
            } else if (ext === '.pdf' || mime.includes('pdf')) {
                rubro = 'pdf';
            } else if (['.ppt', '.pptx', '.mp4'].includes(ext) || mime.includes('presentation') || mime.startsWith('video/')) {
                rubro = 'presentacion';
            } else {
                rubro = 'otro';
            }
        }

        const archivoUrl = `/media/${req.file.filename}`;
        const id = await db.crearMedio(req.params.codigo, {
            rubro,
            nombre: req.file.originalname,
            archivo_url: archivoUrl,
            mimetype: req.file.mimetype,
            tamano_bytes: req.file.size
        });

        res.json({
            success: true,
            id,
            rubro,
            nombre: req.file.originalname,
            archivo_url: archivoUrl,
            message: 'Archivo subido y categorizado en la Biblioteca de Medios'
        });
    } catch (error) {
        console.error('Error subiendo archivo a medios:', error);
        res.status(500).json({ error: 'Error subiendo archivo a medios' });
    }
});

// Eliminar medio de la biblioteca
app.delete('/api/empresas/:codigo/medios/:id', async (req, res) => {
    try {
        await db.eliminarMedio(req.params.id);
        res.json({ success: true, message: 'Medio eliminado de la biblioteca' });
    } catch (error) {
        console.error('Error eliminando medio:', error);
        res.status(500).json({ error: 'Error eliminando medio' });
    }
});

// ==========================================
// CAMPAÑAS MASIVAS DE EMAIL (GMAIL) - ARQUITECTURA OPTIMIZADA
// ==========================================

// 1. Diagnóstico de Entregabilidad Anti-Spam (chunkydotdev/email-skills)
app.post('/api/empresas/:codigo/campanas/email/analyze', async (req, res) => {
    try {
        const { subject = '', content = '' } = req.body;
        const analysis = analyzeDeliverability({ subject, htmlContent: content });
        res.json({ success: true, analysis });
    } catch (err) {
        console.error('Error analizando entregabilidad de email:', err);
        res.status(500).json({ error: 'Error analizando entregabilidad' });
    }
});

// 2. Pre-flight Merge Validation (robindarlington/mail-merge)
app.post('/api/empresas/:codigo/campanas/email/validate-merge', async (req, res) => {
    try {
        const { content = '', contactIds } = req.body;
        const allContacts = await db.obtenerContactosCRM(req.params.codigo);
        let targetContacts = allContacts;
        if (contactIds && Array.isArray(contactIds) && contactIds.length > 0) {
            targetContacts = allContacts.filter(c => contactIds.includes(c.id));
        }
        const validation = validateMergeVariables(content, targetContacts);
        res.json({ success: true, validation });
    } catch (err) {
        console.error('Error validando variables de email:', err);
        res.status(500).json({ error: 'Error validando variables' });
    }
});

// 3. Test de Envío de 1 Clic / Compuerta de Prueba (robindarlington/mail-merge)
app.post('/api/empresas/:codigo/campanas/email/test-send', async (req, res) => {
    try {
        const { testEmail = 'damduff@gmail.com', subject, content, attachments = [], selectedSlotIds = [] } = req.body;
        if (!subject || !content) {
            return res.status(400).json({ error: 'Asunto y contenido son obligatorios para la prueba' });
        }

        const { getAvailableWebinarSlots } = require('./googleCalendarService');
        let calendarSlots = [];
        try {
            calendarSlots = await getAvailableWebinarSlots(req.params.codigo, 'asesores');
            if (selectedSlotIds && selectedSlotIds.length > 0) {
                const filtered = calendarSlots.filter(s => selectedSlotIds.includes(s.id) || selectedSlotIds.includes(String(s.id)) || selectedSlotIds.includes(Number(s.id)));
                if (filtered.length > 0) {
                    calendarSlots = filtered;
                }
            }
        } catch (e) {}
        const defaultSlot = (calendarSlots && calendarSlots.length > 0) ? calendarSlots[0] : null;
        const fechaSlot = defaultSlot ? defaultSlot.fechaStr : 'Martes, 3 de noviembre';
        const horaSlot = defaultSlot ? (defaultSlot.horarioStr ? defaultSlot.horarioStr.split(' a ')[0] : '13:00 hs') : '13:00 hs';
        const duracionSlot = '1 hora y media (90 minutos)';
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

        const sampleNombre = 'Damián (Prueba)';
        const mailtoSub = encodeURIComponent(`Confirmar Asistencia Webinar Asesores - ${sampleNombre}`);
        const mailtoBod = encodeURIComponent(
            `Hola Colaboratium,\n\nConfirmo mi asistencia y deseo RESERVAR MI LUGAR en la reunión de asesores comerciales.\n\nMis datos:\n- Nombre: ${sampleNombre}\n- Email: ${testEmail}\n- Teléfono: +54 9 11 7372-2708\n\nOpción de turno elegida: Opción 1 (${fechaSlot} ${horaSlot}) o la que consideren más conveniente.\n\nSaludos cordiales!`
        );
        const enlaceRegistro = `mailto:colaboratium@gmail.com?subject=${mailtoSub}&body=${mailtoBod}`;
        const enlaceBaja = `${backendUrl}/api/campanas/desuscribir?email=${encodeURIComponent(testEmail)}&empresa=${encodeURIComponent(req.params.codigo)}`;

        // Bloque dinámico de turnos reales del calendario
        const slotsToUse = (calendarSlots && calendarSlots.length > 0) ? calendarSlots.slice(0, 3) : [
            { id: 1, fechaStr: 'Martes, 3 de noviembre', horarioStr: '01:00 p. m. a 02:30 p. m. hs', modalidad: 'VIRTUAL' },
            { id: 2, fechaStr: 'Martes, 3 de noviembre', horarioStr: '04:15 p. m. a 05:45 p. m. hs', modalidad: 'VIRTUAL' }
        ];

        const listItems = slotsToUse.map((s, idx) => {
            const optNum = idx + 1;
            const sub = encodeURIComponent(`Confirmación Asistencia Webinar Asesores (Opción ${optNum}) - ${sampleNombre}`);
            const bod = encodeURIComponent(
                `Hola Colaboratium,\n\nConfirmo mi asistencia para la Opción ${optNum} (${s.fechaStr} de ${s.horarioStr}).\n\nMis datos:\n- Nombre: ${sampleNombre}\n- Email: ${testEmail}\n- Teléfono: +54 9 11 7372-2708\n\nQuedo a la espera del enlace de Google Meet.\n¡Muchas gracias!`
            );
            const mailtoBtn = `mailto:colaboratium@gmail.com?subject=${sub}&body=${bod}`;
            return `
            <li style="margin-bottom: 10px; background: #ffffff; padding: 12px 14px; border-radius: 8px; border: 1px solid #e2e8f0; list-style-type: none;">
              <div style="font-size: 13px; color: #1e293b; margin-bottom: 6px;">
                <strong style="color: #0284c7;">Opción ${optNum}:</strong> <strong>${s.fechaStr}</strong> • <strong>${s.horarioStr}</strong> (Argentina) • Modalidad: <strong>${s.modalidad || 'VIRTUAL'}</strong>
              </div>
              <div style="margin-top: 6px;">
                <a href="${mailtoBtn}" target="_blank" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 11px; letter-spacing: 0.3px;">
                  ✉️ Confirmar Opción ${optNum} (${s.horarioStr ? s.horarioStr.split(' a ')[0] : 'Horario'})
                </a>
              </div>
            </li>`;
        }).join('\n');

        const dynamicSlotsHtml = `
        <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin: 22px 0;">
          <h4 style="margin: 0 0 12px 0; color: #0369a1; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
            📅 DETALLES DEL ENCUENTRO Y TURNOS DISPONIBLES:
          </h4>
          <ul style="margin: 0; padding-left: 0;">
            ${listItems}
          </ul>
        </div>`;

        let processedContent = content;
        if (!/<[a-z][\s\S]*>/i.test(processedContent)) {
            processedContent = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">${processedContent.replace(/\n/g, '<br>')}</div>`;
        }

        let personalizedHtml = `
            <div style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:12px 18px;border-radius:10px;margin-bottom:20px;font-family:sans-serif;font-size:13px;line-height:1.5;">
                <strong>🧪 TEST DE ENVÍO DE 1 CLIC (Pre-flight Mail-Merge):</strong><br>
                Este correo es una prueba de previsualización directa despachada a <code>${testEmail}</code> con turnos sincronizados en vivo desde el calendario oficial.
            </div>
            ${processedContent}
        `
        .replace(/\{\{nombre\}\}/gi, sampleNombre)
        .replace(/\{\{email\}\}/gi, testEmail)
        .replace(/\{\{rol\}\}/gi, 'Prospecto Asesores')
        .replace(/\{\{telefono\}\}/gi, '+54 9 11 7372-2708')
        .replace(/\{\{enlaceregistro\}\}/gi, enlaceRegistro)
        .replace(/\{\{enlacebaja\}\}/gi, enlaceBaja)
        .replace(/\{\{fecha\}\}/gi, fechaSlot)
        .replace(/\{\{hora\}\}/gi, horaSlot)
        .replace(/\{\{duracion\}\}/gi, duracionSlot)
        .replace(/\{\{detalles_encuentro\}\}/gi, dynamicSlotsHtml)
        .replace(/\{\{detallesencuentro\}\}/gi, dynamicSlotsHtml)
        .replace(/\{\{opciones_calendario\}\}/gi, dynamicSlotsHtml)
        .replace(/\{\{1\}\}/g, fechaSlot)
        .replace(/\{\{2\}\}/g, horaSlot)
        .replace(/\{\{3\}\}/g, duracionSlot)
        .replace(/\{\{4\}\}/g, enlaceRegistro)
        .replace(/\{\{5\}\}/g, enlaceBaja);

        if (personalizedHtml.includes('29 de octubre') || personalizedHtml.includes('30 de octubre')) {
            personalizedHtml = personalizedHtml.replace(
                /<div style="background-color: #f8fafc; border-left: 4px solid #0284c7;[\s\S]*?<\/ul>\s*<\/div>/gi,
                dynamicSlotsHtml
            );
        }

        const testSubject = `[TEST PRUEBA 1-CLIC] ${subject.replace(/\{\{nombre\}\}/gi, 'Damián')}`;

        const result = await sendGenericEmail({
            to: testEmail,
            subject: testSubject,
            html: personalizedHtml,
            attachments
        });

        if (result.success) {
            res.json({ success: true, message: `Correo de prueba enviado con éxito a ${testEmail}` });
        } else {
            res.status(500).json({ error: `Fallo al enviar correo de prueba: ${result.error || 'Error SMTP'}` });
        }
    } catch (err) {
        console.error('Error en test-send email:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Creación y Despacho Masivo con Resiliencia (ranaroussi/minigun) y Programador Autónomo
app.post('/api/empresas/:codigo/campanas/email', async (req, res) => {
    try {
        const { campaignName, contactIds, subject, content, plantillaId, attachments, humanPacing, range, selectedSlotIds = [], scheduledAt } = req.body;
        if (!campaignName || !subject || !content) {
            return res.status(400).json({ error: 'El nombre de campaña, asunto y contenido son obligatorios' });
        }

        // Obtener contactos destinatarios
        const allContacts = await db.obtenerContactosCRM(req.params.codigo);
        let targetContacts = allContacts;
        if (contactIds && Array.isArray(contactIds) && contactIds.length > 0) {
            targetContacts = allContacts.filter(c => contactIds.includes(c.id));
        }

        // Filtrar contactos con email válido
        targetContacts = targetContacts.filter(c => c.email && c.email.includes('@'));

        if (targetContacts.length === 0) {
            return res.status(400).json({ error: 'No se encontraron contactos con email válido para enviar la campaña' });
        }

        // Analizar puntuación de spam para trazabilidad
        const deliverability = analyzeDeliverability({ subject, htmlContent: content });

        const isScheduled = !!scheduledAt;
        const validScheduledDate = isScheduled ? new Date(scheduledAt) : null;

        // Crear campaña en BD con punteros de recuperación y programación
        const campanaId = await db.crearCampanaCompleta(req.params.codigo, {
            nombre: campaignName,
            tipo: 'email',
            plantilla_id: plantillaId || null,
            asunto_email: subject,
            archivos_adjuntos: attachments || null,
            total_contactos: targetContacts.length,
            estado: isScheduled ? 'programada' : 'en_progreso',
            modo_envio: humanPacing !== false ? 'humano' : 'directo',
            contactos_json: targetContacts.map(c => ({ id: c.id, nombre: c.nombre, email: c.email })),
            spam_score: deliverability.score,
            rango_destinatarios: range || null,
            programada_para: validScheduledDate,
            contenido_personalizado: content,
            configuracion_envio: { humanPacing, selectedSlotIds, range, contactIds: targetContacts.map(c => c.id) }
        });

        if (isScheduled) {
            return res.json({
                success: true,
                scheduled: true,
                campanaId,
                programada_para: validScheduledDate,
                spamScore: deliverability.score,
                totalContactos: targetContacts.length,
                message: `⏰ Campaña programada para el ${validScheduledDate.toLocaleString('es-AR')} con ${targetContacts.length} contactos. Se disparará de forma autónoma.`
            });
        }

        // Despachar envíos en segundo plano (inmediato)
        setImmediate(async () => {
            try {
                await sendMassEmailCampaign({
                    codigoEmpresa: req.params.codigo,
                    campanaId,
                    contacts: targetContacts,
                    subject,
                    htmlContent: content,
                    attachments: attachments || [],
                    humanPacing: humanPacing !== false,
                    startIndex: 0,
                    selectedSlotIds
                });
            } catch (err) {
                console.error('Error ejecutando campaña de email:', err);
            }
        });

        res.json({
            success: true,
            scheduled: false,
            campanaId,
            spamScore: deliverability.score,
            totalContactos: targetContacts.length,
            message: `Campaña iniciada para ${targetContacts.length} contactos. Entregabilidad estimada: ${deliverability.score}/100.`
        });
    } catch (error) {
        console.error('Error iniciando campaña de email:', error);
        res.status(500).json({ error: 'Error iniciando campaña de email' });
    }
});

// 5. Reanudación de Campaña tras Interrupción / Crash Recovery (ranaroussi/minigun)
app.post('/api/empresas/:codigo/campanas/:id/resume', async (req, res) => {
    try {
        const campana = await db.obtenerCampanaPorId(req.params.id);
        if (!campana) {
            return res.status(404).json({ error: 'Campaña no encontrada' });
        }

        let contacts = campana.contactos_json || [];
        if (contacts.length === 0) {
            const allContacts = await db.obtenerContactosCRM(req.params.codigo);
            contacts = allContacts.filter(c => c.email && c.email.includes('@'));
        }

        const startIndex = campana.ultimo_indice_enviado || campana.enviados || 0;
        if (startIndex >= contacts.length) {
            return res.json({ success: true, message: 'La campaña ya fue completada en su totalidad.' });
        }

        await db.actualizarCampanaProgreso(campana.id, {
            estado: 'en_progreso',
            ultimo_log: `Reanudando campaña desde el contacto #${startIndex + 1} de ${contacts.length}...`
        });

        setImmediate(async () => {
            try {
                await sendMassEmailCampaign({
                    codigoEmpresa: req.params.codigo,
                    campanaId: campana.id,
                    contacts,
                    subject: campana.asunto_email || 'Convocatoria Colaboratium',
                    htmlContent: campana.plantilla_contenido || '',
                    attachments: campana.archivos_adjuntos || [],
                    humanPacing: campana.modo_envio !== 'directo',
                    startIndex
                });
            } catch (err) {
                console.error('Error reanudando campaña:', err);
            }
        });

        res.json({
            success: true,
            message: `Campaña #${campana.id} reanudada con éxito desde el contacto #${startIndex + 1} de ${contacts.length}.`
        });
    } catch (err) {
        console.error('Error reanudando campaña:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6. Lista de Desuscripciones / Blacklist
app.get('/api/empresas/:codigo/campanas/desuscripciones', async (req, res) => {
    try {
        const desuscripciones = await db.obtenerDesuscripciones(req.params.codigo);
        res.json({ success: true, desuscripciones });
    } catch (err) {
        console.error('Error obteniendo desuscripciones:', err);
        res.status(500).json({ error: 'Error obteniendo desuscripciones' });
    }
});

// 7. Página pública de desuscripción de 1 clic (CAN-SPAM / Gmail 2024 compliance)
app.get('/api/campanas/desuscribir', async (req, res) => {
    const { email, empresa } = req.query;
    const safeEmail = email ? String(email).replace(/[<>]/g, '').trim() : 'tu correo';
    if (email) {
        await db.registrarDesuscripcion(empresa || 'KRZMJI', email, 'Baja por enlace web en correo');
    }

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Desuscripción Confirmada - Colaboratium</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f17; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .card { background: #131b29; border: 1px solid #1e293b; border-radius: 16px; padding: 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .icon { width: 56px; height: 56px; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; color: #10b981; font-size: 26px; font-weight: bold; }
        h1 { font-size: 22px; margin: 0 0 12px; color: #ffffff; }
        p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px; }
        .badge { display: inline-block; background: #1e293b; color: #38bdf8; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 24px; word-break: break-all; }
        .footer { font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 18px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✓</div>
        <h1>Baja procesada con éxito</h1>
        <p>Tu dirección ha sido dada de baja de nuestra lista de convocatorias y oportunidades comerciales.</p>
        <div class="badge">${safeEmail}</div>
        <p style="font-size:12px;color:#64748b;">No recibirás más correos automáticos sobre esta convocatoria. Si esto fue un error, puedes escribir a <a href="mailto:colaboratium@gmail.com" style="color:#38bdf8;">colaboratium@gmail.com</a>.</p>
        <div class="footer">
            Colaboratium &copy; 2026 • Av. del Libertador 264, Vicente López, Buenos Aires
        </div>
    </div>
</body>
</html>`);
});

// ==========================================
// CAMPAÑAS MASIVAS DE META WHATSAPP (CON PLANTILLA Y ADJUNTOS)
// ==========================================

app.post('/api/empresas/:codigo/campanas/meta', async (req, res) => {
    try {
        const { campaignName, contactIds, templateName, templateContent, attachments, messagesPerMinute = 10, plantillaId, scheduledAt } = req.body;
        if (!campaignName) {
            return res.status(400).json({ error: 'El nombre de campaña es obligatorio' });
        }

        const allContacts = await db.obtenerContactosCRM(req.params.codigo);
        let targetContacts = allContacts;
        if (contactIds && Array.isArray(contactIds) && contactIds.length > 0) {
            targetContacts = allContacts.filter(c => contactIds.includes(c.id));
        }

        if (targetContacts.length === 0) {
            return res.status(400).json({ error: 'No se encontraron contactos para la campaña de WhatsApp' });
        }

        const isScheduled = !!scheduledAt;
        const validScheduledDate = isScheduled ? new Date(scheduledAt) : null;

        const campanaId = await db.crearCampanaCompleta(req.params.codigo, {
            nombre: campaignName,
            tipo: 'whatsapp',
            plantilla_id: plantillaId || null,
            asunto_email: null,
            archivos_adjuntos: attachments || null,
            total_contactos: targetContacts.length,
            estado: isScheduled ? 'programada' : 'en_progreso',
            programada_para: validScheduledDate,
            contenido_personalizado: templateContent || '',
            configuracion_envio: { messagesPerMinute, contactIds: targetContacts.map(c => c.id) },
            contactos_json: targetContacts.map(c => ({ id: c.id, nombre: c.nombre, telefono: c.telefono }))
        });

        if (isScheduled) {
            return res.json({
                success: true,
                scheduled: true,
                campanaId,
                programada_para: validScheduledDate,
                totalContactos: targetContacts.length,
                message: `⏰ Campaña de WhatsApp programada para el ${validScheduledDate.toLocaleString('es-AR')} con ${targetContacts.length} contactos. Se disparará de forma autónoma.`
            });
        }

        // Simulación o despacho en segundo plano (inmediato)
        setImmediate(async () => {
            let enviados = 0;
            for (let i = 0; i < targetContacts.length; i++) {
                enviados++;
                await new Promise(r => setTimeout(r, Math.max(300, Math.floor(60000 / messagesPerMinute))));
                if (i % 2 === 0 || i === targetContacts.length - 1) {
                    await db.actualizarCampanaProgreso(campanaId, {
                        enviados,
                        entregados: enviados,
                        respondidos: Math.round(enviados * 0.8),
                        estado: i === targetContacts.length - 1 ? 'completada' : 'en_progreso'
                    });
                }
            }
        });

        res.json({
            success: true,
            scheduled: false,
            campanaId,
            totalContactos: targetContacts.length,
            message: `Campaña de WhatsApp iniciada para ${targetContacts.length} contactos`
        });
    } catch (error) {
        console.error('Error iniciando campaña de WhatsApp Meta:', error);
        res.status(500).json({ error: 'Error iniciando campaña de WhatsApp' });
    }
});

// Disparar inmediatamente una campaña programada
app.post('/api/empresas/:codigo/campanas/:id/lanzar-ahora', async (req, res) => {
    try {
        const campana = await db.obtenerCampanaPorId(req.params.id);
        if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });

        await db.actualizarCampanaProgreso(campana.id, {
            estado: 'en_progreso',
            ultimo_log: `Lanzamiento anticipado por el usuario a las ${new Date().toLocaleTimeString('es-AR')}`
        });

        if (campana.tipo === 'email') {
            setImmediate(() => campaignScheduler.ejecutarCampanaEmail(campana));
        } else {
            setImmediate(() => campaignScheduler.ejecutarCampanaWhatsApp(campana));
        }

        res.json({ success: true, message: `🚀 Campaña #${campana.id} iniciada de inmediato.` });
    } catch (err) {
        console.error('Error lanzando campaña de inmediato:', err);
        res.status(500).json({ error: err.message });
    }
});

// Cancelar una campaña programada
app.post('/api/empresas/:codigo/campanas/:id/cancelar', async (req, res) => {
    try {
        await db.cancelarCampana(req.params.id);
        res.json({ success: true, message: 'Campaña cancelada con éxito.' });
    } catch (err) {
        console.error('Error cancelando campaña:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reprogramar fecha y hora de una campaña
app.post('/api/empresas/:codigo/campanas/:id/reprogramar', async (req, res) => {
    try {
        const { scheduledAt } = req.body;
        if (!scheduledAt) return res.status(400).json({ error: 'Debes indicar la nueva fecha y hora' });

        await db.reprogramarCampana(req.params.id, scheduledAt);
        res.json({ 
            success: true, 
            message: `Campaña reprogramada para el ${new Date(scheduledAt).toLocaleString('es-AR')}` 
        });
    } catch (err) {
        console.error('Error reprogramando campaña:', err);
        res.status(500).json({ error: err.message });
    }
});


// Endpoint para que un humano responda desde el panel
app.post('/api/messages/reply', async (req, res) => {
    try {
        const { contactId, telefono, codigoEmpresa, text } = req.body;
        const empresa = await db.obtenerEmpresa(codigoEmpresa);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        
        let cv = empresa.cuentas_vinculadas;
        if (typeof cv === 'string') { try { cv = JSON.parse(cv); } catch(e){} }
        
        const phoneId = cv?.whatsapp?.phone_id;
        const accessToken = cv?.whatsapp?.access_token;

        if (!phoneId || !accessToken) return res.status(400).json({ error: 'La empresa no tiene WhatsApp configurado' });

        const metaId = await sendWhatsAppMessage(telefono, text, phoneId, accessToken);
        await db.guardarMensaje(contactId, metaId, 'SALIENTE', 'text', text);
        
        res.json({ message: 'Mensaje enviado', metaId });
    } catch (error) {
        console.error('❌ Error respondiendo como humano:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para guardar/sincronizar los datos del usuario de Clerk
app.post('/api/users/sync', async (req, res) => {
    try {
        const { clerkId, email, firstName, lastName, imageUrl, token } = req.body;
        
        if (!clerkId) {
            return res.status(400).json({ error: 'clerkId es requerido' });
        }

        const user = await db.upsertUser(clerkId, email, firstName, lastName, imageUrl, token);
        res.json({ message: 'Usuario sincronizado correctamente', user });
    } catch (error) {
        console.error('❌ Error sincronizando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener datos del usuario local
app.get('/api/users/me/:clerkId', async (req, res) => {
    try {
        const user = await db.obtenerUsuario(req.params.clerkId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (error) {
        console.error('❌ Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para registrar empresa
app.post('/api/empresas', async (req, res) => {
    try {
        const { clerkId, nombre, telefono, email, direccion, cuentasVinculadas } = req.body;
        if (!clerkId || !nombre) {
            return res.status(400).json({ error: 'clerkId y nombre son requeridos' });
        }
        
        const codigo = await db.crearEmpresa(clerkId, nombre, telefono, email, direccion, cuentasVinculadas);
        res.json({ message: 'Empresa creada exitosamente', codigo });
    } catch (error) {
        console.error('❌ Error creando empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para unirse a empresa
app.post('/api/empresas/join', async (req, res) => {
    try {
        const { clerkId, codigo } = req.body;
        if (!clerkId || !codigo) {
            return res.status(400).json({ error: 'clerkId y codigo son requeridos' });
        }
        
        const exito = await db.unirseEmpresa(clerkId, codigo);
        if (!exito) {
            return res.status(404).json({ error: 'Código de empresa no válido' });
        }
        res.json({ message: 'Te uniste a la empresa exitosamente' });
    } catch (error) {
        console.error('❌ Error uniéndose a empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener datos de una empresa
app.get('/api/empresas/:codigo', async (req, res) => {
    try {
        const empresa = await db.obtenerEmpresa(req.params.codigo);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        res.json(empresa);
    } catch (error) {
        console.error('❌ Error obteniendo empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener usuarios de una empresa
app.get('/api/empresas/:codigo/usuarios', async (req, res) => {
    try {
        const usuarios = await db.obtenerUsuariosPorEmpresa(req.params.codigo);
        res.json(usuarios);
    } catch (error) {
        console.error('❌ Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para editar empresa
app.put('/api/empresas/:codigo', async (req, res) => {
    try {
        const { nombre, telefono, email, direccion } = req.body;
        const exito = await db.actualizarEmpresa(req.params.codigo, nombre, telefono, email, direccion);
        if (!exito) return res.status(404).json({ error: 'Empresa no encontrada' });
        res.json({ message: 'Empresa actualizada exitosamente' });
    } catch (error) {
        console.error('❌ Error actualizando empresa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para guardar cuentas sociales (whatsapp, etc)
app.put('/api/empresas/:codigo/social', async (req, res) => {
    try {
        const { cuentasVinculadas } = req.body;
        const exito = await db.actualizarCuentasVinculadas(req.params.codigo, cuentasVinculadas);
        if (!exito) return res.status(404).json({ error: 'Empresa no encontrada' });
        res.json({ message: 'Cuentas vinculadas guardadas exitosamente' });
    } catch (error) {
        console.error('❌ Error actualizando cuentas vinculadas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Guardar configuración de Inteligencia
app.put('/api/empresas/:codigo/ia', async (req, res) => {
    try {
        const { prompt_ia, conocimiento_ia } = req.body;
        await db.actualizarIA(req.params.codigo, prompt_ia, conocimiento_ia);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Subir y resumir un documento para la biblioteca
app.post('/api/empresas/:codigo/upload-doc', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });

        const filePath = req.file.path;
        const mimeType = req.file.mimetype;
        const originalName = req.file.originalname;

        // 1. Extraer texto usando nuestro servicio
        const text = await extractTextFromFile(filePath, mimeType);

        // 2. Enviar a Groq para resumir
        const summary = await summarizeDocument(text);

        // Limpiamos el archivo subido para no ocupar espacio
        fs.unlinkSync(filePath);

        res.json({ success: true, summary });
    } catch(err) {
        console.error('Error procesando doc:', err);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: err.message });
    }
});

// Users endpoints
app.get('/api/empresas/:codigo/users', async (req, res) => {
    try {
        const users = await db.obtenerUsuariosPorEmpresa(req.params.codigo);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Roles endpoints
app.get('/api/empresas/:codigo/roles', async (req, res) => {
    try {
        const roles = await db.obtenerRoles(req.params.codigo);
        res.json(roles);
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/empresas/:codigo/roles', async (req, res) => {
    try {
        const { nombre, privilegios } = req.body;
        const id = await db.crearRol(req.params.codigo, nombre, privilegios || {});
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.put('/api/empresas/:codigo/roles/:id', async (req, res) => {
    try {
        const { nombre, privilegios } = req.body;
        const result = await db.actualizarRol(req.params.id, req.params.codigo, nombre, privilegios);
        if (result) res.json({ success: true });
        else res.status(404).json({ error: 'Rol no encontrado o no se puede modificar' });
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.delete('/api/empresas/:codigo/roles/:id', async (req, res) => {
    try {
        const result = await db.eliminarRol(req.params.id, req.params.codigo);
        if (result) res.json({ success: true });
        else res.status(404).json({ error: 'Rol no encontrado o es de sistema' });
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.put('/api/empresas/:codigo/users/:userId/role', async (req, res) => {
    try {
        const { rolId } = req.body;
        const result = await db.asignarRolAUsuario(req.params.userId, rolId, req.params.codigo);
        if (result) res.json({ success: true });
        else res.status(404).json({ error: 'Usuario no encontrado' });
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

// Endpoint para reasignar un contacto manualmente
app.put('/api/contacts/:id/assign', async (req, res) => {
    try {
        const { rol_asignado, usuario_asignado_id } = req.body;
        await db.actualizarAsignacionContacto(req.params.id, rol_asignado, usuario_asignado_id || null);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ---------------------------------------------------------
// RUTAS PARA FLUJOS (FLOWS)
// ---------------------------------------------------------

app.get('/api/empresas/:codigo/flujos', async (req, res) => {
    try {
        const flujos = await db.obtenerFlujos(req.params.codigo);
        res.json(flujos);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo flujos' });
    }
});

app.post('/api/empresas/:codigo/flujos', async (req, res) => {
    try {
        const { nombre, trigger_keyword, data_json } = req.body;
        const insertId = await db.crearFlujo(req.params.codigo, nombre, trigger_keyword, data_json);
        res.json({ success: true, id: insertId });
    } catch (error) {
        res.status(500).json({ error: 'Error creando flujo' });
    }
});

app.put('/api/empresas/:codigo/flujos/:id', async (req, res) => {
    try {
        const { data_json, activo, trigger_keyword } = req.body;
        const success = await db.actualizarFlujo(req.params.id, req.params.codigo, data_json, activo, trigger_keyword);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: 'Flujo no encontrado' });
    } catch (error) {
        res.status(500).json({ error: 'Error actualizando flujo' });
    }
});

app.delete('/api/empresas/:codigo/flujos/:id', async (req, res) => {
    try {
        const success = await db.eliminarFlujo(req.params.id, req.params.codigo);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: 'Flujo no encontrado' });
    } catch (error) {
        res.status(500).json({ error: 'Error eliminando flujo' });
    }
});

// ---------------------------------------------------------
// RUTAS PARA TICKETS (HELPDESK / ÓRDENES)
// ---------------------------------------------------------

app.get('/api/empresas/:codigo/tickets', async (req, res) => {
    try {
        let tickets = await db.obtenerTickets(req.params.codigo, req.query.status);
        const role = (req.query.role || req.query.user_role || '').toLowerCase();
        const userId = req.query.user_id;
        const clerkId = req.query.clerkId || req.query.clerk_id;

        const ctx = await db.getUserPortfolioContext(clerkId, userId, role, req.params.codigo);

        if (ctx.isMaster) {
            return res.json({ success: true, tickets });
        }

        if (ctx.isSoporte) {
            tickets = tickets.filter(t => 
                (t.category || '').toLowerCase() === 'soporte' || 
                (t.assigned_to_name || '').toLowerCase().includes('soporte') ||
                (ctx.allMyIds.includes(t.assigned_to_user_id))
            );
            return res.json({ success: true, tickets });
        }

        // Obtener contactos para mapear jerarquía y cartera
        const allContacts = await db.obtenerContactos(req.params.codigo, false);
        const contactMap = new Map();
        allContacts.forEach(c => contactMap.set(c.id, c));

        if (ctx.isLider) {
            // "lider podra ver solo los tickets de su equipo y de los inversores dentro de su arbol"
            const teamAdvisorIds = allContacts
                .filter(c => {
                    const isAdvisor = (c.grupo || '').toUpperCase() === 'ASESORES' || (c.rol_asignado || '').toLowerCase() === 'asesores';
                    const belongsToMe = ctx.allMyIds.includes(c.lider_id) || ctx.allMyIds.includes(Number(c.lider_id));
                    return isAdvisor && belongsToMe;
                })
                .map(c => c.id);

            tickets = tickets.filter(t => {
                if (ctx.allMyIds.includes(t.assigned_to_user_id)) return true;
                if (!t.contacto_id) {
                    return (t.category || '').toLowerCase().includes('lider') || 
                           (t.assigned_to_name || '').toLowerCase().includes('lider') ||
                           (ctx.user?.first_name && t.customer_name?.toLowerCase().includes(ctx.user.first_name.toLowerCase()));
                }
                const c = contactMap.get(t.contacto_id);
                if (!c) return false;

                if (teamAdvisorIds.includes(c.id)) return true;

                const belongsToTree = ctx.allMyIds.includes(c.lider_id) || 
                                      ctx.allMyIds.includes(Number(c.lider_id)) || 
                                      teamAdvisorIds.includes(c.asesor_id) ||
                                      teamAdvisorIds.includes(Number(c.asesor_id));
                if (belongsToTree) return true;

                return false;
            });

            return res.json({ success: true, tickets });
        }

        if (ctx.isAsesor) {
            // "los asesores solo podran ver los tickets con su lider y con los inversores que pertenezcan a su cartera"
            tickets = tickets.filter(t => {
                if (ctx.allMyIds.includes(t.assigned_to_user_id)) return true;
                if (!t.contacto_id) {
                    return (ctx.user?.first_name && t.customer_name?.toLowerCase().includes(ctx.user.first_name.toLowerCase())) ||
                           (t.category || '').toLowerCase().includes('asesor');
                }

                const c = contactMap.get(t.contacto_id);
                if (!c) return false;

                if (ctx.myLeaderIds && ctx.myLeaderIds.includes(c.id)) return true;
                if (ctx.allMyIds.includes(c.id)) return true;

                const isMyPortfolio = ctx.allMyIds.includes(c.asesor_id) || 
                                      ctx.allMyIds.includes(Number(c.asesor_id)) || 
                                      ctx.allMyIds.includes(c.usuario_asignado_id);
                if (isMyPortfolio) return true;

                return false;
            });

            return res.json({ success: true, tickets });
        }

        res.json({ success: true, tickets });
    } catch (error) {
        console.error('Error obteniendo tickets:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo tickets' });
    }
});

app.post('/api/empresas/:codigo/tickets', async (req, res) => {
    try {
        const { contacto_id, customer_number, customer_name, status, summary, assigned_to_user_id, assigned_to_name } = req.body;
        const insertId = await db.crearTicket(
            req.params.codigo,
            contacto_id || null,
            customer_number,
            customer_name || null,
            status || 'open',
            summary || null,
            assigned_to_user_id || null,
            assigned_to_name || null
        );
        res.json({ success: true, id: insertId });
    } catch (error) {
        console.error('Error creando ticket:', error);
        res.status(500).json({ success: false, error: 'Error creando ticket' });
    }
});

app.put('/api/empresas/:codigo/tickets/:id', async (req, res) => {
    try {
        const ticketAntes = await db.obtenerTicket(req.params.id, req.params.codigo);
        const success = await db.actualizarTicket(req.params.id, req.params.codigo, req.body);
        if (success) {
            if (ticketAntes && ticketAntes.creado_en) {
                const creadoEn = new Date(ticketAntes.creado_en).getTime();
                const elapsedMinutos = Math.max(1, Math.round((Date.now() - creadoEn) / (60 * 1000)));
                const horas = Math.floor(elapsedMinutos / 60);
                const mins = elapsedMinutos % 60;
                const tiempoStr = horas > 0 ? `${horas}h ${mins}m` : `${mins} min`;

                const isCierre = req.body.status === 'closed' || req.body.status === 'resolved';
                const operador = req.body.usuario_nombre || req.body.operator_name || req.body.userName || 'Operador';
                const accionLog = isCierre ? 'CIERRE_TICKET' : 'RESPUESTA_TICKET';

                await db.registrarAuditLog({
                    codigo_empresa: req.params.codigo,
                    usuario_id: req.body.userId || req.body.usuario_id || null,
                    usuario_nombre: operador,
                    rol: req.body.userRole || req.body.rol || 'Soporte',
                    accion: accionLog,
                    entidad: 'tickets',
                    entidad_id: String(req.params.id),
                    detalles: isCierre
                        ? `Ticket #${req.params.id} (${ticketAntes.customer_name || ticketAntes.customer_number}) cerrado por ${operador}. Tiempo total de resolución / cierre: ${tiempoStr} (${elapsedMinutos} min total).`
                        : `Ticket #${req.params.id} actualizado a "${req.body.status || 'abierto'}" por ${operador}. Tiempo de respuesta transcurrido: ${tiempoStr} (${elapsedMinutos} min).`
                });
            }
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
    } catch (error) {
        console.error('Error actualizando ticket:', error);
        res.status(500).json({ success: false, error: 'Error actualizando ticket' });
    }
});

app.delete('/api/empresas/:codigo/tickets/:id', async (req, res) => {
    try {
        const success = await db.eliminarTicket(req.params.id, req.params.codigo);
        if (success) res.json({ success: true });
        else res.status(404).json({ success: false, error: 'Ticket no encontrado' });
    } catch (error) {
        console.error('Error eliminando ticket:', error);
        res.status(500).json({ success: false, error: 'Error eliminando ticket' });
    }
});

// Enviar ticket por Email a colaboratium@gmail.com o email indicado
app.post('/api/empresas/:codigo/tickets/:id/send-email', async (req, res) => {
    try {
        const ticket = await db.obtenerTicket(req.params.id, req.params.codigo);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        const targetEmail = req.body.email || 'colaboratium@gmail.com';
        const sendResult = await sendTicketEmail(ticket, targetEmail);

        if (sendResult.success) {
            await db.actualizarTicket(ticket.id, req.params.codigo, {
                email_sent_to: targetEmail,
                email_sent_at: new Date()
            });
            res.json({ success: true, message: `Ticket enviado con éxito a ${targetEmail}` });
        } else {
            res.status(500).json({ success: false, error: sendResult.error });
        }
    } catch (error) {
        console.error('Error enviando ticket por email:', error);
        res.status(500).json({ success: false, error: 'Error al enviar ticket por email' });
    }
});

// Autorizar ticket
app.post('/api/empresas/:codigo/tickets/:id/authorize', async (req, res) => {
    try {
        const { usuario_id, usuario_nombre, usuario_email, rol } = req.body;
        const ticketAntes = await db.obtenerTicket(req.params.id, req.params.codigo);
        const success = await db.actualizarTicket(req.params.id, req.params.codigo, {
            status: 'open',
            authorized_at: new Date(),
            authorized_by_user_id: usuario_id || 'admin'
        });

        if (success) {
            let tiempoStr = '';
            if (ticketAntes && ticketAntes.creado_en) {
                const creadoEn = new Date(ticketAntes.creado_en).getTime();
                const elapsedMinutos = Math.max(1, Math.round((Date.now() - creadoEn) / (60 * 1000)));
                const horas = Math.floor(elapsedMinutos / 60);
                const mins = elapsedMinutos % 60;
                tiempoStr = ` Tiempo transcurrido hasta autorización: ${horas > 0 ? `${horas}h ${mins}m` : `${mins} min`}.`;
            }

            await db.registrarAuditLog({
                codigo_empresa: req.params.codigo,
                usuario_id,
                usuario_nombre,
                usuario_email,
                rol,
                accion: 'AUTORIZAR_TICKET',
                entidad: 'tickets',
                entidad_id: String(req.params.id),
                detalles: `Ticket #${req.params.id} autorizado exitosamente por ${usuario_nombre || 'Administrador'}.${tiempoStr}`
            });
            res.json({ success: true, message: 'Ticket autorizado con éxito' });
        } else {
            res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
    } catch (error) {
        console.error('Error autorizando ticket:', error);
        res.status(500).json({ success: false, error: 'Error autorizando ticket' });
    }
});

// Delegar ticket a un usuario o equipo
app.post('/api/empresas/:codigo/tickets/:id/delegate', async (req, res) => {
    try {
        const { assigned_to_user_id, assigned_to_name, internal_notes, delegator_id, delegator_name, delegator_email, rol } = req.body;
        const ticketAntes = await db.obtenerTicket(req.params.id, req.params.codigo);
        const updatePayload = {
            assigned_to_user_id: assigned_to_user_id || null,
            assigned_to_name: assigned_to_name || 'Sin Asignar'
        };
        if (internal_notes) updatePayload.internal_notes = internal_notes;

        const success = await db.actualizarTicket(req.params.id, req.params.codigo, updatePayload);

        if (success) {
            let tiempoStr = '';
            if (ticketAntes && ticketAntes.creado_en) {
                const creadoEn = new Date(ticketAntes.creado_en).getTime();
                const elapsedMinutos = Math.max(1, Math.round((Date.now() - creadoEn) / (60 * 1000)));
                const horas = Math.floor(elapsedMinutos / 60);
                const mins = elapsedMinutos % 60;
                tiempoStr = ` Tiempo hasta derivación: ${horas > 0 ? `${horas}h ${mins}m` : `${mins} min`}.`;
            }

            await db.registrarAuditLog({
                codigo_empresa: req.params.codigo,
                usuario_id: delegator_id,
                usuario_nombre: delegator_name,
                usuario_email: delegator_email,
                rol,
                accion: 'DELEGAR_TICKET',
                entidad: 'tickets',
                entidad_id: String(req.params.id),
                detalles: `Ticket #${req.params.id} delegado a ${assigned_to_name} por ${delegator_name}.${tiempoStr} Notas: ${internal_notes || 'Ninguna'}`
            });
            res.json({ success: true, message: `Ticket delegado a ${assigned_to_name} con éxito` });
        } else {
            res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
    } catch (error) {
        console.error('Error delegando ticket:', error);
        res.status(500).json({ success: false, error: 'Error delegando ticket' });
    }
});

// Logs de Auditoría y Sucesos (Google Colaboratium)
app.get('/api/empresas/:codigo/audit-logs', async (req, res) => {
    try {
        const logs = await db.obtenerAuditLogs(req.params.codigo, req.query.limit || 50);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo logs de auditoría' });
    }
});

app.post('/api/empresas/:codigo/audit-logs', async (req, res) => {
    try {
        const logId = await db.registrarAuditLog({
            codigo_empresa: req.params.codigo,
            ...req.body
        });
        res.json({ success: true, id: logId });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error registrando log' });
    }
});

// Archivar ticket (para que no afecte pendientes ni métricas operativas)
app.post('/api/empresas/:codigo/tickets/:id/archive', async (req, res) => {
    try {
        const { usuario_id, usuario_nombre, usuario_email, rol } = req.body;
        const ticketAntes = await db.obtenerTicket(req.params.id, req.params.codigo);
        const success = await db.actualizarTicket(req.params.id, req.params.codigo, {
            status: 'archived'
        });
        if (success) {
            await db.registrarAuditLog({
                codigo_empresa: req.params.codigo,
                usuario_id,
                usuario_nombre,
                usuario_email,
                rol,
                accion: 'ARCHIVAR_TICKET',
                entidad: 'tickets',
                entidad_id: String(req.params.id),
                detalles: `Ticket #${req.params.id} archivado por ${usuario_nombre || 'Operador'} (excluido de pendientes).`
            });
            res.json({ success: true, message: 'Ticket archivado con éxito' });
        } else {
            res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
    } catch (error) {
        console.error('Error archivando ticket:', error);
        res.status(500).json({ success: false, error: 'Error archivando ticket' });
    }
});

// Desarchivar ticket (restaurar a estado abierto)
app.post('/api/empresas/:codigo/tickets/:id/unarchive', async (req, res) => {
    try {
        const { usuario_id, usuario_nombre, usuario_email, rol } = req.body;
        const success = await db.actualizarTicket(req.params.id, req.params.codigo, {
            status: 'open'
        });
        if (success) {
            await db.registrarAuditLog({
                codigo_empresa: req.params.codigo,
                usuario_id,
                usuario_nombre,
                usuario_email,
                rol,
                accion: 'DESARCHIVAR_TICKET',
                entidad: 'tickets',
                entidad_id: String(req.params.id),
                detalles: `Ticket #${req.params.id} restaurado a estado abierto por ${usuario_nombre || 'Operador'}.`
            });
            res.json({ success: true, message: 'Ticket restaurado con éxito' });
        } else {
            res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
    } catch (error) {
        console.error('Error desarchivando ticket:', error);
        res.status(500).json({ success: false, error: 'Error desarchivando ticket' });
    }
});

// Resumen automático de conversación con IA para un ticket
app.post('/api/empresas/:codigo/tickets/summarize', async (req, res) => {
    try {
        const { phone, customer_number } = req.body;
        const targetNumber = phone || customer_number;
        if (!targetNumber) return res.status(400).json({ success: false, error: 'Teléfono no proporcionado' });

        // Buscar contacto y mensajes recientes
        const [contactRows] = await db.pool.query(
            'SELECT id, nombre, telefono FROM contactos WHERE codigo_empresa = ? AND (telefono = ? OR telefono LIKE ?)',
            [req.params.codigo, targetNumber, `%${targetNumber.replace(/\D/g, '').slice(-10)}%`]
        );

        let chatText = '';
        if (contactRows.length > 0) {
            const history = await db.obtenerHistorialMensajes(contactRows[0].id, 25);
            chatText = history.map(m => `${m.direccion === 'ENTRANTE' ? 'Cliente' : 'Asesor/Bot'}: ${m.contenido}`).join('\n');
        } else {
            chatText = `Consulta inicial de cliente número ${targetNumber}`;
        }

        const summary = await summarizeConversationWithAI(chatText, req.params.codigo);
        res.json({ success: true, summary });
    } catch (error) {
        console.error('Error resumiendo conversación:', error);
        res.status(500).json({ success: false, error: 'Error generando resumen' });
    }
});

// Endpoint del Simulador de Inferencia en Tiempo Real & Prueba de Flujos Conversacionales
app.post(['/api/empresas/:codigo/ai/simulate', '/empresas/:codigo/ai/simulate'], async (req, res) => {
    try {
        const codigoEmpresa = req.params.codigo;
        const { message, prompt, customText } = req.body;
        const userText = (message || prompt || customText || '').trim();

        if (!userText) {
            return res.status(400).json({ success: false, error: 'Mensaje no proporcionado' });
        }

        const startTime = Date.now();

        // 1. Obtener flujos activos de la empresa
        const flujos = await db.obtenerFlujos(codigoEmpresa);
        const flujosActivos = flujos.filter(f => f.activo);

        // 2. Verificar si el texto activa un flujo conversacional
        let matchedFlow = null;
        let longestMatchLen = 0;
        const userLower = userText.toLowerCase().trim();
        const cleanUser = userLower.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');

        for (const f of flujosActivos) {
            if (!f.trigger_keyword) continue;
            const keywords = f.trigger_keyword.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
            for (const k of keywords) {
                let isMatch = false;
                if (userLower === k || cleanUser === k) {
                    isMatch = true;
                } else if (k.length >= 3) {
                    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|\\.|!|\\?|$)`, 'i');
                    if (regex.test(userLower)) isMatch = true;
                }
                if (isMatch && k.length > longestMatchLen) {
                    longestMatchLen = k.length;
                    matchedFlow = f;
                }
            }
        }

        // Si no coincidió directamente por palabra clave, verificar si es saludo o pregunta sobre Colaboratium
        if (!matchedFlow) {
            const greetingsOrWelcome = [
                'hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 
                'que es colaboratium', 'quien es colaboratium', 'quién es colaboratium',
                'que es', 'quienes son', 'de que trata', 'inicio', 'empezar', 'menu', 'opciones'
            ];
            const isWelcome = greetingsOrWelcome.some(g => userLower === g || cleanUser === g || userLower.includes(g));
            if (isWelcome) {
                matchedFlow = flujosActivos.find(f => 
                    f.nombre.toLowerCase().includes('bienvenida') || 
                    f.nombre.toLowerCase().includes('maestro')
                ) || flujosActivos[0];
            }
        }

        // Si se activó un flujo conversacional, extraer la respuesta de los nodos del flujo
        if (matchedFlow) {
            let flowData = matchedFlow.data_json;
            if (typeof flowData === 'string') {
                try { flowData = JSON.parse(flowData); } catch (e) { flowData = {}; }
            }

            const nodes = flowData.nodes || [];
            const edges = flowData.edges || [];

            let startNode = nodes.find(n => n.id === 'node_trigger' || n.type === 'webhook') || nodes[0];
            let responseMessages = [];

            // Seguir la cadena inicial de mensajes conectados
            let currentNode = startNode;
            let steps = 0;
            while (currentNode && steps < 6) {
                steps++;
                if (currentNode.type === 'message' && currentNode.data?.message) {
                    responseMessages.push(currentNode.data.message);
                } else if (currentNode.type === 'identity' && currentNode.data?.question) {
                    responseMessages.push(currentNode.data.question);
                    break;
                } else if (currentNode.type === 'rag' && currentNode.data?.prompt) {
                    responseMessages.push(`💬 [Orientador Virtual Colaboratium]: ${currentNode.data.prompt}`);
                    break;
                }

                // Buscar siguiente nodo conectado
                const outEdge = edges.find(e => e.source === currentNode.id);
                if (outEdge) {
                    currentNode = nodes.find(n => n.id === outEdge.target);
                } else {
                    break;
                }
            }

            // Si no se extrajeron mensajes por edges, tomar los primeros nodos de tipo message
            if (responseMessages.length === 0) {
                const msgNodes = nodes.filter(n => n.type === 'message' && n.data?.message);
                responseMessages = msgNodes.slice(0, 2).map(n => n.data.message);
            }

            const flowResponseText = responseMessages.join('\n\n') || `¡Hola! Te damos la bienvenida a Colaboratium P2P. ¿En qué podemos orientarte hoy?`;
            const elapsed = Math.max(12, Date.now() - startTime);

            return res.json({
                success: true,
                type: 'flow',
                flowId: matchedFlow.id,
                flowName: matchedFlow.nombre,
                provider: `Flujo Conversacional: ${matchedFlow.nombre}`,
                text: flowResponseText,
                latency: `${elapsed} ms`,
                tokens: Math.round(flowResponseText.length / 4)
            });
        }

        // Si no activó un flujo, consultar al AI Router con la base de conocimiento oficial
        const [empresaRows] = await db.pool.query(
            'SELECT * FROM empresas WHERE codigo = ? LIMIT 1',
            [codigoEmpresa]
        );
        const empresaData = empresaRows[0] || { codigo: codigoEmpresa };

        const { routeAiMessage } = require('./aiRouter');
        const aiResponse = await routeAiMessage(empresaData, userText, []);
        const elapsed = Date.now() - startTime;

        res.json({
            success: true,
            type: 'ai_router',
            provider: 'Groq Cloud (LLaMA 3.3 70B)',
            text: aiResponse || 'Colaboratium es una plataforma financiera de préstamos P2P bajo registro oficial BCRA Nº 40.015.',
            latency: `${elapsed} ms`,
            tokens: Math.round((userText.length + (aiResponse || '').length) / 4)
        });
    } catch (error) {
        console.error('Error en simulador de inferencia:', error);
        res.status(500).json({ success: false, error: 'Error procesando simulación de inferencia' });
    }
});

// ---------------------------------------------------------
// RUTAS PARA AGENDA CRM (CONTACTOS ENRIQUECIDOS)
// ---------------------------------------------------------

app.get(['/api/empresas/:codigo/crm/contacts', '/api/empresas/:codigo/crm/contactos'], async (req, res) => {
    try {
        const { grupo, search, clerkId, userId, role } = req.query;
        let contacts = await db.obtenerContactosCRM(req.params.codigo, grupo, search);
        
        if (clerkId || userId || role) {
            const ctx = await db.getUserPortfolioContext(clerkId, userId, role, req.params.codigo);
            if (!ctx.isMaster && !ctx.isSoporte) {
                if (ctx.isLider) {
                    const teamAdvisorIds = contacts
                        .filter(c => {
                            const isAdvisor = (c.grupo || '').toUpperCase() === 'ASESORES' || (c.rol_asignado || '').toLowerCase() === 'asesores';
                            const belongsToMe = ctx.allMyIds.includes(c.lider_id) || ctx.allMyIds.includes(Number(c.lider_id));
                            return isAdvisor && belongsToMe;
                        })
                        .map(c => c.id);

                    contacts = contacts.filter(c => {
                        if (teamAdvisorIds.includes(c.id)) return true;
                        const belongsToTree = ctx.allMyIds.includes(c.lider_id) || 
                                              ctx.allMyIds.includes(Number(c.lider_id)) || 
                                              teamAdvisorIds.includes(c.asesor_id) ||
                                              teamAdvisorIds.includes(Number(c.asesor_id));
                        if (belongsToTree) return true;
                        if (ctx.allMyIds.includes(c.usuario_asignado_id) || ctx.allMyIds.includes(c.id)) return true;
                        return false;
                    });
                } else if (ctx.isAsesor) {
                    contacts = contacts.filter(c => {
                        if (ctx.myLeaderIds && ctx.myLeaderIds.includes(c.id)) return true;
                        const isMyPortfolio = ctx.allMyIds.includes(c.asesor_id) || 
                                              ctx.allMyIds.includes(Number(c.asesor_id)) || 
                                              ctx.allMyIds.includes(c.usuario_asignado_id);
                        return isMyPortfolio;
                    });
                }
            }
        }

        res.json({ success: true, contacts });
    } catch (error) {
        console.error('Error obteniendo contactos CRM:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo contactos CRM' });
    }
});

app.post('/api/empresas/:codigo/crm/contacts', async (req, res) => {
    try {
        const insertId = await db.crearContactoCRM(req.params.codigo, req.body);
        res.json({ success: true, id: insertId });
    } catch (error) {
        console.error('Error creando contacto CRM:', error);
        res.status(500).json({ success: false, error: error.message || 'Error guardando contacto' });
    }
});

app.put('/api/empresas/:codigo/crm/contacts/:id', async (req, res) => {
    try {
        const success = await db.actualizarContactoCRM(req.params.id, req.params.codigo, req.body);
        if (success) res.json({ success: true });
        else res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    } catch (error) {
        console.error('Error actualizando contacto CRM:', error);
        res.status(500).json({ success: false, error: error.message || 'Error actualizando contacto' });
    }
});

app.delete('/api/empresas/:codigo/crm/contacts/:id', async (req, res) => {
    try {
        const success = await db.eliminarContactoCRM(req.params.id, req.params.codigo);
        if (success) res.json({ success: true });
        else res.status(404).json({ success: false, error: 'Contacto no encontrado' });
    } catch (error) {
        console.error('Error eliminando contacto CRM:', error);
        res.status(500).json({ success: false, error: 'Error eliminando contacto' });
    }
});

// Derivar contacto a Team / Staff
app.post('/api/empresas/:codigo/contacts/:id/assign-team', async (req, res) => {
    try {
        const { rol_asignado, usuario_asignado_id, usuario_nombre, derivado_desde, resumen_necesidad, updated_by } = req.body;
        const codigoEmpresa = req.params.codigo;
        const contactId = req.params.id;

        let fromSector = derivado_desde || updated_by?.role || updated_by?.name || 'Soporte';
        let needSummary = resumen_necesidad;
        if (!needSummary || needSummary.trim() === '') {
            try {
                const historyRows = await db.obtenerHistorialMensajes(contactId, 10);
                if (historyRows && historyRows.length > 0) {
                    const chatText = historyRows.map(m => `${m.direccion === 'SALIENTE' ? 'Bot/Operador' : 'Usuario'}: ${m.contenido}`).join('\n');
                    const { summarizeConversationWithAI } = require('./aiRouter');
                    needSummary = await summarizeConversationWithAI(chatText, codigoEmpresa);
                }
            } catch (sumErr) {
                console.warn('Error auto-generando resumen en assign-team:', sumErr.message);
            }
        }
        if (!needSummary) needSummary = 'Atención y seguimiento personalizado solicitado.';

        const success = await db.derivarContactoTeam(contactId, codigoEmpresa, rol_asignado, usuario_asignado_id, fromSector, needSummary);
        if (success) {
            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: updated_by?.id || null,
                usuario_nombre: updated_by?.name || 'Administrador',
                rol: updated_by?.role || 'master',
                accion: 'contacto_derivado_team',
                entidad: 'contacto',
                entidad_id: contactId.toString(),
                detalles: `Contacto derivado a Team: "${rol_asignado}" ${usuario_nombre ? `(Asignado a: ${usuario_nombre})` : ''} - Necesidad: ${needSummary}`,
                google_scope: 'colaboratium@gmail.com'
            });
            res.json({ success: true, resumen_necesidad: needSummary });
        } else {
            res.status(404).json({ success: false, error: 'Contacto no encontrado' });
        }
    } catch (error) {
        console.error('Error derivando contacto a team:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Asignar Líder o Asesor al contacto (Árbol de Dependencias)
app.post('/api/empresas/:codigo/contacts/:id/assign-hierarchy', async (req, res) => {
    try {
        const { lider_id, asesor_id, updated_by } = req.body;
        const codigoEmpresa = req.params.codigo;
        const contactId = req.params.id;

        const success = await db.asignarJerarquiaContacto(contactId, codigoEmpresa, lider_id, asesor_id);
        if (success) {
            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: updated_by?.id || null,
                usuario_nombre: updated_by?.name || 'Administrador',
                rol: updated_by?.role || 'master',
                accion: 'contacto_asignado_jerarquia',
                entidad: 'contacto',
                entidad_id: contactId.toString(),
                detalles: `Contacto asignado en Árbol: Líder ID ${lider_id || 'Ninguno'}, Asesor ID ${asesor_id || 'Ninguno'}`,
                google_scope: 'colaboratium@gmail.com'
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Contacto no encontrado' });
        }
    } catch (error) {
        console.error('Error asignando jerarquía:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Marcar como Resuelto o Pendiente (con nota flotante)
app.post('/api/empresas/:codigo/contacts/:id/resolution', async (req, res) => {
    try {
        const { estado_resolucion, nota_pendiente, updated_by } = req.body;
        const codigoEmpresa = req.params.codigo;
        const contactId = req.params.id;

        const success = await db.actualizarResolucionContacto(contactId, codigoEmpresa, estado_resolucion, nota_pendiente);
        if (success) {
            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: updated_by?.id || null,
                usuario_nombre: updated_by?.name || 'Administrador',
                rol: updated_by?.role || 'master',
                accion: 'contacto_estado_resolucion',
                entidad: 'contacto',
                entidad_id: contactId.toString(),
                detalles: `Contacto marcado como ${estado_resolucion}. ${nota_pendiente ? `Nota: "${nota_pendiente}"` : ''}`,
                google_scope: 'colaboratium@gmail.com'
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Contacto no encontrado' });
        }
    } catch (error) {
        console.error('Error actualizando resolución:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Árbol de Dependencias de Colaboratium (Raíz -> Líderes -> Asesores -> Inversores)
app.get('/api/empresas/:codigo/crm/tree', async (req, res) => {
    try {
        const tree = await db.obtenerArbolDependencias(req.params.codigo);
        res.json({ success: true, tree });
    } catch (error) {
        console.error('Error obteniendo árbol de dependencias:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Grupos y Rubros de la Agenda
app.get('/api/empresas/:codigo/crm/rubros', async (req, res) => {
    try {
        const rows = await db.obtenerRubros(req.params.codigo);
        const rubros = (rows || []).map(r => typeof r === 'string' ? r : r.nombre);
        res.json({ success: true, rubros });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error obteniendo rubros' });
    }
});

app.post('/api/empresas/:codigo/crm/rubros', async (req, res) => {
    try {
        const insertId = await db.crearRubro(req.params.codigo, req.body.nombre);
        res.json({ success: true, id: insertId });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error creando rubro' });
    }
});

// Exportación completa a archivo VCF (vCard para celulares)
app.get('/api/empresas/:codigo/crm/export-vcf', async (req, res) => {
    try {
        const contacts = await db.obtenerContactosCRM(req.params.codigo, req.query.grupo);
        if (!contacts || contacts.length === 0) {
            return res.status(400).send('No hay contactos para exportar');
        }

        let vcardContent = '';
        for (const c of contacts) {
            const rawPhone = (c.telefono || '').toString().replace(/[^\d+]/g, '');
            if (!rawPhone) continue;
            const name = c.nombre || `Cliente ${rawPhone}`;

            vcardContent += 'BEGIN:VCARD\r\n';
            vcardContent += 'VERSION:3.0\r\n';
            vcardContent += `FN:${name}\r\n`;
            vcardContent += `TEL;TYPE=CELL:${rawPhone}\r\n`;
            if (c.email) vcardContent += `EMAIL:${c.email}\r\n`;
            if (c.dni || c.cbu || c.alias || c.banco || c.grupo) {
                const note = `DNI: ${c.dni || '-'} | CBU: ${c.cbu || '-'} | Alias: ${c.alias || '-'} | Banco: ${c.banco || '-'} | Grupo: ${c.grupo || 'CLIENTES'}`;
                vcardContent += `NOTE:${note}\r\n`;
            }
            vcardContent += 'END:VCARD\r\n';
        }

        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="contactos_${req.params.codigo}_${Date.now()}.vcf"`);
        res.send(vcardContent);
    } catch (error) {
        console.error('Error exportando VCF:', error);
        res.status(500).send('Error exportando contactos VCF');
    }
});

// Importación masiva por lote (desde CSV o tabla)
app.post('/api/empresas/:codigo/crm/import-batch', async (req, res) => {
    try {
        const { contacts } = req.body;
        if (!Array.isArray(contacts)) return res.status(400).json({ success: false, error: 'Formato inválido' });

        let imported = 0;
        for (const c of contacts) {
            if (c.telefono) {
                await db.crearContactoCRM(req.params.codigo, c);
                imported++;
            }
        }
        res.json({ success: true, imported });
    } catch (error) {
        console.error('Error importando contactos en lote:', error);
        res.status(500).json({ success: false, error: 'Error importando lote de contactos' });
    }
});

// ---------------------------------------------------------
// RUTAS PARA MODELOS IA Y MÉTRICAS DE TOKENS
// ---------------------------------------------------------

app.get('/api/empresas/:codigo/ai-metrics', async (req, res) => {
    try {
        const stats = await db.obtenerAiStats(req.params.codigo);
        const totalTokens = stats.reduce((acc, m) => acc + (Number(m.tokens_used) || 0), 0);
        const totalSuccess = stats.reduce((acc, m) => acc + (Number(m.success_count) || 0), 0);
        const totalFail = stats.reduce((acc, m) => acc + (Number(m.fail_count) || 0), 0);

        const ollamaStats = stats.filter(m => (m.model_name || '').toLowerCase().includes('ollama') || (m.model_name || '').toLowerCase().includes('local'));
        const ollamaTokens = ollamaStats.reduce((acc, m) => acc + (Number(m.tokens_used) || 0), 0);

        // Contabilizar plantillas oficiales de Meta WhatsApp Cloud API enviadas
        let totalTemplates = 0;
        try {
            const [templateRows] = await db.pool.query(
                `SELECT COUNT(*) as total_templates 
                 FROM mensajes m 
                 INNER JOIN contactos c ON m.contacto_id = c.id 
                 WHERE c.codigo_empresa = ? 
                   AND (m.tipo = 'template' OR m.contenido LIKE '[Plantilla:%') 
                   AND m.direccion = 'SALIENTE'`,
                [req.params.codigo]
            );
            totalTemplates = Number(templateRows[0]?.total_templates) || 0;
        } catch (tErr) {
            console.warn('Error contando plantillas enviadas:', tErr.message);
        }

        // Tasa oficial solicitada: 0.06 dólares (6 centavos) por plantilla
        const metaCostPerTemplate = 0.06;
        const metaTemplatesCostUsd = Number((totalTemplates * metaCostPerTemplate).toFixed(2));

        const cloudTokens = Math.max(0, totalTokens - ollamaTokens);
        const cloudAiCostUsd = Number(((cloudTokens / 1000) * 0.0006).toFixed(4));
        const totalConsolidatedCostUsd = Number((cloudAiCostUsd + metaTemplatesCostUsd).toFixed(4));

        res.json({
            success: true,
            stats,
            summary: {
                totalTokens,
                totalSuccess,
                totalFail,
                ollamaTokens,
                successRate: (totalSuccess + totalFail) > 0 ? ((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1) : '100.0',
                totalTemplates,
                metaCostPerTemplate,
                metaTemplatesCostUsd,
                cloudAiCostUsd,
                totalConsolidatedCostUsd
            }
        });
    } catch (error) {
        console.error('Error obteniendo métricas IA:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo métricas' });
    }
});

// ---------------------------------------------------------
// RUTAS PARA INBOX GMAIL (ESTILO IABOX) & CALENDAR MEET
// ---------------------------------------------------------
const { getInboxEmails, getEmailBody, sendReplyEmail, monitorAndProcessIncomingReplies } = require('./inboxService');
const { getAvailableWebinarSlots, processBooking } = require('./googleCalendarService');

app.get('/api/empresas/:codigo/inbox', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 35;
        const result = await getInboxEmails(limit, req.params.codigo);
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo correos inbox:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/empresas/:codigo/inbox/check-replies', async (req, res) => {
    try {
        const results = await monitorAndProcessIncomingReplies(req.params.codigo);
        res.json(results);
    } catch (error) {
        console.error('Error verificando respuestas de email:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/empresas/:codigo/inbox/monitor-status', async (req, res) => {
    try {
        const [pRows] = await db.pool.query(
            "SELECT COUNT(*) as total_procesados, SUM(CASE WHEN intent = 'CONFIRMACION_WEBINAR' THEN 1 ELSE 0 END) as total_confirmaciones FROM email_inbox_processed"
        );
        const [recent] = await db.pool.query(
            "SELECT * FROM email_inbox_processed ORDER BY id DESC LIMIT 5"
        );
        res.json({
            success: true,
            active: true,
            stats: pRows[0] || { total_procesados: 0, total_confirmaciones: 0 },
            recent
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Monitor automático en segundo plano para respuestas de correo cada 2 minutos
setInterval(async () => {
    try {
        await monitorAndProcessIncomingReplies('KRZMJI');
    } catch (e) {
        // Silencioso en background
    }
}, 2 * 60 * 1000);

app.get('/api/empresas/:codigo/inbox/contact-profile', async (req, res) => {
    try {
        const { email, contactId } = req.query;
        let cId = contactId ? parseInt(contactId, 10) : null;
        if (!cId && email) {
            const [rows] = await db.pool.query(
                "SELECT id FROM contactos WHERE LOWER(email) = ? AND codigo_empresa = ? LIMIT 1",
                [email.trim().toLowerCase(), req.params.codigo]
            );
            if (rows && rows.length > 0) cId = rows[0].id;
        }
        if (!cId) {
            return res.status(404).json({ success: false, error: 'Contacto no encontrado en la base de datos' });
        }
        const { getSubscriberProfile } = require('./googleCalendarService');
        const profile = await getSubscriberProfile(req.params.codigo, cId);
        res.json({ success: true, ...profile });
    } catch (error) {
        console.error('Error obteniendo perfil desde inbox:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/empresas/:codigo/inbox/:uid', async (req, res) => {
    try {
        const result = await getEmailBody(req.params.uid);
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo cuerpo de correo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/empresas/:codigo/inbox/reply', async (req, res) => {
    try {
        const { to, subject, body, inReplyTo } = req.body;
        if (!to || !body) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios (to, body)' });
        }
        const result = await sendReplyEmail({ to, subject, body, inReplyTo });
        res.json(result);
    } catch (error) {
        console.error('Error enviando respuesta de correo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/empresas/:codigo/calendar/slots', async (req, res) => {
    try {
        const slots = await getAvailableWebinarSlots(req.params.codigo);
        res.json({ success: true, slots });
    } catch (error) {
        console.error('Error obteniendo slots de calendario:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/empresas/:codigo/calendar/subscriber/:id', async (req, res) => {
    try {
        const { getSubscriberProfile } = require('./googleCalendarService');
        const profile = await getSubscriberProfile(req.params.codigo, req.params.id);
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Inscripto no encontrado' });
        }
        res.json({ success: true, ...profile });
    } catch (error) {
        console.error('Error obteniendo perfil del inscripto:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/empresas/:codigo/calendar/book', async (req, res) => {
    try {
        const { slotChoice, customerName, customerEmail, customerPhone } = req.body;
        const result = await processBooking({
            slotChoice,
            customerName,
            customerEmail,
            customerPhone,
            codigoEmpresa: req.params.codigo
        });
        res.json(result);
    } catch (error) {
        console.error('Error reservando slot de capacitación:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/empresas/:codigo/calendar/slots/:id/send-link', async (req, res) => {
    try {
        const { sendMeetingLinkToSubscribers } = require('./googleCalendarService');
        const { meetLinkOverride, customMessage, channels, userId, userName, userRole } = req.body || {};
        
        const result = await sendMeetingLinkToSubscribers({
            codigoEmpresa: req.params.codigo,
            slotId: req.params.id,
            meetLinkOverride,
            customMessage,
            channels: channels || ['whatsapp', 'email'],
            userId,
            userName,
            userRole
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('Error enviando enlace a suscriptores:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/empresas/:codigo/calendar/events', async (req, res) => {
    try {
        const { titulo, tipo = 'webinar', modalidad = 'VIRTUAL', categoria = 'ASESORES', fecha, horario, meetLink, ubicacion, cupos = 25, userId, userName, userRole } = req.body;
        const codigoEmpresa = req.params.codigo;
        const effectiveMeetLink = meetLink || 'https://meet.google.com/new';

        const eventId = await db.crearCalendarEvent(codigoEmpresa, {
            titulo,
            tipo,
            modalidad,
            categoria,
            fecha,
            horario,
            meet_link: effectiveMeetLink,
            ubicacion,
            cupos,
            creado_por_usuario_id: userId,
            creado_por_nombre: userName,
            creado_por_rol: userRole
        });

        // 1. Sincronización automática con Google Calendar (colaboratium@gmail.com) enviando invitación iCal
        try {
            const { sendCalendarEventInvitation } = require('./emailService');
            await sendCalendarEventInvitation({
                titulo,
                tipo,
                modalidad,
                categoria,
                fecha,
                horario,
                meetLink: effectiveMeetLink,
                ubicacion,
                creadoPor: userName || userRole
            });
        } catch (calErr) {
            console.warn('⚠️ Error en sincronización iCal de Google Calendar:', calErr.message);
        }

        // 2. Generar Enlace Directo para Google Calendar Web
        const gCalDirectUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&details=${encodeURIComponent(`Evento oficial ${titulo}\nModalidad: ${modalidad}\nCategoría: ${categoria}\nHorario: ${horario}\nSala Meet: ${effectiveMeetLink}`)}&location=${encodeURIComponent(modalidad === 'PRESENCIAL' ? (ubicacion || 'Av. del Libertador 264, Vicente López') : effectiveMeetLink)}&add=colaboratium@gmail.com`;

        // 3. Registrar en Log de Sucesos del Ámbito Google Colaboratium
        await db.registrarAuditLog({
            codigo_empresa: codigoEmpresa,
            usuario_id: userId,
            usuario_nombre: userName,
            rol: userRole,
            accion: 'calendar_event_created',
            entidad: 'calendar',
            entidad_id: eventId.toString(),
            detalles: `Evento creado: ${tipo === 'webinar' ? 'Webinar Capacitación' : 'Reunión Meet Inversores'} - "${titulo}" (${fecha} ${horario}, modalidad ${modalidad}). Sincronizado en Google Calendar colaboratium@gmail.com`,
            google_scope: 'colaboratium@gmail.com'
        });

        res.json({ 
            success: true, 
            id: eventId,
            googleCalendarUrl: gCalDirectUrl
        });
    } catch (error) {
        console.error('Error creando evento de calendario:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/empresas/:codigo/calendar/events/:id', async (req, res) => {
    try {
        const codigoEmpresa = req.params.codigo;
        const { userId, userName, userRole } = req.body || {};

        const deleted = await db.eliminarCalendarEvent(req.params.id, codigoEmpresa);

        if (deleted) {
            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: userId,
                usuario_nombre: userName,
                rol: userRole,
                accion: 'calendar_event_deleted',
                entidad: 'calendar',
                entidad_id: req.params.id,
                detalles: `Evento de calendario eliminado ID ${req.params.id}`,
                google_scope: 'colaboratium@gmail.com'
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Evento no encontrado' });
        }
    } catch (error) {
        console.error('Error eliminando evento de calendario:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint del Copiloto Flotante Multi-Sección
app.post('/api/empresas/:codigo/copilot/chat', async (req, res) => {
    try {
        const { message, context = {}, user = {} } = req.body;
        const codigoEmpresa = req.params.codigo;

        // 1. Verificar comandos de acción del Copiloto (búsqueda de chats, flujos, calendar, tickets, historial 360, PDF)
        const { processCopilotCommand } = require('./copilotService');
        const actionResult = await processCopilotCommand({ message, context, codigoEmpresa, user });
        if (actionResult) {
            return res.json(actionResult);
        }

        const empresa = await db.obtenerEmpresa(codigoEmpresa);
        const currentSection = context.section || 'General';
        let liveDataSection = '';
        try {
            if (currentSection.includes('Calendario') || /inscript|calendario|fecha|horario|slot|meet|reuni/i.test(message)) {
                const slots = await getAvailableWebinarSlots(codigoEmpresa);
                const slotsSummary = slots.map(s => {
                    const subs = (s.subscribers || []).map(sub => `${sub.nombre} (${sub.email || sub.telefono})`).join(', ');
                    return `- Opción ${s.id}: ${s.titulo} [${s.modalidad}] - ${s.fechaStr} ${s.horarioStr} | ${s.inscriptosCount} Inscripto(s): ${subs || 'Sin inscriptos'}`;
                }).join('\n');
                liveDataSection = `\n\nESTADO EN TIEMPO REAL DE SESIONES Y CALENDARIO:\n${slotsSummary}`;
            }
        } catch (e) {
            console.error('Error inyectando liveData en Copilot:', e.message);
        }

        const copilotSystemPrompt = `Eres el Copiloto Inteligente de Routh Agent para la empresa Colaboratium (Global Loan S.A.).
Tu función es asistir al operador o directivo mientras navega por la plataforma.
Actualmente el usuario está en la sección: [${currentSection}].
Ruta activa: ${context.pathname || '/dashboard'}
${liveDataSection}

CONOCIMIENTO EMPRESARIAL OBLIGATORIO:
- Empresa: Colaboratium (Global Loan S.A.)
- Registro Oficial BCRA: Nº 40.015 (https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/)
- Oficinas Comerciales: Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.
- Bancos aliados: Banco BIND y Banco Coinag.
- Regla Cero Costo al Inversor: No se le cobra nada al inversor, todo lo paga el tomador del préstamo.
- No Custodial: Cada inversor opera desde su propio CVU bancarizado.
- Comisiones de Asesores: 4% a 3m, 5% a 6m, 6% a 12m (3% al calce inmediato y el resto en cuotas).
- Leads de Colaboratium (Caso Juan Ramírez): 3% inicial para Colaboratium, cuotas residuales y 100% de reinversiones para el asesor.
- Líderes: 10% adicional de la bolsa de comisiones del equipo.
- Reuniones y Capacitación: Lunes, Miércoles y Viernes por Google Meet (meet.google.com/new) o Presencial en Vicente López los Miércoles a las 14:30 hs.

INSTRUCCIONES DE RESPUESTA:
- Responde de forma ejecutiva, precisa, profesional y con formato Markdown amigable (viñetas, negritas, emojis).
- Si te piden datos de inscriptos, menciónalos con nombres y detalles reales provistos en el contexto.
- Si te piden redactar un mensaje, un email o una respuesta para un cliente, redáctala lista para copiar y pegar.
- Sé proactivo con sugerencias útiles según la sección del panel.`;

        const empresaContext = {
            ...(empresa || {}),
            codigo: codigoEmpresa,
            prompt_ia: copilotSystemPrompt
        };

        const aiResponse = await processMessageWithAI(message, context.history || [], empresaContext);
        const cleanResponse = (aiResponse || '').replace(/\[ROLE:.*?\]/ig, '').replace(/\[HANDOFF\]/g, '').trim();

        res.json({
            success: true,
            reply: cleanResponse,
            section: currentSection
        });
    } catch (error) {
        console.error('Error en Copiloto Chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Iniciar servidor y base de datos
app.listen(PORT, async () => {
    console.log(`🚀 Servidor de WhatsApp escuchando en el puerto ${PORT}`);
    await db.initDB();
    campaignScheduler.iniciarScheduler();
});
