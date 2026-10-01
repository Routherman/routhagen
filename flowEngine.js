const db = require('./database');
const { sendWhatsAppMessage } = require('./whatsappService');
const { processMessageWithAI } = require('./groqService');

/**
 * Ejecuta o avanza un flujo conversacional.
 * @param {Object} dbContacto - El contacto de la base de datos
 * @param {Object} cleanMessage - El mensaje entrante parseado
 * @param {Object} empresa - Datos de la empresa (para tokens y contexto)
 * @param {String} accessToken - Token de WhatsApp
 * @param {String} phoneId - ID del teléfono de WhatsApp
 * @param {Array} history - Historial de mensajes
 * @returns {Boolean} - Devuelve true si el mensaje fue manejado por el flujo, false si debe pasar a la IA general.
 */
async function handleFlowEngine(dbContacto, cleanMessage, empresa, accessToken, phoneId, history) {
    const codigoEmpresa = empresa.codigo;
    const userText = (cleanMessage.contenido || '').trim().toLowerCase();
    
    console.log(`[Flow] Iniciando motor para mensaje: "${userText}"`);

    // 1. Cargar todos los flujos activos de la empresa
    const flujos = await db.obtenerFlujos(codigoEmpresa);
    const flujosActivos = flujos.filter(f => f.activo);
    console.log(`[Flow] Flujos activos encontrados: ${flujosActivos.length}`);

    let activeFlowId = dbContacto.flujo_activo_id;
    let currentNodeId = dbContacto.nodo_actual_id;

    // 2. Si NO está en un flujo, verificar si el mensaje coincide con alguna palabra clave
    if (!activeFlowId) {
        const matchedFlow = flujosActivos.find(f => f.trigger_keyword && f.trigger_keyword.toLowerCase() === userText);
        if (matchedFlow) {
            console.log(`[Flow] ¡Palabra clave interceptada! Iniciando flujo: ${matchedFlow.nombre}`);
            activeFlowId = matchedFlow.id;
            
            let flowData = matchedFlow.data_json;
            if (typeof flowData === 'string') flowData = JSON.parse(flowData);
            
            const startNode = flowData.nodes.find(n => n.id === 'node_trigger' || n.type === 'webhook') || flowData.nodes[0];
            if (startNode) {
                currentNodeId = startNode.id;
                await db.pool.query('UPDATE contactos SET flujo_activo_id = ?, nodo_actual_id = ? WHERE id = ?', [activeFlowId, currentNodeId, dbContacto.id]);
                console.log(`[Flow] Nodo de inicio seteado a: ${currentNodeId}`);
            } else {
                console.log(`[Flow] No se encontró nodo de inicio.`);
            }
        }
    } else {
        console.log(`[Flow] El usuario ya está en el flujo activo: ${activeFlowId}`);
    }

    // 3. Si sigue sin flujo, no hacemos nada (pasa a la IA normal)
    if (!activeFlowId || !currentNodeId) {
        console.log(`[Flow] Ningún flujo aplicable. Pasando a IA genérica.`);
        return false; 
    }

    // 4. Cargar el flujo actual
    const flowRecord = flujosActivos.find(f => f.id === activeFlowId);
    if (!flowRecord) {
        console.log(`[Flow] El flujo activo no existe o fue desactivado. Limpiando estado.`);
        await clearFlowState(dbContacto.id);
        return false;
    }

    let flowData = flowRecord.data_json;
    if (typeof flowData === 'string') flowData = JSON.parse(flowData);

    const nodes = flowData.nodes || [];
    const edges = flowData.edges || [];
    
    console.log(`[Flow] Ejecutando diagrama con ${nodes.length} nodos y ${edges.length} conexiones.`);

    // --- BUCLE DE EJECUCIÓN DEL FLUJO ---
    let executing = true;
    // Si el usuario ya estaba en el flujo ANTES de este turno, estamos reanudando
    let isResuming = (dbContacto.flujo_activo_id === activeFlowId); 

    while (executing) {
        let currentNode = nodes.find(n => n.id === currentNodeId);
        if (!currentNode) {
            console.log(`[Flow] Nodo ${currentNodeId} no encontrado. Finalizando flujo.`);
            await clearFlowState(dbContacto.id);
            return true; // Terminado
        }

        if (isResuming) {
            console.log(`[Flow] Reanudando flujo desde el nodo: ${currentNode.type} (${currentNode.id})`);
            
            if (currentNode.type === 'identity') {
                const varName = currentNode.data?.variable_name || 'dato_extra';
                console.log(`[Flow] Variable guardada: ${varName} = ${userText}`);
            } else if (currentNode.type === 'rag') {
                console.log(`[Flow] Ejecutando RAG local con el mensaje del usuario.`);
                const nodePrompt = currentNode.data?.prompt || 'Eres un asistente útil.';
                const rolesEmpresa = await db.obtenerRoles(codigoEmpresa);
                const rolesString = rolesEmpresa.map(r => r.nombre).join(', ');
                const context = {
                    ...empresa,
                    prompt_ia: `${nodePrompt}\n\n[CONTEXTO OBLIGATORIO]\nINFORMACIÓN DEL CONTACTO:\nNombre: ${dbContacto.nombre}\nTeléfono: ${dbContacto.identificador_valor}\nROLES DISPONIBLES:\n${rolesString}`
                };
                
                let aiResponse = await processMessageWithAI(cleanMessage.contenido, history, context);
                
                const roleMatch = aiResponse.match(/\[ROLE:(.*?)\]/i);
                if (roleMatch) {
                    const rolName = roleMatch[1].trim();
                    await db.actualizarAsignacionContacto(dbContacto.id, rolName);
                    aiResponse = aiResponse.replace(/\[ROLE:.*?\]/ig, '').trim();
                    console.log(`[Flow] RAG derivó a rol: ${rolName}`);
                }

                if (aiResponse.includes('[HANDOFF]')) {
                    console.log(`[Flow] RAG disparó HANDOFF.`);
                    await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
                    aiResponse = aiResponse.replace(/\[HANDOFF\]/g, '').trim() || 'Un asesor se conectará pronto.';
                    await clearFlowState(dbContacto.id);
                }

                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, aiResponse, phoneId, accessToken);
                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', aiResponse);
                console.log(`[Flow] RAG respondió correctamente.`);
                return true; // RAG responde y espera al próximo mensaje
            }

            // Después de procesar la respuesta, avanzamos al siguiente nodo
            const nextEdge = edges.find(e => e.source === currentNode.id);
            if (!nextEdge) {
                console.log(`[Flow] Fin del camino tras reanudar. Limpiando estado.`);
                await clearFlowState(dbContacto.id);
                return true; 
            }

            currentNodeId = nextEdge.target;
            await db.pool.query('UPDATE contactos SET nodo_actual_id = ? WHERE id = ?', [currentNodeId, dbContacto.id]);
            isResuming = false; // Ya no estamos reanudando, pasamos a ejecutar el nuevo nodo
            continue; // Volver al inicio del while
        }

        // --- EJECUTAR ACCIÓN DEL NODO ACTUAL ---
        console.log(`[Flow] Ejecutando nodo: ${currentNode.type} (${currentNode.id})`);

        if (currentNode.type === 'message') {
            const msg = currentNode.data?.message || '';
            if (msg) {
                console.log(`[Flow] Enviando mensaje: "${msg}"`);
                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, msg, phoneId, accessToken);
                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', msg);
                console.log(`[Flow] Mensaje enviado exitosamente.`);
            }
        } 
        else if (currentNode.type === 'identity') {
            const question = currentNode.data?.question || '¿Cuál es tu respuesta?';
            console.log(`[Flow] Solicitando Identity: "${question}"`);
            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, question, phoneId, accessToken);
            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', question);
            executing = false; // Pausamos el flujo esperando respuesta del usuario
            continue;
        }
        else if (currentNode.type === 'rag') {
            console.log(`[Flow] Llegamos a nodo RAG. Pausando flujo para el próximo turno.`);
            executing = false;
            continue;
        }
        else if (currentNode.type === 'approval') {
            console.log(`[Flow] Derivando a humano.`);
            await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
            const handoffMsg = "Entiendo. Un asesor humano se conectará al chat en breve para ayudarte.";
            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, handoffMsg, phoneId, accessToken);
            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', handoffMsg);
            
            await clearFlowState(dbContacto.id);
            executing = false;
            continue;
        }
        else if (currentNode.type === 'node_trigger' || currentNode.type === 'webhook') {
            console.log(`[Flow] Nodo trigger inicial. Pasando al siguiente.`);
        }

        // --- AVANZAR (Solo si el nodo actual no pausó la ejecución) ---
        const nextEdge = edges.find(e => e.source === currentNode.id);
        if (!nextEdge) {
            console.log(`[Flow] Fin del camino alcanzado. Limpiando estado.`);
            await clearFlowState(dbContacto.id);
            executing = false;
        } else {
            currentNodeId = nextEdge.target;
            await db.pool.query('UPDATE contactos SET nodo_actual_id = ? WHERE id = ?', [currentNodeId, dbContacto.id]);
        }
    }

    return true; 
}

async function clearFlowState(contactoId) {
    await db.pool.query('UPDATE contactos SET flujo_activo_id = NULL, nodo_actual_id = NULL WHERE id = ?', [contactoId]);
}

module.exports = {
    handleFlowEngine
};
