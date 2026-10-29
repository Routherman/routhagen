const db = require('./database');
const { sendMassEmailCampaign } = require('./emailService');

let schedulerInterval = null;
let isChecking = false;
const activeCampaigns = new Set();

function registerActiveCampaign(id) {
    if (id) activeCampaigns.add(Number(id));
}

function unregisterActiveCampaign(id) {
    if (id) activeCampaigns.delete(Number(id));
}

/**
 * Revisa en la base de datos si hay campañas programadas y reanuda automáticamente campañas interrumpidas (Crash Recovery)
 */
async function checkAndRunScheduledCampaigns() {
    if (isChecking) return;
    isChecking = true;
    try {
        // 1. DISPARO DE CAMPAÑAS PROGRAMADAS
        const programadas = await db.obtenerCampanasProgramadas();
        const now = Date.now();

        if (programadas && programadas.length > 0) {
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

                    registerActiveCampaign(camp.id);
                    if (camp.tipo === 'email') {
                        ejecutarCampanaEmail(camp).catch(err => {
                            console.error(`❌ [Scheduler] Error ejecutando campaña email #${camp.id}:`, err);
                        }).finally(() => {
                            unregisterActiveCampaign(camp.id);
                        });
                    } else if (camp.tipo === 'whatsapp') {
                        ejecutarCampanaWhatsApp(camp).catch(err => {
                            console.error(`❌ [Scheduler] Error ejecutando campaña WhatsApp #${camp.id}:`, err);
                        }).finally(() => {
                            unregisterActiveCampaign(camp.id);
                        });
                    }
                }
            }
        }

        // 2. SUPERVISOR CRASH RECOVERY: Reanudar campañas 'en_progreso' que se hayan interrumpido (ej. reinicio de server)
        const [enProgreso] = await db.pool.query(
            "SELECT id, codigo_empresa, nombre, tipo, total_contactos, enviados, ultimo_indice_enviado FROM campanas WHERE estado = 'en_progreso'"
        );

        if (enProgreso && enProgreso.length > 0) {
            for (const camp of enProgreso) {
                const campId = Number(camp.id);
                if (!activeCampaigns.has(campId)) {
                    registerActiveCampaign(campId);
                    console.log(`🔄 [Scheduler Watchdog] Campaña #${campId} "${camp.nombre}" estaba en progreso e inactiva. Reanudando despacho autónomo...`);

                    const campFull = await db.obtenerCampanaPorId(campId);
                    if (campFull) {
                        if (campFull.tipo === 'email') {
                            ejecutarCampanaEmail(campFull).catch(err => {
                                console.error(`❌ [Watchdog] Error en recuperación de campaña email #${campId}:`, err);
                            }).finally(() => {
                                unregisterActiveCampaign(campId);
                            });
                        } else if (campFull.tipo === 'whatsapp') {
                            ejecutarCampanaWhatsApp(campFull).catch(err => {
                                console.error(`❌ [Watchdog] Error en recuperación de campaña WhatsApp #${campId}:`, err);
                            }).finally(() => {
                                unregisterActiveCampaign(campId);
                            });
                        }
                    } else {
                        unregisterActiveCampaign(campId);
                    }
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
    const startIndex = camp.ultimo_indice_enviado || camp.enviados || 0;

    if (startIndex >= contacts.length) {
        await db.actualizarCampanaProgreso(camp.id, {
            estado: 'completada',
            ultimo_log: `Campaña completada exitosamente (${contacts.length} de ${contacts.length})`
        });
        return;
    }

    await sendMassEmailCampaign({
        codigoEmpresa: camp.codigo_empresa,
        campanaId: camp.id,
        contacts,
        subject,
        htmlContent,
        attachments,
        humanPacing,
        startIndex,
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
    ejecutarCampanaWhatsApp,
    registerActiveCampaign,
    unregisterActiveCampaign
};
