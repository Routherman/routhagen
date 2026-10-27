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
            
            // Parámetros para variables de la plantilla (ej. {{1}} = Nombre o variables de webinar)
            let parameters = [];
            if (templateName === 'reunion_informativa_asesores') {
                let fechaStr = 'Jueves 29 de Octubre';
                let horarioStr = '13:00 hs';
                let meetUrl = 'https://meet.google.com/new';
                try {
                    const { getAvailableWebinarSlots } = require('../googleCalendarService');
                    const slots = await getAvailableWebinarSlots(contacto.codigo_empresa || 'KRZMJI', 'asesores');
                    if (slots && slots.length > 0) {
                        fechaStr = slots[0].fechaStr || fechaStr;
                        horarioStr = slots[0].horarioStr?.split(' a ')?.[0] || horarioStr;
                        meetUrl = slots[0].meetLink || meetUrl;
                    }
                } catch (e) {}
                parameters = [fechaStr, horarioStr, '40 min', meetUrl, 'https://colaboratium.com.ar/baja'];
            } else if (useContactName || ['bienvenida_asesores_colaboratium', 'convocatoria_lideres_de_equipo', 'simulador_y_propuesta_inversores'].includes(templateName)) {
                parameters = [contacto.nombre || 'Estimado/a'];
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
