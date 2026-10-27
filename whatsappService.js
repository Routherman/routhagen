const axios = require('axios');

/**
 * Función para enviar un mensaje de texto a través de WhatsApp Cloud API.
 * @param {string} recipientId - El número de teléfono o ID del usuario destinatario.
 * @param {string} text - El texto del mensaje a enviar.
 * @param {string} phoneId - El ID del teléfono de envío.
 * @param {string} accessToken - El token de acceso de Graph API.
 */
async function resolveWhatsAppCredentials(phoneId, accessToken, codigoEmpresa = 'KRZMJI') {
    if (phoneId && accessToken) return { phoneId, accessToken };
    try {
        const db = require('./database');
        const emp = await db.obtenerEmpresa(codigoEmpresa);
        if (emp && emp.cuentas_vinculadas) {
            const cv = typeof emp.cuentas_vinculadas === 'string' ? JSON.parse(emp.cuentas_vinculadas) : emp.cuentas_vinculadas;
            phoneId = phoneId || cv?.whatsapp?.phone_id;
            accessToken = accessToken || cv?.whatsapp?.access_token;
        }
    } catch (e) {}
    phoneId = phoneId || process.env.WHATSAPP_PHONE_ID;
    accessToken = accessToken || process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
    return { phoneId, accessToken };
}

async function sendWhatsAppMessage(recipientId, text, phoneId, accessToken) {
    try {
        const creds = await resolveWhatsAppCredentials(phoneId, accessToken);
        phoneId = creds.phoneId;
        accessToken = creds.accessToken;
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
        if (accessToken.startsWith('mock_') || accessToken.startsWith('sim_')) {
            return `sim_msg_${Date.now()}`;
        }
        // Utilizamos la versión 20.0 de la API (puedes ajustarla según necesites)
        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientId,
            type: 'text',
            text: {
                preview_url: false,
                body: text
            }
        };

        const response = await axios.post(url, data, { headers });
        
        // Meta devuelve un JSON con un array 'messages' que contiene el ID del mensaje enviado
        const messageId = response.data.messages?.[0]?.id;
        return messageId;
    } catch (error) {
        console.error('❌ Error enviando mensaje de WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}


/**
 * Función para enviar un formulario de selección nativo (Interactive List Message) en WhatsApp Cloud API.
 * @param {string} recipientId - El número de teléfono destinatario.
 * @param {object} listConfig - Configuración de la lista: { headerText, bodyText, footerText, buttonText, sections }
 * @param {string} phoneId - El ID del teléfono de envío.
 * @param {string} accessToken - El token de acceso de Graph API.
 */
async function sendWhatsAppInteractiveList(recipientId, { headerText, bodyText, footerText, buttonText = "Ver Horarios 📅", sections = [] }, phoneId, accessToken) {
    try {
        const creds = await resolveWhatsAppCredentials(phoneId, accessToken);
        phoneId = creds.phoneId;
        accessToken = creds.accessToken;
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
        if (accessToken.startsWith('mock_') || accessToken.startsWith('sim_')) {
            return `sim_list_${Date.now()}`;
        }
        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const interactiveObj = {
            type: 'list',
            body: { text: bodyText },
            action: {
                button: (buttonText || "Ver Opciones").substring(0, 20),
                sections: sections
            }
        };

        if (headerText) {
            interactiveObj.header = {
                type: 'text',
                text: headerText.substring(0, 60)
            };
        }

        if (footerText) {
            interactiveObj.footer = {
                text: footerText.substring(0, 60)
            };
        }

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientId,
            type: 'interactive',
            interactive: interactiveObj
        };

        const response = await axios.post(url, data, { headers });
        const messageId = response.data.messages?.[0]?.id;
        return messageId;
    } catch (error) {
        console.error('❌ Error enviando formulario/lista interactiva de WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Función para enviar botones interactivos (hasta 3 botones de selección rápida)
 */
async function sendWhatsAppInteractiveButtons(recipientId, { headerText, bodyText, footerText, buttons = [] }, phoneId, accessToken) {
    try {
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const interactiveObj = {
            type: 'button',
            body: { text: bodyText },
            action: {
                buttons: buttons.slice(0, 3).map((btn, idx) => ({
                    type: 'reply',
                    reply: {
                        id: btn.id || `btn_${idx + 1}`,
                        title: (btn.title || btn.text || `Opción ${idx + 1}`).substring(0, 20)
                    }
                }))
            }
        };

        if (headerText) {
            interactiveObj.header = {
                type: 'text',
                text: headerText.substring(0, 60)
            };
        }

        if (footerText) {
            interactiveObj.footer = {
                text: footerText.substring(0, 60)
            };
        }

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientId,
            type: 'interactive',
            interactive: interactiveObj
        };

        const response = await axios.post(url, data, { headers });
        return response.data.messages?.[0]?.id;
    } catch (error) {
        console.error('❌ Error enviando botones interactivos de WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}


/**
 * Función para enviar una plantilla a través de WhatsApp Cloud API.
 * @param {string} recipientId - El número de teléfono o ID del usuario destinatario.
 * @param {string} templateName - El nombre de la plantilla.
 * @param {string} languageCode - El código de idioma de la plantilla (ej. 'es_AR').
 * @param {string} phoneId - El ID del teléfono de envío.
 * @param {string} accessToken - El token de acceso de Graph API.
 */
async function sendWhatsAppTemplate(recipientId, templateName, languageCode, phoneId, accessToken, parameters = []) {
    try {
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const templatePayload = {
            name: templateName,
            language: {
                code: languageCode || 'es_AR'
            }
        };

        // Si se enviaron parámetros dinámicos (ej: {{1}} nombre del cliente)
        if (Array.isArray(parameters) && parameters.length > 0) {
            templatePayload.components = [
                {
                    type: 'body',
                    parameters: parameters.map(param => ({
                        type: 'text',
                        text: String(param || '')
                    }))
                }
            ];
        }

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientId,
            type: 'template',
            template: templatePayload
        };

        const response = await axios.post(url, data, { headers });
        const messageId = response.data.messages?.[0]?.id;
        return messageId;
    } catch (error) {
        const errorData = error.response?.data?.error;
        const details = errorData?.error_data?.details || '';
        
        // Auto-recuperación ante desajuste de parámetros (Meta error code 132000)
        if (errorData?.code === 132000) {
            if (Array.isArray(parameters) && parameters.length > 0 && details.includes('expected number of params (0)')) {
                console.warn(`⚠️ [WhatsApp API] La plantilla '${templateName}' no acepta variables dinámicas (${details}). Reenviando automáticamente sin parámetros...`);
                return await sendWhatsAppTemplate(recipientId, templateName, languageCode, phoneId, accessToken, []);
            }
            if ((!parameters || parameters.length === 0) && details.includes('expected number of params (1)')) {
                console.warn(`⚠️ [WhatsApp API] La plantilla '${templateName}' requiere 1 variable (${details}). Reenviando automáticamente con nombre por defecto...`);
                return await sendWhatsAppTemplate(recipientId, templateName, languageCode, phoneId, accessToken, ['Estimado/a']);
            }
            if ((!parameters || parameters.length < 5) && details.includes('expected number of params (5)')) {
                console.warn(`⚠️ [WhatsApp API] La plantilla '${templateName}' requiere 5 variables (${details}). Reenviando automáticamente con datos de webinar...`);
                const fallbackParams = ['Jueves 29 de Octubre', '13:00 hs', '40 min', 'https://meet.google.com/new', 'https://colaboratium.com.ar/baja'];
                return await sendWhatsAppTemplate(recipientId, templateName, languageCode, phoneId, accessToken, fallbackParams);
            }
        }

        console.error('❌ Error enviando plantilla de WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

const fs = require('fs');
const path = require('path');

/**
 * Función para descargar multimedia desde WhatsApp Cloud API.
 */
async function downloadWhatsAppMedia(mediaId, accessToken) {
    try {
        if (!mediaId || !accessToken) return null;

        // 1. Obtener la URL del media
        const urlReq = `https://graph.facebook.com/v20.0/${mediaId}`;
        const urlRes = await axios.get(urlReq, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        const mediaData = urlRes.data;
        if (!mediaData || !mediaData.url) return null;

        // 2. Descargar el archivo binario
        const fileRes = await axios.get(mediaData.url, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            responseType: 'stream'
        });

        // 3. Determinar la extensión
        const mimeType = mediaData.mime_type || '';
        let ext = '';
        if (mimeType.includes('jpeg')) ext = '.jpg';
        else if (mimeType.includes('png')) ext = '.png';
        else if (mimeType.includes('webp')) ext = '.webp';
        else if (mimeType.includes('ogg')) ext = '.ogg';
        else if (mimeType.includes('mp4')) ext = '.mp4';
        else if (mimeType.includes('mpeg')) ext = '.mp3';
        else if (mimeType.includes('pdf')) ext = '.pdf';
        
        const filename = `${mediaId}${ext}`;
        const publicDir = path.join(__dirname, 'public', 'media');
        
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        const filepath = path.join(publicDir, filename);
        
        const writer = fs.createWriteStream(filepath);
        fileRes.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(`/media/${filename}`));
            writer.on('error', reject);
        });

    } catch (error) {
        console.error('❌ Error descargando media de WhatsApp:', error.message);
        return null;
    }
}

/**
 * Genera el payload de formulario interactivo de 3 opciones para el Menú Principal
 */
function formatWelcomeInteractiveList() {
    return {
        headerText: "Colaboratium (BCRA Nº 40.015)",
        bodyText: "¿Con qué opción te gustaría avanzar hoy? Elige tu perfil en el menú interactivo para acceder a la información correspondiente:",
        footerText: "Registro BCRA Nº 40.015",
        buttonText: "Elegir Perfil 📋",
        sections: [
            {
                title: "PERFILES DISPONIBLES",
                rows: [
                    {
                        id: "1",
                        title: "1. Inversor",
                        description: "Quiero invertir en la plataforma"
                    },
                    {
                        id: "2",
                        title: "2. Asesor Comercial",
                        description: "Quiero trabajar con ustedes"
                    },
                    {
                        id: "3",
                        title: "3. Líder de Equipo",
                        description: "Tengo equipo y me interesa su propuesta"
                    }
                ]
            }
        ]
    };
}

module.exports = {
    sendWhatsAppMessage,
    sendWhatsAppTemplate,
    downloadWhatsAppMedia,
    sendWhatsAppInteractiveList,
    sendWhatsAppInteractiveButtons,
    formatWelcomeInteractiveList
};

