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

    // 2. Verificar si el mensaje coincide con alguna palabra clave de flujo (priorizando la coincidencia más específica/larga)
    let matchedFlow = null;
    let longestMatchLen = 0;

    for (const f of flujosActivos) {
        if (!f.trigger_keyword) continue;
        const keywords = f.trigger_keyword.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        const cleanUserText = userText.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');

        for (const k of keywords) {
            let isMatch = false;
            // Coincidencia exacta o sin signos
            if (userText === k || cleanUserText === k) {
                isMatch = true;
            } else if (k.length >= 3) {
                // Si el usuario ya está en un flujo activo (ej: respondiendo a una pregunta),
                // solo cambiar de flujo si el texto ingresado es una orden/intención directa y breve,
                // no si la palabra clave aparece casualmente dentro de una respuesta larga.
                if (activeFlowId) {
                    const isCommandOrButton = k.startsWith('btn_') || ['1', '2', '3', 'menu', 'inicio', 'volver', 'empezar'].includes(k);
                    if (isCommandOrButton && (userText === k || cleanUserText === k)) {
                        isMatch = true;
                    } else if (userText.length <= k.length + 6) {
                        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|\\.|!|\\?|$)`, 'i');
                        if (regex.test(userText)) isMatch = true;
                    }
                } else {
                    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|\\.|!|\\?|$)`, 'i');
                    if (regex.test(userText)) isMatch = true;
                }
            }
            if (isMatch && k.length > longestMatchLen) {
                longestMatchLen = k.length;
                matchedFlow = f;
            }
        }
    }

    // Fallback inteligente para saludos si ningún flujo específico fue capturado
    if (!matchedFlow && (!activeFlowId || activeFlowId === null)) {
        const greetings = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'que tal', 'saludos', 'como estás', 'como estas', 'inicio', 'empezar', 'menu'];
        const cleanUser = userText.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');
        const isGreeting = greetings.some(g => userText === g || cleanUser === g || userText.startsWith(g) || cleanUser.startsWith(g));
        if (isGreeting) {
            const welcomeFlow = flujosActivos.find(f => 
                f.nombre.toLowerCase().includes('bienvenida') || 
                f.nombre.toLowerCase().includes('maestro') || 
                (f.trigger_keyword && f.trigger_keyword.toLowerCase().includes('hola'))
            ) || flujosActivos[0];
            if (welcomeFlow) {
                matchedFlow = welcomeFlow;
                console.log(`[Flow] Saludo genérico detectado ("${userText}"). Asignando Flujo Maestro: ${matchedFlow.nombre}`);
            }
        }
    }

    let justStartedFlow = false;
    if (matchedFlow && (!activeFlowId || matchedFlow.id !== activeFlowId)) {
        console.log(`[Flow] ¡Palabra clave interceptada! Iniciando flujo: ${matchedFlow.nombre}`);
        activeFlowId = matchedFlow.id;
        justStartedFlow = true;
        
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
    } else if (activeFlowId) {
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
    // Si el usuario ya estaba en el flujo ANTES de este turno y no acabamos de interceptar un nuevo flujo, estamos reanudando
    let isResuming = !justStartedFlow && (dbContacto.flujo_activo_id === activeFlowId); 

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

                // Detección de selección de slot interactivo o texto
                const isCalendarNode = currentNode.id === 'node_a3_captura' || varName === 'datos_contacto_asesor';
                if (isCalendarNode) {
                    const emailMatch = cleanMessage.contenido.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    const slotChoiceMatch = cleanMessage.contenido.match(/slot_([1-6])|\b([1-6])\b/i);
                    const slotChoice = slotChoiceMatch ? (slotChoiceMatch[1] || slotChoiceMatch[2]) : '1';

                    const detectedEmail = emailMatch ? emailMatch[0] : (dbContacto.email || '');

                    // Si no tiene email aún pero seleccionó un horario (muy común al tocar el list selector de WhatsApp)
                    if (!detectedEmail) {
                        const { getAvailableWebinarSlots } = require('./googleCalendarService');
                        const slots = await getAvailableWebinarSlots(codigoEmpresa);
                        const chosen = slots.find(s => s.id === parseInt(slotChoice, 10)) || slots[0];

                        const promptForEmail = `¡Excelente elección! 📅 Reservaste tu turno para:\n*${chosen.titulo}*\n🗓️ ${chosen.fechaStr} (${chosen.horarioStr})\n\n👉 Para emitir tu invitación formal y enviarte el acceso a Google Meet o datos de recepción, por favor respóndeme con tu *Nombre completo* y tu *Correo electrónico* (ej. *Juan Pérez juan@gmail.com*):`;

                        const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, promptForEmail, phoneId, accessToken);
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', promptForEmail);
                        return true; // Espera el siguiente mensaje con los datos
                    }

                    // Si ya tenemos email (o lo envió en este turno)
                    let detectedName = cleanMessage.contenido
                        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                        .replace(/slot_[1-6]|[1-6]/gi, '')
                        .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                        .trim();
                    if (!detectedName || detectedName.length < 2) detectedName = dbContacto.nombre || 'Asesor Candidato';

                    try {
                        const { processBooking } = require('./googleCalendarService');
                        const bookingRes = await processBooking({
                            slotChoice,
                            customerName: detectedName,
                            customerEmail: detectedEmail,
                            customerPhone: cleanMessage.identificador.valor,
                            codigoEmpresa
                        });

                        if (bookingRes && bookingRes.whatsappResponse) {
                            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, bookingRes.whatsappResponse, phoneId, accessToken);
                            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', bookingRes.whatsappResponse);
                            await clearFlowState(dbContacto.id);
                            return true; // Finalizado: ticket creado y confirmaciones enviadas a ambas casillas
                        }
                    } catch (bookingErr) {
                        console.error('[Flow] Error en processBooking:', bookingErr.message);
                    }
                }
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
            const varName = currentNode.data?.variable_name || '';
            const isCalendarNode = currentNode.id === 'node_a3_captura' || varName === 'datos_contacto_asesor';

            if (isCalendarNode) {
                const { sendWhatsAppInteractiveList } = require('./whatsappService');
                const { formatInteractiveCalendarList, formatCalendarOptionsText } = require('./googleCalendarService');
                
                let sentInteractive = false;
                try {
                    const listPayload = await formatInteractiveCalendarList(codigoEmpresa);
                    const outMetaId = await sendWhatsAppInteractiveList(cleanMessage.identificador.valor, listPayload, phoneId, accessToken);
                    if (outMetaId) {
                        sentInteractive = true;
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'interactive', 'Menú Interactivo: Selección de Turnos de Capacitación');
                        console.log(`[Flow] Formulario interactivo de WhatsApp enviado exitosamente.`);
                    }
                } catch (listErr) {
                    console.warn(`[Flow] Falló envío interactivo (${listErr.message}), usando texto limpio de respaldo.`);
                }

                if (!sentInteractive) {
                    const cleanText = await formatCalendarOptionsText(codigoEmpresa);
                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, cleanText, phoneId, accessToken);
                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', cleanText);
                }
            } else {
                const question = currentNode.data?.question || '¿Cuál es tu respuesta?';
                console.log(`[Flow] Solicitando Identity: "${question}"`);
                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, question, phoneId, accessToken);
                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', question);
            }
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
