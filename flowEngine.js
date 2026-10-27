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

    // 1.1 Analizar los últimos mensajes (historial) para reconocer el contexto de la conversación (ej: plantillas enviadas)
    let recentMessages = history || [];
    if (!recentMessages || recentMessages.length < 2) {
        recentMessages = await db.obtenerHistorialMensajes(dbContacto.id, 10);
    }

    // Buscar en el historial si el último mensaje saliente relevante fue una plantilla
    const reversedMessages = [...recentMessages].reverse();
    const lastOutgoingMsg = reversedMessages.find(m => m.direccion === 'SALIENTE') || null;

    let templateContext = null; // 'asesores' | 'lideres' | 'inversores'

    if (lastOutgoingMsg) {
        const isTemplate = lastOutgoingMsg.tipo === 'template' || 
                           (lastOutgoingMsg.contenido && lastOutgoingMsg.contenido.includes('[Plantilla:')) ||
                           (lastOutgoingMsg.contenido && /reunion_informativa|bienvenida_asesores|convocatoria_lideres|simulador_y_propuesta|sumarte al equipo comercial|futuros asesores/i.test(lastOutgoingMsg.contenido));

        if (isTemplate) {
            const outContent = ((lastOutgoingMsg.contenido || '') + ' ' + (lastOutgoingMsg.tipo || '')).toLowerCase();

            // Identificar si la plantilla enviada fue de Asesores
            if (
                outContent.includes('bienvenida_asesores_colaboratium') ||
                outContent.includes('reunion_informativa_asesores') ||
                outContent.includes('asesor') ||
                outContent.includes('asesores') ||
                outContent.includes('equipo comercial') ||
                outContent.includes('futuros asesores') ||
                outContent.includes('propuesta de trabajo')
            ) {
                templateContext = 'asesores';
            } 
            // Identificar si la plantilla enviada fue de Líderes
            else if (
                outContent.includes('convocatoria_lideres_de_equipo') ||
                outContent.includes('lider') ||
                outContent.includes('lideres') ||
                outContent.includes('equipo de trabajo') ||
                outContent.includes('broker')
            ) {
                templateContext = 'lideres';
            }
            // Identificar si la plantilla enviada fue de Inversores
            else if (
                outContent.includes('simulador_y_propuesta_inversores') ||
                outContent.includes('inversor') ||
                outContent.includes('inversores') ||
                outContent.includes('rendimiento') ||
                outContent.includes('simulador')
            ) {
                templateContext = 'inversores';
            }
        }
    }

    if (templateContext) {
        console.log(`[Flow] Contexto detectado desde los últimos mensajes (Plantilla): "${templateContext.toUpperCase()}"`);
    }

    // 2. Verificar si el mensaje coincide con alguna palabra clave de flujo (priorizando la coincidencia más específica/larga)
    let matchedFlow = null;
    let longestMatchLen = 0;

    for (const f of flujosActivos) {
        if (!f.trigger_keyword) continue;

        // Si se envió una plantilla previamente (templateContext activo), no permitir que las palabras genéricas de saludo
        // del Flujo Maestro de Bienvenida ("hola", "buenas", "buenas tardes") secuestren la respuesta al template.
        const isMasterMenu = f.nombre.toLowerCase().includes('bienvenida') || f.nombre.toLowerCase().includes('maestro');
        if (templateContext && isMasterMenu) {
            continue;
        }

        const keywords = f.trigger_keyword.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        const cleanUserText = userText.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');

        // Si el usuario ya está dentro de un flujo activo y escribe un solo número (ej: 1, 2, 3),
        // este número pertenece a las opciones/slots del flujo actual, no a un trigger de cambio global.
        if (activeFlowId && /^[1-9]$/.test(cleanUserText)) {
            continue;
        }

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

    // 2.1 Si se envió previamente una plantilla y el usuario responde, activar el flujo correspondiente según el contexto reconocido
    if (!matchedFlow) {
        const cleanUser = userText.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');
        const isGreeting = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'que tal', 'saludos', 'como estás', 'como estas', 'inicio', 'empezar', 'menu'].some(g => userText === g || cleanUser === g || userText.startsWith(g) || cleanUser.startsWith(g));
        const isAffirmativeOrInterested = /^(s[ií]|si por favor|si claro|me interesa|quiero|quiero participar|quiero sumarme|contame|contame mas|info|informacion|cuando es|a que hora|donde es|confirmar|confirmo|dale|ok|de que se trata|estoy interesado|buenas me interesa|hola me interesa|estoy disponible)\b/i.test(userText);

        if (templateContext === 'asesores') {
            const flowAsesor = flujosActivos.find(f => 
                f.id === 12 || 
                f.nombre.toLowerCase().includes('asesor') || 
                (f.trigger_keyword && f.trigger_keyword.toLowerCase().includes('asesor'))
            );
            if (flowAsesor) {
                matchedFlow = flowAsesor;
                console.log(`[Flow] Contexto ASESORES detectado desde la plantilla enviada. Asignando Flujo de Asesor: ${matchedFlow.nombre}`);
                await db.actualizarAsignacionContacto(dbContacto.id, 'Asesores');
                dbContacto.rol_asignado = 'Asesores';
            }
        } else if (templateContext === 'lideres') {
            const flowLider = flujosActivos.find(f => 
                f.id === 14 || 
                f.nombre.toLowerCase().includes('lider') || 
                (f.trigger_keyword && f.trigger_keyword.toLowerCase().includes('lider'))
            );
            if (flowLider) {
                matchedFlow = flowLider;
                console.log(`[Flow] Contexto LÍDERES detectado desde la plantilla enviada. Asignando Flujo de Líder: ${matchedFlow.nombre}`);
                await db.actualizarAsignacionContacto(dbContacto.id, 'Lideres');
                dbContacto.rol_asignado = 'Lideres';
            }
        } else if (templateContext === 'inversores') {
            const flowInversor = flujosActivos.find(f => 
                f.id === 13 || 
                f.nombre.toLowerCase().includes('inversor') || 
                (f.trigger_keyword && f.trigger_keyword.toLowerCase().includes('inversor'))
            );
            if (flowInversor) {
                matchedFlow = flowInversor;
                console.log(`[Flow] Contexto INVERSORES detectado desde la plantilla enviada. Asignando Flujo de Inversor: ${matchedFlow.nombre}`);
                await db.actualizarAsignacionContacto(dbContacto.id, 'Inversores');
                dbContacto.rol_asignado = 'Inversores';
            }
        } else if (isGreeting) {
            // Fallback genérico para saludos solo si no hubo plantilla contextual previa
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
        console.log(`[Flow] ¡Palabra clave/Contexto interceptado! Iniciando flujo: ${matchedFlow.nombre}`);
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

                // Detección de selección de slot interactivo o texto para Asesores
                const isCalendarNode = currentNode.id === 'node_a3_captura' || varName === 'datos_contacto_asesor';
                if (isCalendarNode) {
                    const emailMatch = cleanMessage.contenido.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    const slotChoiceMatch = cleanMessage.contenido.match(/slot_([1-6])|\b([1-6])\b/i);
                    const slotChoice = slotChoiceMatch ? (slotChoiceMatch[1] || slotChoiceMatch[2]) : '1';

                    const detectedEmail = emailMatch ? emailMatch[0] : (dbContacto.email || '');

                    // Si no tiene email aún pero seleccionó un horario (muy común al tocar el list selector de WhatsApp)
                    if (!detectedEmail) {
                        const { getAvailableWebinarSlots } = require('./googleCalendarService');
                        const slots = await getAvailableWebinarSlots(codigoEmpresa, 'asesores');
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
                            codigoEmpresa,
                            category: 'asesores'
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

                // Detección de datos de Red y selección de turnos para Líderes de Equipo
                const isLeaderNode = currentNode.id === 'node_c3_captura' || varName === 'datos_red_lider' || dbContacto.rol_asignado === 'Lideres';
                if (isLeaderNode) {
                    const rawLower = cleanMessage.contenido.toLowerCase().trim();
                    const emailMatch = cleanMessage.contenido.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    const detectedEmail = emailMatch ? emailMatch[0].toLowerCase().trim() : (dbContacto.email || '');

                    // Detección flexible de opción de turno:
                    let slotChoice = null;
                    const slotChoiceMatch = cleanMessage.contenido.match(/slot_([1-6])|\b([1-6])\b|opci[oó]n\s*([1-6])/i);
                    if (slotChoiceMatch) {
                        slotChoice = slotChoiceMatch[1] || slotChoiceMatch[2] || slotChoiceMatch[3];
                    } else if (rawLower.includes('martes') || rawLower.includes('virtual') || rawLower.includes('meet')) {
                        slotChoice = '1';
                    } else if (rawLower.includes('jueves') || rawLower.includes('presencial') || rawLower.includes('vicente') || rawLower.includes('oficina')) {
                        slotChoice = '2';
                    }

                    // Extraer nombre del líder si vino en el texto
                    let detectedName = cleanMessage.contenido
                        .split('\n')[0]
                        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                        .replace(/[0-9+()\-]/g, '')
                        .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                        .trim();
                    if (!detectedName || detectedName.length < 2) detectedName = dbContacto.nombre || 'Líder Comercial';

                    // Si el líder ya eligió un turno (ej. slot_1, "1", "2", "Martes", "Presencial", etc.):
                    if (slotChoice && detectedEmail) {
                        try {
                            const { processBooking } = require('./googleCalendarService');
                            const bookingRes = await processBooking({
                                slotChoice,
                                customerName: detectedName,
                                customerEmail: detectedEmail,
                                customerPhone: cleanMessage.identificador.valor,
                                codigoEmpresa,
                                category: 'lideres'
                            });

                            if (bookingRes && bookingRes.whatsappResponse) {
                                const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, bookingRes.whatsappResponse, phoneId, accessToken);
                                await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', bookingRes.whatsappResponse);
                                await clearFlowState(dbContacto.id);
                                return true;
                            }
                        } catch (bookingErr) {
                            console.error('[Flow] Error en booking de líder:', bookingErr.message);
                        }
                    }

                    // Si el líder eligió un turno pero todavía no tenemos su email
                    if (slotChoice && !detectedEmail) {
                        const { getAvailableWebinarSlots } = require('./googleCalendarService');
                        const slots = await getAvailableWebinarSlots(codigoEmpresa, 'lideres');
                        const chosen = slots.find(s => s.id === parseInt(slotChoice, 10)) || slots[0];

                        const promptForEmail = `¡Excelente elección, Líder! 👑 Reservaste tu turno para:\n*${chosen.titulo}*\n🗓️ ${chosen.fechaStr} (${chosen.horarioStr})\n\n👉 Para emitir tu invitación formal y enviarte el acceso a Google Meet o datos de recepción ejecutiva, por favor respóndeme con tu *Nombre completo*, tu *Correo electrónico* y cuántos asesores integran tu equipo:`;

                        const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, promptForEmail, phoneId, accessToken);
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', promptForEmail);
                        return true; // Espera el siguiente mensaje con los datos
                    }

                    // Si ya habíamos registrado sus datos (email ya existe en BD) y no eligió slot, puede estar haciendo una consulta:
                    const alreadyCaptured = !!dbContacto.email && !emailMatch;
                    if (alreadyCaptured) {
                        console.log(`[Flow] Líder con datos ya registrados realizó consulta adicional. Derivando a RAG.`);
                        const nextEdge = edges.find(e => e.source === currentNode.id);
                        if (nextEdge) {
                            currentNodeId = nextEdge.target;
                            await db.pool.query('UPDATE contactos SET flujo_activo_id = ?, nodo_actual_id = ? WHERE id = ?', [activeFlowId, nextEdge.target, dbContacto.id]);
                            isResuming = false;
                            continue;
                        }
                    }

                    // Si el líder envió sus datos de red por primera vez:
                    const cleanPhone = (cleanMessage.identificador.valor || '').replace(/\D/g, '');
                    
                    // 1. Actualizar contacto en BD con su nombre real, email y grupo LIDERES
                    await db.actualizarContactoCRM(dbContacto.id, codigoEmpresa, {
                        nombre: detectedName,
                        email: detectedEmail || null,
                        grupo: 'LIDERES'
                    });
                    await db.actualizarAsignacionContacto(dbContacto.id, 'Lideres');

                    // 2. Crear Ticket Helpdesk para Líderes
                    let ticketId = null;
                    try {
                        ticketId = await db.crearTicket(
                            codigoEmpresa,
                            dbContacto.id,
                            cleanPhone,
                            detectedName,
                            'pending_auth',
                            `Líder de Red interesado: ${detectedName} (${detectedEmail}) - ${cleanMessage.contenido.replace(/\n/g, ' ')}`,
                            null,
                            'Equipo Líderes'
                        );
                    } catch (tErr) {
                        console.error('[Flow] Error creando ticket de líder:', tErr.message);
                    }

                    // 3. Notificar por email a colaboratium@gmail.com
                    try {
                        const { sendLeaderInquiryToCompany } = require('./emailService');
                        await sendLeaderInquiryToCompany({
                            nombre: detectedName,
                            email: detectedEmail || 'Sin email provisto',
                            telefono: cleanPhone,
                            datosRed: cleanMessage.contenido,
                            ticketId
                        });
                    } catch (mailErr) {
                        console.error('[Flow] Error enviando email de líder a la empresa:', mailErr.message);
                    }

                    // 4. Ofrecerle las opciones de webinar y reunión ejecutiva de líderes por WhatsApp
                    const { sendWhatsAppInteractiveList } = require('./whatsappService');
                    const { formatInteractiveCalendarList, formatCalendarOptionsText } = require('./googleCalendarService');

                    let sentInteractive = false;
                    try {
                        const listPayload = await formatInteractiveCalendarList(codigoEmpresa, 'lideres');
                        const outMetaId = await sendWhatsAppInteractiveList(cleanMessage.identificador.valor, listPayload, phoneId, accessToken);
                        if (outMetaId) {
                            sentInteractive = true;
                            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'interactive', 'Menú Interactivo: Turnos para Líderes de Equipo');
                            console.log(`[Flow] Formulario interactivo de líderes enviado exitosamente.`);
                        }
                    } catch (listErr) {
                        console.warn(`[Flow] Falló interactive list de líderes, usando texto:`, listErr.message);
                    }

                    if (!sentInteractive) {
                        const cleanText = await formatCalendarOptionsText(codigoEmpresa, 'lideres');
                        const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, cleanText, phoneId, accessToken);
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', cleanText);
                    }

                    return true; // Espera que el líder elija su opción
                }

                // Detección de registro y solicitud de asesor para Inversores de Capital
                const isInvestorNode = currentNode.id === 'node_b4_captura' || varName === 'datos_registro_inversor' || varName === 'perfil_capital_inversor' || dbContacto.rol_asignado === 'Inversores';
                if (isInvestorNode) {
                    const rawLower = cleanMessage.contenido.toLowerCase().trim();
                    const emailMatch = cleanMessage.contenido.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    const cleanPhone = (cleanMessage.identificador.valor || '').replace(/\D/g, '');

                    // Caso A: El inversor ya tiene email registrado y responde a la pregunta de si desea un Asesor Personalizado
                    const wantsAdvisorMatch = /^(s[ií]|dale|por favor|me interesa|quiero|ok|bueno|si por favor|si me interesa|necesito asesor)\b/i.test(rawLower);
                    const rejectsAdvisorMatch = /^(no|por ahora no|no gracias|solo|autogestion)\b/i.test(rawLower);

                    if (dbContacto.email && (wantsAdvisorMatch || rejectsAdvisorMatch)) {
                        if (wantsAdvisorMatch) {
                            try {
                                await db.crearTicket(
                                    codigoEmpresa,
                                    dbContacto.id,
                                    cleanPhone,
                                    dbContacto.nombre || 'Inversor Registrado',
                                    'pending_auth',
                                    `Inversor solicita Asesor Personalizado: ${dbContacto.nombre} (${dbContacto.email}) - Pendiente de delegar a Agente o Líder`,
                                    null,
                                    'Mesa de Inversiones'
                                );
                            } catch (e) {
                                console.error('[Flow] Error actualizando ticket inversor:', e.message);
                            }

                            const confirmMsg = `¡Excelente! 🤝 Hemos generado la solicitud en nuestro sistema. El equipo de Dirección Comercial te asignará un *Asesor Financiero personalizado* quien se pondrá en contacto contigo a la brevedad para acompañarte en tu primera inversión.`;
                            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, confirmMsg, phoneId, accessToken);
                            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', confirmMsg);
                            await clearFlowState(dbContacto.id);
                            return true;
                        } else {
                            const selfMsg = `¡Entendido! Podés realizar tu registro y colocación de forma 100% autogestionada siguiendo la guía enviada a tu correo. Ante cualquier inquietud o consulta sobre el simulador, estamos a tu disposición por este medio.`;
                            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, selfMsg, phoneId, accessToken);
                            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', selfMsg);
                            await clearFlowState(dbContacto.id);
                            return true;
                        }
                    }

                    // Caso B: El inversor envía sus datos por primera vez (Nombre, email, monto)
                    const detectedEmail = emailMatch ? emailMatch[0].toLowerCase().trim() : (dbContacto.email || '');
                    let detectedName = cleanMessage.contenido
                        .split('\n')[0]
                        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                        .replace(/[0-9+()$\-]/g, '')
                        .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                        .trim();
                    if (!detectedName || detectedName.length < 2) detectedName = dbContacto.nombre || 'Inversor Registrado';

                    // 1. Actualizar contacto en CRM
                    await db.actualizarContactoCRM(dbContacto.id, codigoEmpresa, {
                        nombre: detectedName,
                        email: detectedEmail || null,
                        grupo: 'INVERSORES'
                    });
                    await db.actualizarAsignacionContacto(dbContacto.id, 'Inversores');

                    // 2. Crear Ticket Helpdesk en estado 'pending_auth'
                    let ticketId = null;
                    try {
                        ticketId = await db.crearTicket(
                            codigoEmpresa,
                            dbContacto.id,
                            cleanPhone,
                            detectedName,
                            'pending_auth',
                            `Inversor registrado: ${detectedName} (${detectedEmail}) - Capital/Detalle: ${cleanMessage.contenido.replace(/\n/g, ' ')}`,
                            null,
                            'Mesa de Inversiones'
                        );
                    } catch (tErr) {
                        console.error('[Flow] Error creando ticket inversor:', tErr.message);
                    }

                    // 3. Enviar Guía de Ingreso, Login y Operatoria al Inversor por email
                    if (detectedEmail) {
                        try {
                            const { sendInvestorWelcomeGuide, sendInvestorInquiryToCompany } = require('./emailService');
                            await sendInvestorWelcomeGuide({
                                nombre: detectedName,
                                email: detectedEmail,
                                telefono: cleanPhone,
                                detalles: cleanMessage.contenido
                            });
                            await sendInvestorInquiryToCompany({
                                nombre: detectedName,
                                email: detectedEmail,
                                telefono: cleanPhone,
                                detalles: cleanMessage.contenido,
                                ticketId
                            });
                        } catch (mailErr) {
                            console.error('[Flow] Error despachando email inversor:', mailErr.message);
                        }
                    }

                    // 4. Enviar mensaje de WhatsApp confirmando y preguntando si desea Asesor personalizado
                    const investorReply = `¡Muchas gracias, *${detectedName}*! 📈 Te acabamos de enviar a *${detectedEmail || 'tu casilla de correo'}* la *Guía Oficial de Ingreso y Operatoria* con el paso a paso para acceder a la plataforma, validar tu identidad ante el BCRA y fondear tu CVU bancarizado.\n\n` +
                        `📊 *Simulador Online:* Recordá que podés calcular tus retornos según plazo en https://colaboratium.com.ar/inversiones.php#simulador (montos desde *$100.000* hasta *$10.000.000* sin papeles extra).\n\n` +
                        `👉 *¿Te gustaría que te asignemos un Asesor Financiero personalizado para acompañarte y resolver cualquier duda en tu primera inversión?* (Responde *Sí* o *No*)`;

                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, investorReply, phoneId, accessToken);
                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', investorReply);
                    return true; // Espera respuesta de Sí o No para delegar el ticket
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
                    let aiSummary = `Contacto solicita derivación al sector ${rolName}. Consulta: "${cleanMessage.contenido}"`;
                    try {
                        const { summarizeConversationWithAI } = require('./aiRouter');
                        const historyRows = await db.obtenerHistorialMensajes(dbContacto.id, 8);
                        if (historyRows && historyRows.length > 0) {
                            const chatText = historyRows.map(m => `${m.direccion === 'SALIENTE' ? 'Bot' : 'Usuario'}: ${m.contenido}`).join('\n') + `\nUsuario: ${cleanMessage.contenido}`;
                            aiSummary = await summarizeConversationWithAI(chatText, empresa.codigo || 'KRZMJI');
                        }
                    } catch (sumErr) {
                        console.warn('Error generando resumen IA al derivar en flowEngine:', sumErr.message);
                    }

                    await db.derivarContactoTeam(dbContacto.id, empresa.codigo || 'KRZMJI', rolName, null, 'IA RAG Bot', aiSummary);
                    aiResponse = aiResponse.replace(/\[ROLE:.*?\]/ig, '').trim();
                    console.log(`[Flow] RAG derivó a rol: ${rolName} con resumen IA: ${aiSummary}`);
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
            const isLeaderCalendarNode = currentNode.id === 'node_c3_captura' || varName === 'datos_red_lider';
            const isWelcomeMenu = currentNode.id === 'node_id_seleccion' || varName === 'opcion_seleccionada';

            if (isWelcomeMenu) {
                const { sendWhatsAppInteractiveList, formatWelcomeInteractiveList } = require('./whatsappService');
                let sentInteractive = false;
                try {
                    const welcomePayload = formatWelcomeInteractiveList();
                    const outMetaId = await sendWhatsAppInteractiveList(cleanMessage.identificador.valor, welcomePayload, phoneId, accessToken);
                    if (outMetaId) {
                        sentInteractive = true;
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'interactive', 'Menú Principal: Selección de Perfil');
                        console.log(`[Flow] Menú interactivo de bienvenida enviado exitosamente.`);
                    }
                } catch (e) {
                    console.warn(`[Flow] Falló menú interactivo de bienvenida (${e.message}), enviando texto.`);
                }

                if (!sentInteractive) {
                    const question = currentNode.data?.question || '¿Qué perfil deseas explorar? Escribe 1 (Inversor), 2 (Asesor) o 3 (Líder):';
                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, question, phoneId, accessToken);
                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', question);
                }
            } else if (isCalendarNode) {
                const emailMatch = cleanMessage.contenido?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                const slotChoiceMatch = cleanMessage.contenido?.match(/slot_([1-6])|\b([1-6])\b|opci[oó]n\s*([1-6])/i);
                
                // Si el mensaje entrante ya contiene un correo electrónico para agendar directo
                if (emailMatch) {
                    const detectedEmail = emailMatch[0];
                    const slotChoice = slotChoiceMatch ? (slotChoiceMatch[1] || slotChoiceMatch[2] || slotChoiceMatch[3]) : '1';
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
                            codigoEmpresa,
                            category: 'asesores'
                        });

                        if (bookingRes && bookingRes.whatsappResponse) {
                            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, bookingRes.whatsappResponse, phoneId, accessToken);
                            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', bookingRes.whatsappResponse);
                            await clearFlowState(dbContacto.id);
                            executing = false;
                            continue;
                        }
                    } catch (bookingErr) {
                        console.error('[Flow] Error en processBooking directo en captura:', bookingErr.message);
                    }
                }

                const { sendWhatsAppInteractiveList } = require('./whatsappService');
                const { formatInteractiveCalendarList, formatCalendarOptionsText } = require('./googleCalendarService');
                
                let sentInteractive = false;
                try {
                    const listPayload = await formatInteractiveCalendarList(codigoEmpresa, 'asesores');
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
                    const cleanText = await formatCalendarOptionsText(codigoEmpresa, 'asesores');
                    const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, cleanText, phoneId, accessToken);
                    await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', cleanText);
                }
            } else if (isLeaderCalendarNode) {
                const { sendWhatsAppInteractiveList } = require('./whatsappService');
                const { formatInteractiveCalendarList, formatCalendarOptionsText } = require('./googleCalendarService');
                
                let sentInteractive = false;
                try {
                    const listPayload = await formatInteractiveCalendarList(codigoEmpresa, 'lideres');
                    const outMetaId = await sendWhatsAppInteractiveList(cleanMessage.identificador.valor, listPayload, phoneId, accessToken);
                    if (outMetaId) {
                        sentInteractive = true;
                        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'interactive', 'Menú Interactivo: Turnos para Líderes de Equipo');
                        console.log(`[Flow] Formulario interactivo de líderes enviado exitosamente.`);
                    }
                } catch (listErr) {
                    console.warn(`[Flow] Falló envío interactivo de líderes (${listErr.message}), usando texto limpio.`);
                }

                if (!sentInteractive) {
                    const cleanText = await formatCalendarOptionsText(codigoEmpresa, 'lideres');
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
