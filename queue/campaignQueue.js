require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const db = require('../database');
const { sendWhatsAppTemplate } = require('../whatsappService');
const connection = require('./redisClient');

// Cola para campañas masivas
const campaignQueue = new Queue('outgoing-campaigns', { 
    connection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
    }
});

const campaignWorker = new Worker('outgoing-campaigns', async (job) => {
    const { isCompletionJob, campanaId, contactId, templateName, languageCode, phoneId, accessToken, delayMs, useContactName } = job.data;

    try {
        if (isCompletionJob) {
            await db.pool.query("UPDATE campanas SET estado = 'completada' WHERE id = ?", [campanaId]);
            return { success: true, type: 'completion' };
        }

        const [contacts] = await db.pool.query('SELECT * FROM contactos WHERE id = ?', [contactId]);
        if (contacts.length > 0) {
            const contacto = contacts[0];
            const telefono = contacto.telefono;
            
            // Parámetros para variables de la plantilla (ej. {{1}} = Nombre)
            let parameters = [];
            if (useContactName && contacto.nombre) {
                parameters = [contacto.nombre];
            }

            // Enviamos la plantilla con los parámetros
            const wamid = await sendWhatsAppTemplate(telefono, templateName, languageCode || 'es_AR', phoneId, accessToken, parameters);
            
            // Guardamos el mensaje en la base de datos
            const contenidoGuardado = parameters.length > 0 
                ? `[Plantilla: ${templateName} | Nombre: ${contacto.nombre}]`
                : `[Plantilla Masiva: ${templateName}]`;
            await db.guardarMensaje(contactId, wamid, 'SALIENTE', 'template', contenidoGuardado, campanaId);
            
            // Simulamos el delay (rate limit) dentro del worker para espaciar los envíos de forma controlada
            // Nota: En sistemas más avanzados, se puede usar Rate Limiter nativo de BullMQ Pro.
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            return { success: true, contactId, wamid };
        }
        return { success: false, reason: 'Contact not found' };
    } catch (error) {
        console.error(`❌ [CAMPAIGN WORKER] Error enviando plantilla al contacto ${contactId}:`, error.message);
        throw error;
    }
}, {
    connection,
    concurrency: 1, // Procesamos 1 a la vez por Worker para respetar fielmente el delayMs de envío masivo
    stalledInterval: 120000
});

campaignWorker.on('failed', (job, err) => {
    console.error(`❌ [CAMPAIGN WORKER] Falló el envío al contacto ${job.data.contactId}:`, err.message);
});

module.exports = {
    campaignQueue,
    campaignWorker
};
