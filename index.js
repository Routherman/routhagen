const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const { processMessageWithAI, summarizeDocument } = require('./groqService');
const { sendWhatsAppMessage, sendWhatsAppTemplate, downloadWhatsAppMedia } = require('./whatsappService');
const { handleFlowEngine } = require('./flowEngine');
const db = require('./database');
const cors = require('cors');
const multer = require('multer');
const { extractTextFromFile } = require('./fileProcessor');
const fs = require('fs');

const upload = multer({ dest: 'public/uploads/' });

const app = express();
app.use(cors());
app.use('/media', express.static('public/media'));
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
app.get('/api/messages/whatsapp/receive', async (req, res) => {
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
app.post('/api/messages/whatsapp/receive', async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            // Identificar empresa por phone_number_id
            const phoneId = value.metadata?.phone_number_id;
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
            const accessToken = cv?.whatsapp?.access_token;
            const codigoEmpresa = empresa.codigo;

            // CASO 1: Recibimos un mensaje (Incoming o Contacts)
            if (value && value.messages && value.messages[0]) {
                const message = value.messages[0];
                const contact = value.contacts?.[0] || {};

                const cleanMessage = parseMessage(message, contact);

                // 1. Guardar o actualizar contacto
                const dbContacto = await db.upsertContacto(cleanMessage.identificador.valor, cleanMessage.remitente, codigoEmpresa);

                // Obtener historial ANTES de guardar el mensaje actual (para no duplicarlo)
                const history = await db.obtenerHistorialMensajes(dbContacto.id, 10);

                // Si es multimedia, descargar el archivo
                let contenidoFinal = cleanMessage.contenido;
                if (cleanMessage.id_media && accessToken) {
                    const localUrl = await downloadWhatsAppMedia(cleanMessage.id_media, accessToken);
                    if (localUrl) {
                        contenidoFinal = JSON.stringify({
                            url: localUrl,
                            caption: cleanMessage.contenido || ''
                        });
                    }
                }

                // 2. Guardar mensaje entrante
                await db.guardarMensaje(
                    dbContacto.id, 
                    cleanMessage.id_mensaje_meta, 
                    'ENTRANTE', 
                    cleanMessage.tipo_mensaje, 
                    contenidoFinal
                );

                console.log(`\n💬 Nuevo mensaje de ${cleanMessage.remitente} guardado en BD para empresa ${codigoEmpresa}.`);

                // --- FLUJO DE EJECUCIÓN GRÁFICA (React Flow) ---
                if (cleanMessage.contenido && dbContacto.estado_bot === 'ACTIVO') {
                    (async () => {
                        try {
                            const handledByFlow = await handleFlowEngine(dbContacto, cleanMessage, empresa, accessToken, phoneId, history);
                            
                            // Si el flujo procesó el mensaje, no hacemos nada más en esta iteración.
                            if (handledByFlow) {
                                return;
                            }

                            // --- FLUJO DE RESPUESTA AUTOMÁTICA CON IA (Fallback si no hay flujo gráfico activo) ---
                            // 1. Obtener roles de la empresa
                            const rolesEmpresa = await db.obtenerRoles(codigoEmpresa);
                            const rolesString = rolesEmpresa.map(r => r.nombre).join(', ');
                            
                            // 2. Obtener flujos activos (para que la IA sepa qué flujos existen y sus palabras clave)
                            const flujos = await db.obtenerFlujos(codigoEmpresa);
                            const flujosActivos = flujos.filter(f => f.activo);
                            const flujosString = flujosActivos.length > 0 
                                ? flujosActivos.map(f => `- Flujo: "${f.nombre}" | Palabra Clave: "${f.trigger_keyword}"`).join('\n')
                                : 'No hay flujos automáticos activos.';

                            // 3. Información del contacto
                            const contactInfo = `Nombre/Remitente: ${dbContacto.nombre || cleanMessage.remitente}\nTeléfono: ${dbContacto.identificador_valor}`;

                            // 4. Integrar todo en el prompt de la IA
                            const contextoAdicional = `
[CONTEXTO OBLIGATORIO PARA LA IA]
INFORMACIÓN DEL CONTACTO:
${contactInfo}

ROLES DISPONIBLES EN LA EMPRESA (Para derivación):
${rolesString}

FLUJOS DISPONIBLES:
${flujosString}
(NOTA: Puedes sugerirle al usuario que escriba una de las palabras clave para iniciar automáticamente un proceso o flujo si lo ves útil).
`;

                            const empresaContext = { 
                                ...empresa, 
                                prompt_ia: `${empresa.prompt_ia || ''}\n${contextoAdicional}` 
                            };

                            let aiResponse = await processMessageWithAI(cleanMessage.contenido, history, empresaContext);
                            
                            // Extraer Rol asignado
                            const roleMatch = aiResponse.match(/\[ROLE:(.*?)\]/i);
                            if (roleMatch) {
                                const rolName = roleMatch[1].trim();
                                await db.actualizarAsignacionContacto(dbContacto.id, rolName);
                                aiResponse = aiResponse.replace(/\[ROLE:.*?\]/ig, '').trim();
                                console.log(`✅ Chat asignado al rol: ${rolName}`);
                            }
                            
                            if (aiResponse.includes('[HANDOFF]')) {
                                console.log('⚠️ La IA derivó el chat a un humano. Guardando nuevo estado...');
                                await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
                                
                                // Limpiamos la etiqueta para no mostrarla al usuario final
                                let msgToUser = aiResponse.replace(/\[HANDOFF\]/g, '').trim();
                                if (!msgToUser) {
                                    msgToUser = 'Entiendo. Un asesor humano se conectará al chat en breve para ayudarte.';
                                }
                                
                                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, msgToUser, phoneId, accessToken);
                                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', msgToUser);
                            } else {
                                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, aiResponse, phoneId, accessToken);
                                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', aiResponse);
                                console.log(`✅ Respuesta enviada y guardada en BD para ${cleanMessage.remitente}`);
                            }
                        } catch (err) {
                            console.error('❌ Error en el flujo asíncrono de respuesta:', err);
                        }
                    })();
                } else if (dbContacto.estado_bot === 'HANDOFF') {
                    // Verificar si el último mensaje SALIENTE fue una plantilla.
                    // Si es así, el cliente respondió a nuestra plantilla → reactivar IA.
                    const [lastOutgoing] = await db.pool.query(
                        `SELECT tipo FROM mensajes WHERE contacto_id = ? AND direccion = 'SALIENTE' ORDER BY id DESC LIMIT 1`,
                        [dbContacto.id]
                    );
                    
                    if (lastOutgoing[0]?.tipo === 'template') {
                        console.log(`✅ El cliente respondió a una plantilla. Reactivando IA para ${cleanMessage.remitente}...`);
                        await db.actualizarEstadoBot(dbContacto.id, 'ACTIVO');
                        
                        // Procesar respuesta con IA ahora que está activa
                        (async () => {
                            try {
                                const freshHistory = await db.obtenerHistorialMensajes(dbContacto.id, 10);
                                // 1. Obtener roles
                                const rolesEmpresa = await db.obtenerRoles(codigoEmpresa);
                                const rolesString = rolesEmpresa.map(r => r.nombre).join(', ');
                                
                                // 2. Obtener flujos activos
                                const flujos = await db.obtenerFlujos(codigoEmpresa);
                                const flujosActivos = flujos.filter(f => f.activo);
                                const flujosString = flujosActivos.length > 0 
                                    ? flujosActivos.map(f => `- Flujo: "${f.nombre}" | Palabra Clave: "${f.trigger_keyword}"`).join('\n')
                                    : 'No hay flujos automáticos activos.';

                                // 3. Información del contacto
                                const contactInfo = `Nombre/Remitente: ${dbContacto.nombre || cleanMessage.remitente}\nTeléfono: ${dbContacto.identificador_valor}`;

                                // 4. Integrar todo en el prompt de la IA
                                const contextoAdicional = `
[CONTEXTO OBLIGATORIO PARA LA IA]
INFORMACIÓN DEL CONTACTO:
${contactInfo}

ROLES DISPONIBLES EN LA EMPRESA (Para derivación):
${rolesString}

FLUJOS DISPONIBLES:
${flujosString}
(NOTA: Puedes sugerirle al usuario que escriba una de las palabras clave para iniciar automáticamente un proceso o flujo si lo ves útil).
`;

                                const empresaContext = { 
                                    ...empresa, 
                                    prompt_ia: `${empresa.prompt_ia || ''}\n${contextoAdicional}` 
                                };

                                let aiResponse = await processMessageWithAI(cleanMessage.contenido, freshHistory, empresaContext);
                                
                                // Extraer Rol
                                const roleMatch = aiResponse.match(/\[ROLE:(.*?)\]/i);
                                if (roleMatch) {
                                    const rolName = roleMatch[1].trim();
                                    await db.actualizarAsignacionContacto(dbContacto.id, rolName);
                                    aiResponse = aiResponse.replace(/\[ROLE:.*?\]/ig, '').trim();
                                }
                                
                                if (aiResponse.includes('[HANDOFF]')) {
                                    await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
                                    let msgToUser = aiResponse.replace(/\[HANDOFF\]/g, '').trim();
                                    if (!msgToUser) msgToUser = 'Entiendo. Un asesor humano se conectará al chat en breve.';
                                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, msgToUser, phoneId, accessToken);
                                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', msgToUser);
                                } else {
                                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, aiResponse, phoneId, accessToken);
                                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', aiResponse);
                                    console.log(`✅ IA reactivada y respondió a ${cleanMessage.remitente}`);
                                }
                            } catch (err) {
                                console.error('❌ Error al responder tras reactivación de IA:', err);
                            }
                        })();
                    } else {
                        console.log(`⏸️ Chat en modo HANDOFF. La IA no responderá a ${cleanMessage.remitente}.`);
                    }
                }
            }
            // CASO 2: Recibimos una confirmación de estado (Status: sent, delivered, read)
            else if (value && value.statuses && value.statuses[0]) {
                const statusData = value.statuses[0];
                const cleanStatus = parseStatus(statusData);

                // Actualizar estado en BD
                await db.actualizarEstadoMensaje(cleanStatus.id_mensaje_meta, cleanStatus.estado);
                console.log(`\n📊 Estado del mensaje ${cleanStatus.id_mensaje_meta} actualizado en BD a: ${cleanStatus.estado}`);
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
        let contacts = await db.obtenerContactos(req.params.empresa);
        
        if (clerkId) {
            const user = await db.obtenerUsuario(clerkId);
            if (user) {
                const userRole = await db.pool.query('SELECT nombre FROM roles WHERE id = ?', [user.rol_id]).then(([rows]) => rows[0]?.nombre || '');
                const isMaster = userRole.toLowerCase() === 'master';

                contacts = contacts.filter(contact => {
                    // Si está delegado a un usuario específico, solo lo ven ese usuario y el master
                    if (contact.usuario_asignado_id) {
                        return isMaster || contact.usuario_asignado_id === clerkId;
                    }

                    // Si no está delegado, lo ven el master y los del rol asignado (o todos si es General)
                    if (isMaster) return true;
                    
                    const rolAsignado = (contact.rol_asignado || 'General').toLowerCase();
                    if (rolAsignado === 'general') return true; // Todos pueden ver General si no está delegado
                    
                    return userRole.toLowerCase() === rolAsignado;
                });
            }
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
        
        const phoneId = cv?.whatsapp?.phone_id;
        const accessToken = cv?.whatsapp?.access_token;

        if (!phoneId || !accessToken) return res.status(400).json({ error: 'La empresa no tiene WhatsApp configurado' });
        
        // Enviar plantilla
        const wamid = await sendWhatsAppTemplate(telefono, templateName, languageCode, phoneId, accessToken);
        
        // Guardar mensaje en base de datos con tipo 'template' (importante para la reactivación de IA)
        await db.guardarMensaje(contactId, wamid, 'SALIENTE', 'template', bodyText || `[Plantilla: ${templateName}]`);

        res.json({ success: true, messageId: wamid });
    } catch (error) {
        console.error('❌ Error enviando plantilla:', error);
        res.status(500).json({ error: 'No se pudo enviar la plantilla' });
    }
});

// Importar contactos manualmente o desde Excel
app.post('/api/empresas/:codigo/import-contacts', async (req, res) => {
    try {
        const { numbers } = req.body;
        if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Formato inválido. Se esperaba un arreglo de números.' });

        const importedIds = [];
        for (const num of numbers) {
            if (!num || typeof num !== 'string' || num.trim() === '') continue;
            const cleanedNum = num.trim().replace(/\D/g, ''); 
            if (cleanedNum) {
                const contacto = await db.upsertContacto(cleanedNum, 'Usuario ' + cleanedNum, req.params.codigo);
                if (contacto && contacto.id) {
                    importedIds.push(contacto.id);
                }
            }
        }
        res.json({ success: true, importedIds });
    } catch (error) {
        console.error('Error importing contacts:', error);
        res.status(500).json({ error: 'Error importando contactos' });
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
        const { contactIds, templateName, languageCode, messagesPerMinute, campaignName } = req.body;
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

        // Procesar en background para no bloquear
        processMassiveCampaign(contactIds, templateName, languageCode, phoneId, accessToken, messagesPerMinute || 10, campanaId);
        
        res.json({ success: true, message: 'Campaña iniciada', campanaId });
    } catch (error) {
        console.error('Error iniciando campaña masiva:', error);
        res.status(500).json({ error: 'Error iniciando campaña masiva' });
    }
});

async function processMassiveCampaign(contactIds, templateName, languageCode, phoneId, accessToken, messagesPerMinute, campanaId) {
    // Calcular el delay en ms basado en msj/min (ej. 60 msj/min = 1 msj por seg = 1000ms delay)
    const delayMs = Math.max(1000, Math.floor(60000 / messagesPerMinute));
    
    for (const contactId of contactIds) {
        try {
            const [contacts] = await db.pool.query('SELECT * FROM contactos WHERE id = ?', [contactId]);
            if (contacts.length > 0) {
                const telefono = contacts[0].telefono;
                const wamid = await sendWhatsAppTemplate(telefono, templateName, languageCode || 'es_AR', phoneId, accessToken);
                await db.guardarMensaje(contactId, wamid, 'SALIENTE', 'template', `[Plantilla Masiva: ${templateName}]`, campanaId);
            }
        } catch (error) {
            console.error(`Error enviando plantilla masiva al contacto ${contactId}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // Al finalizar, actualizar estado de la campaña
    if (db.pool && campanaId) {
        await db.pool.query("UPDATE campanas SET estado = 'completada' WHERE id = ?", [campanaId]);
    }
}

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

// Iniciar servidor y base de datos
app.listen(PORT, async () => {
    console.log(`🚀 Servidor de WhatsApp escuchando en el puerto ${PORT}`);
    await db.initDB();
});
