require('dotenv').config();
const { Queue, Worker } = require('bullmq');
const path = require('path');
const { processMessageWithAI, transcribeAudioWithGroq } = require('../groqService');
const { sendWhatsAppMessage, downloadWhatsAppMedia } = require('../whatsappService');
const { handleFlowEngine } = require('../flowEngine');
const { handleAdvisorDirectQuery } = require('../advisorService');
const connection = require('./redisClient');
const db = require('../database');

// Crear la cola de mensajes entrantes
const incomingMessageQueue = new Queue('incoming-messages', { 
    connection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100
    }
});

// Worker que procesará los mensajes encolados
// concurrency: 5 significa que procesará máximo 5 mensajes a la vez, protegiendo a Groq y la BD.
const incomingMessageWorker = new Worker('incoming-messages', async (job) => {
    const { cleanMessage, dbContacto, codigoEmpresa, empresa, phoneId, accessToken } = job.data;

    try {
        // 1. Obtener historial ANTES de guardar el mensaje actual (para no duplicarlo)
        const history = await db.obtenerHistorialMensajes(dbContacto.id, 10);

        // 2. Si es multimedia, descargar el archivo
        let contenidoFinal = cleanMessage.contenido;
        if (cleanMessage.id_media && accessToken) {
            const localUrl = await downloadWhatsAppMedia(cleanMessage.id_media, accessToken);
            if (localUrl) {
                // Si es un audio o nota de voz, transcribir con Whisper Groq para que la IA y flujos lo entiendan
                let transcription = '';
                if (cleanMessage.tipo_mensaje === 'audio') {
                    const localPath = path.join(__dirname, '..', 'public', localUrl.replace(/^\//, ''));
                    transcription = await transcribeAudioWithGroq(localPath);
                    if (transcription) {
                        cleanMessage.contenido = transcription;
                        console.log(`🎙️ [VOICE NOTE] Nota de voz de ${cleanMessage.remitente} transcribida: "${transcription}"`);
                    }
                }

                contenidoFinal = JSON.stringify({
                    url: localUrl,
                    caption: cleanMessage.contenido || '',
                    transcription: transcription || ''
                });
            }
        }

        // 3. Guardar mensaje entrante en la base de datos (se hace aquí para no bloquear el webhook)
        await db.guardarMensaje(
            dbContacto.id, 
            cleanMessage.id_mensaje_meta, 
            'ENTRANTE', 
            cleanMessage.tipo_mensaje, 
            contenidoFinal
        );

        console.log(`\n💬 [WORKER] Nuevo mensaje de ${cleanMessage.remitente} guardado en BD para empresa ${codigoEmpresa}.`);

        // Si el contacto estaba en HANDOFF pero respondió a una plantilla saliente (reanudación de ventana 24h)
        if (cleanMessage.contenido && dbContacto.estado_bot === 'HANDOFF') {
            const [recentOutgoingRows] = await db.pool.query(
                `SELECT id, tipo, contenido FROM mensajes WHERE contacto_id = ? AND direccion = 'SALIENTE' ORDER BY id DESC LIMIT 3`,
                [dbContacto.id]
            );
            const isTemplate = recentOutgoingRows.some(m => 
                m.tipo === 'template' || 
                (m.contenido && m.contenido.includes('[Plantilla:')) ||
                (m.contenido && /reunion_informativa|bienvenida_asesores|convocatoria_lideres|simulador_y_propuesta|sumarte al equipo comercial|futuros asesores/i.test(m.contenido))
            );

            if (isTemplate) {
                console.log(`✅ [WORKER] El cliente respondió a una plantilla. Reactivando Bot/Flujos e IA para ${cleanMessage.remitente}...`);
                await db.actualizarEstadoBot(dbContacto.id, 'ACTIVO');
                dbContacto.estado_bot = 'ACTIVO';
            }
        }

        // --- PROCESAMIENTO DE MENSAJES CON BOT ACTIVO ---
        if (cleanMessage.contenido && dbContacto.estado_bot === 'ACTIVO') {
            // 0. Interceptar consultas de Asesores (Precarga de inversores y reclamos de comisiones -> derivación a Líder)
            const handledByAdvisor = await handleAdvisorDirectQuery(dbContacto, cleanMessage, empresa, accessToken, phoneId, history);
            if (handledByAdvisor) {
                return { success: true, via: 'advisor_service' };
            }

            // --- FLUJO DE EJECUCIÓN GRÁFICA (React Flow & Plantillas de Asesor/Líder/Inversor) ---
            const handledByFlow = await handleFlowEngine(dbContacto, cleanMessage, empresa, accessToken, phoneId, history);
            
            // Si el flujo procesó el mensaje, no hacemos nada más en esta iteración.
            if (handledByFlow) {
                return { success: true, via: 'flow' };
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
                console.log(`✅ [WORKER] Chat asignado al rol: ${rolName}`);
            }
            
            if (aiResponse.includes('[HANDOFF]')) {
                console.log('⚠️ [WORKER] La IA derivó el chat a un humano. Guardando nuevo estado...');
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
                console.log(`✅ [WORKER] Respuesta enviada y guardada en BD para ${cleanMessage.remitente}`);
            }

            return { success: true, via: 'ai' };

        } else if (dbContacto.estado_bot === 'HANDOFF') {
            console.log(`⏸️ [WORKER] Chat en modo HANDOFF. La IA no responderá a ${cleanMessage.remitente}.`);
            return { success: true, via: 'ignored_handoff' };
        }

    } catch (error) {
        console.error('❌ [WORKER] Error procesando el mensaje:', error);
        throw error; // Esto hace que BullMQ lo reintente si configuramos retries
    }
}, {
    connection,
    concurrency: 5, // ¡El embudo! Solo procesa 5 a la vez.
    stalledInterval: 120000 // 2 minutos para reducir uso de comandos en Redis remoto/Upstash
});

// Manejo de errores a nivel de Worker
incomingMessageWorker.on('failed', (job, err) => {
    console.error(`❌ [WORKER] El trabajo ${job.id} falló después de todos los reintentos:`, err.message);
});

module.exports = {
    incomingMessageQueue,
    incomingMessageWorker
};
