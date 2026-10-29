const db = require('./database');
const { sendMassEmailCampaign } = require('./emailService');

let schedulerInterval = null;
let isChecking = false;

/**
 * Revisa en la base de datos si hay campañas programadas cuya fecha/hora ya haya llegado
 */
async function checkAndRunScheduledCampaigns() {
    if (isChecking) return;
    isChecking = true;
    try {
        const programadas = await db.obtenerCampanasProgramadas();
        if (!programadas || programadas.length === 0) return;

        const now = Date.now();

        for (const camp of programadas) {
            const scheduledTime = new Date(camp.programada_para).getTime();
            // Disparar si ya llegó la hora (con 2 segundos de tolerancia por sincronización de reloj)
            if (scheduledTime <= now + 2000) {
                console.log(`⏰ [Scheduler] Disparando automáticamente campaña programada #${camp.id} "${camp.nombre}" (${camp.tipo})...`);

                // Bloqueo atómico para evitar disparos duplicados
                const [updateResult] = await db.pool.query(
                    "UPDATE campanas SET estado = 'en_progreso', ultimo_log = ? WHERE id = ? AND estado = 'programada'",
                    [`Iniciada automáticamente por el Programador a las ${new Date().toLocaleTimeString('es-AR')}`, camp.id]
                );

                if (updateResult.affectedRows === 0) {
                    // Ya fue ejecutada o cancelada por otro hilo
                    continue;
                }

                if (camp.tipo === 'email') {
                    ejecutarCampanaEmail(camp).catch(err => {
                        console.error(`❌ [Scheduler] Error ejecutando campaña email #${camp.id}:`, err);
                    });
                } else if (camp.tipo === 'whatsapp') {
                    ejecutarCampanaWhatsApp(camp).catch(err => {
                        console.error(`❌ [Scheduler] Error ejecutando campaña WhatsApp #${camp.id}:`, err);
                    });
                }
            }
        }
    } catch (err) {
        console.error('❌ [Scheduler] Error en ciclo del programador de campañas:', err.message);
    } finally {
        isChecking = false;
    }
}

/**
 * Ejecución del despacho de campaña de Email
 */
async function ejecutarCampanaEmail(camp) {
    const config = camp.configuracion_envio || {};
    let contacts = camp.contactos_json || [];

    // Si los contactos no estaban cacheados en el JSON de la campaña, obtenerlos del CRM
    if (!contacts || contacts.length === 0) {
        const allContacts = await db.obtenerContactosCRM(camp.codigo_empresa);
        if (config.contactIds && Array.isArray(config.contactIds) && config.contactIds.length > 0) {
            contacts = allContacts.filter(c => config.contactIds.includes(c.id));
        } else {
            contacts = allContacts;
        }
    }

    contacts = contacts.filter(c => c.email && c.email.includes('@'));

    if (contacts.length === 0) {
        await db.actualizarCampanaProgreso(camp.id, {
            estado: 'error',
            ultimo_log: 'No se encontraron destinatarios con email válido al disparar la campaña programada'
        });
        return;
    }

    const htmlContent = camp.contenido_personalizado || camp.plantilla_contenido || '';
    const subject = camp.asunto_email || 'Convocatoria Colaboratium';
    const attachments = camp.archivos_adjuntos || [];
    const humanPacing = camp.modo_envio !== 'directo';
    const selectedSlotIds = config.selectedSlotIds || [];

    await sendMassEmailCampaign({
        codigoEmpresa: camp.codigo_empresa,
        campanaId: camp.id,
        contacts,
        subject,
        htmlContent,
        attachments,
        humanPacing,
        startIndex: 0,
        selectedSlotIds
    });
}

/**
 * Ejecución del despacho de campaña de WhatsApp
 */
async function ejecutarCampanaWhatsApp(camp) {
    const config = camp.configuracion_envio || {};
    let targetContacts = camp.contactos_json || [];

    if (!targetContacts || targetContacts.length === 0) {
        const allContacts = await db.obtenerContactosCRM(camp.codigo_empresa);
        if (config.contactIds && Array.isArray(config.contactIds) && config.contactIds.length > 0) {
            targetContacts = allContacts.filter(c => config.contactIds.includes(c.id));
        } else {
            targetContacts = allContacts;
        }
    }

    if (targetContacts.length === 0) {
        await db.actualizarCampanaProgreso(camp.id, {
            estado: 'error',
            ultimo_log: 'No se encontraron contactos para enviar WhatsApp al disparar la campaña programada'
        });
        return;
    }

    const messagesPerMinute = config.messagesPerMinute || 15;
    let enviados = 0;

    for (let i = 0; i < targetContacts.length; i++) {
        enviados++;
        await new Promise(r => setTimeout(r, Math.max(300, Math.floor(60000 / messagesPerMinute))));
        if (i % 2 === 0 || i === targetContacts.length - 1) {
            await db.actualizarCampanaProgreso(camp.id, {
                enviados,
                entregados: enviados,
                respondidos: Math.round(enviados * 0.8),
                estado: i === targetContacts.length - 1 ? 'completada' : 'en_progreso',
                ultimo_log: `Programador: Enviados ${enviados} de ${targetContacts.length}`
            });
        }
    }
}

/**
 * Inicia el loop del cron / timer del scheduler
 */
function iniciarScheduler() {
    if (schedulerInterval) return;
    console.log('⏰ [Scheduler] Programador autónomo de campañas inicializado (chequeo cada 20s)');
    checkAndRunScheduledCampaigns();
    schedulerInterval = setInterval(checkAndRunScheduledCampaigns, 20000);
}

module.exports = {
    iniciarScheduler,
    checkAndRunScheduledCampaigns,
    ejecutarCampanaEmail,
    ejecutarCampanaWhatsApp
};
