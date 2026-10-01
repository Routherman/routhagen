const axios = require('axios');

/**
 * Función para enviar un mensaje de texto a través de WhatsApp Cloud API.
 * @param {string} recipientId - El número de teléfono o ID del usuario destinatario.
 * @param {string} text - El texto del mensaje a enviar.
 * @param {string} phoneId - El ID del teléfono de envío.
 * @param {string} accessToken - El token de acceso de Graph API.
 */
async function sendWhatsAppMessage(recipientId, text, phoneId, accessToken) {
    try {
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
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
 * Función para enviar una plantilla a través de WhatsApp Cloud API.
 * @param {string} recipientId - El número de teléfono o ID del usuario destinatario.
 * @param {string} templateName - El nombre de la plantilla.
 * @param {string} languageCode - El código de idioma de la plantilla (ej. 'es_AR').
 * @param {string} phoneId - El ID del teléfono de envío.
 * @param {string} accessToken - El token de acceso de Graph API.
 */
async function sendWhatsAppTemplate(recipientId, templateName, languageCode, phoneId, accessToken) {
    try {
        if (!phoneId || !accessToken) throw new Error("Faltan credenciales de WhatsApp");
        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientId,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode || 'en_US'
                }
            }
        };

        const response = await axios.post(url, data, { headers });
        const messageId = response.data.messages?.[0]?.id;
        return messageId;
    } catch (error) {
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

module.exports = {
    sendWhatsAppMessage,
    sendWhatsAppTemplate,
    downloadWhatsAppMedia
};
