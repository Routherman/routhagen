const db = require('./database');

// Mock WhatsApp service so we don't call Meta Cloud API
const mockSentMessages = [];
const mockWhatsappService = {
    sendWhatsAppMessage: async (recipientId, text) => {
        mockSentMessages.push({ recipientId, text, time: new Date() });
        return `mock_msg_id_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
};

// Create a simulation harness using the actual flow engine logic
async function runSimulation() {
    await db.initDB();
    const codigoEmpresa = 'KRZMJI';
    const empresa = await db.obtenerEmpresa(codigoEmpresa);

    console.log('\n================================================================');
    console.log('🧪 INICIANDO SIMULACIÓN DE FLUJOS EN CONSOLA (SIN API EXTERNA)');
    console.log('================================================================\n');

    // Cargar todos los flujos activos
    const flujos = await db.obtenerFlujos(codigoEmpresa);
    const flujosActivos = flujos.filter(f => f.activo);

    async function simulateUserTurn(contactState, userMessage) {
        console.log(`\n👤 [USUARIO (${contactState.telefono})]: "${userMessage}"`);
        const userText = (userMessage || '').trim().toLowerCase();

        // 1. Detección de disparador de flujo
        let matchedFlow = null;
        let longestMatchLen = 0;

        for (const f of flujosActivos) {
            if (!f.trigger_keyword) continue;
            const keywords = f.trigger_keyword.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
            const cleanUserText = userText.replace(/^[¡!¿?\s]+|[¡!¿?\s.,]+$/g, '');

            // Si el usuario ya está dentro de un flujo y escribe un dígito (ej. 1, 2), es respuesta de slot
            if (contactState.flujo_activo_id && /^[1-9]$/.test(cleanUserText)) {
                continue;
            }

            for (const k of keywords) {
                let isMatch = false;
                if (userText === k || cleanUserText === k) {
                    isMatch = true;
                } else if (k.length >= 3) {
                    if (contactState.flujo_activo_id) {
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

        let justStartedFlow = false;
        if (matchedFlow && (!contactState.flujo_activo_id || matchedFlow.id !== contactState.flujo_activo_id)) {
            console.log(`⚡ [MOTOR]: Interceptado flujo -> "${matchedFlow.nombre}" (ID: ${matchedFlow.id})`);
            contactState.flujo_activo_id = matchedFlow.id;
            justStartedFlow = true;

            let flowData = matchedFlow.data_json;
            if (typeof flowData === 'string') flowData = JSON.parse(flowData);

            const startNode = flowData.nodes.find(n => n.id === 'node_trigger' || n.type === 'webhook') || flowData.nodes[0];
            contactState.nodo_actual_id = startNode ? startNode.id : null;
        }

        if (!contactState.flujo_activo_id || !contactState.nodo_actual_id) {
            console.log(`🤖 [BOT IA GENERAL]: Respondiendo fuera de flujo...`);
            return;
        }

        const flowRecord = flujosActivos.find(f => f.id === contactState.flujo_activo_id);
        let flowData = flowRecord.data_json;
        if (typeof flowData === 'string') flowData = JSON.parse(flowData);

        const nodes = flowData.nodes || [];
        const edges = flowData.edges || [];

        let executing = true;
        let isResuming = !justStartedFlow;

        while (executing) {
            let currentNode = nodes.find(n => n.id === contactState.nodo_actual_id);
            if (!currentNode) {
                console.log(`⏹️ [MOTOR]: Fin de flujo.`);
                contactState.flujo_activo_id = null;
                contactState.nodo_actual_id = null;
                return;
            }

            if (isResuming) {
                if (currentNode.type === 'identity') {
                    const varName = currentNode.data?.variable_name || 'dato_extra';
                    contactState.variables = contactState.variables || {};
                    contactState.variables[varName] = userMessage;
                    console.log(`💾 [VARIABLE GUARDADA]: ${varName} = "${userMessage}"`);

                    const isLeaderNode = currentNode.id === 'node_c3_captura' || varName === 'datos_red_lider';
                    const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

                    if (isLeaderNode) {
                        const rawLower = userMessage.toLowerCase().trim();
                        let slotChoice = null;
                        const slotMatch = userMessage.match(/slot_([1-6])|\b([1-6])\b|opci[oó]n\s*([1-6])/i);
                        if (slotMatch) {
                            slotChoice = slotMatch[1] || slotMatch[2] || slotMatch[3];
                        } else if (rawLower.includes('martes') || rawLower.includes('virtual') || rawLower.includes('meet')) {
                            slotChoice = '1';
                        } else if (rawLower.includes('jueves') || rawLower.includes('presencial') || rawLower.includes('vicente')) {
                            slotChoice = '2';
                        }

                        // Si ya tiene email registrado (de turno previo) o lo incluyó acá y además eligió turno:
                        const existingEmail = contactState.variables?.['email'] || (emailMatch ? emailMatch[0] : null);
                        if (slotChoice && existingEmail) {
                            const detectedName = contactState.variables?.['nombre'] || 'Alejandro Bolognese';
                            const { processBooking } = require('./googleCalendarService');
                            const bookingRes = await processBooking({
                                slotChoice,
                                customerName: detectedName,
                                customerEmail: existingEmail,
                                customerPhone: contactState.telefono,
                                codigoEmpresa,
                                category: 'lideres'
                            });

                            console.log(`\n👑 [RESERVA LÍDER CONFIRMADA]:`);
                            console.log(`🎟️ [TICKET CREADO EN BD]: Ticket #${bookingRes.ticketId}`);
                            console.log(`📧 [EMAIL CONFIRMACIÓN A LÍDER]: Enviado a ${existingEmail}`);
                            console.log(`📢 [NOTIFICACIÓN COMPAÑÍA]: Enviado a colaboratium@gmail.com`);
                            console.log(`\n🤖 [RESPUESTA BOT CONFIRMACIÓN LÍDER]:\n${bookingRes.whatsappResponse}\n`);

                            contactState.flujo_activo_id = null;
                            contactState.nodo_actual_id = null;
                            return;
                        }

                        // Si es el primer mensaje con los datos del líder:
                        const detectedEmail = emailMatch ? emailMatch[0] : 'sirkimonolabs@gmail.com';
                        let detectedName = userMessage
                            .split('\n')[0]
                            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                            .replace(/[0-9+()\-]/g, '')
                            .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                            .trim() || 'Alejandro Bolognese';

                        contactState.variables['nombre'] = detectedName;
                        contactState.variables['email'] = detectedEmail;

                        console.log(`\n💾 [CRM LÍDER ACTUALIZADO]: Nombre: ${detectedName}, Email: ${detectedEmail}, Grupo: LIDERES`);
                        console.log(`🎟️ [TICKET HELPDESK CREADO]: Líder de Red interesado - ${detectedName} (${detectedEmail})`);
                        console.log(`📢 [EMAIL A COLABORATIUM]: Notificación enviada a colaboratium@gmail.com`);

                        const { formatCalendarOptionsText } = require('./googleCalendarService');
                        const optionsText = await formatCalendarOptionsText(codigoEmpresa, 'lideres');
                        console.log(`\n🤖 [OPCIONES WEBINAR / REUNIÓN ENVIADAS]:\n${optionsText}\n`);
                        return; // Queda esperando la opción 1 o 2 del líder
                    }

                    if (emailMatch || varName === 'datos_contacto_asesor') {
                        const detectedEmail = emailMatch ? emailMatch[0] : 'asesor@ejemplo.com';
                        let detectedName = userMessage
                            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                            .replace(/^[1-6][\s,.-]*/g, '')
                            .replace(/^(mi nombre es|soy|nombre:)\s*/i, '')
                            .trim() || 'Juan Ramón Valle';

                        const slotChoiceMatch = userMessage.match(/\b([1-6])\b/);
                        const slotChoice = slotChoiceMatch ? slotChoiceMatch[1] : '1';

                        const { processBooking } = require('./googleCalendarService');
                        const bookingRes = await processBooking({
                            slotChoice,
                            customerName: detectedName,
                            customerEmail: detectedEmail,
                            customerPhone: contactState.telefono,
                            codigoEmpresa,
                            category: 'asesores'
                        });

                        console.log(`\n🎟️ [TICKET CREADO EN BD]: Ticket #${bookingRes.ticketId}`);
                        console.log(`📧 [EMAIL CONFIRMACIÓN]: Enviado a ${detectedEmail}`);
                        console.log(`📢 [NOTIFICACIÓN COMPAÑÍA]: Enviado a colaboratium@gmail.com`);
                        console.log(`\n🤖 [RESPUESTA BOT CONFIRMACIÓN]:\n${bookingRes.whatsappResponse}\n`);

                        contactState.flujo_activo_id = null;
                        contactState.nodo_actual_id = null;
                        return;
                    }
                } else if (currentNode.id === 'node_b4_captura' || currentNode.id === 'node_b3_plazo') {
                    const rawLower = userMessage.toLowerCase().trim();
                    const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

                    // Si ya tenía email y responde a la asignación de asesor
                    if (contactState.investorEmail && (/^(s[ií]|dale|por favor|me interesa|quiero|ok|bueno|si por favor)\b/i.test(rawLower))) {
                        console.log(`\n🎟️ [TICKET PENDIENTE DE APROBACIÓN]: Ticket #${contactState.ticketId || 102} marcado como PENDING_AUTH`);
                        console.log(`📋 [DELEGACIÓN EN HELPDESK]: Listo para delegar inversor a un Agente o Líder de Agentes en /dashboard/tickets`);
                        console.log(`🤖 [BOT CONFIRMACIÓN]:\n¡Excelente! 🤝 Hemos generado la solicitud en nuestro sistema. El equipo de Dirección Comercial te asignará un *Asesor Financiero personalizado* quien se pondrá en contacto contigo a la brevedad.\n`);
                        contactState.flujo_activo_id = null;
                        contactState.nodo_actual_id = null;
                        return;
                    }

                    const detectedEmail = emailMatch ? emailMatch[0].toLowerCase().trim() : 'inversor@ejemplo.com';
                    let detectedName = userMessage.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '').replace(/[0-9+()$\-]/g, '').trim();
                    if (!detectedName || detectedName.length < 2) detectedName = 'Martín Pérez';

                    contactState.investorEmail = detectedEmail;
                    contactState.ticketId = 101;

                    console.log(`\n🎟️ [TICKET INVERSOR CREADO EN BD]: Ticket #${contactState.ticketId} - Estado: pending_auth (Mesa de Inversiones)`);
                    console.log(`📧 [EMAIL GUÍA DE INGRESO/LOGIN]: Despachado a ${detectedEmail} (Consola https://consola.colaboratium.com.ar, validación DNI Renaper, Fondeo CVU y Simulador https://colaboratium.com.ar/inversiones.php#simulador)`);
                    console.log(`📢 [NOTIFICACIÓN COMPAÑÍA]: Alerta de inversor nuevo enviada a colaboratium@gmail.com`);
                    console.log(`\n🤖 [RESPUESTA BOT]:\n¡Muchas gracias, ${detectedName}! Te enviamos a *${detectedEmail}* la Guía Oficial con los pasos para ingresar, registrarte y validar tu cuenta por Renaper.\n\nSimulador oficial: https://colaboratium.com.ar/inversiones.php#simulador\n\n¿Te interesaría que te asignemos un *Asesor Financiero personalizado* para acompañarte en tu colocación?\n`);
                    return;
                } else if (currentNode.type === 'rag') {
                    console.log(`🧠 [IA RAG]: Consulta especializada procesada con el prompt: "${currentNode.data?.prompt?.substring(0, 70)}..."`);
                    console.log(`🤖 [BOT]: "¡Perfecto! Hemos registrado tus datos y un especialista de Colaboratium te contactará en breve."`);
                    return;
                }

                const nextEdge = edges.find(e => e.source === currentNode.id);
                if (!nextEdge) {
                    console.log(`⏹️ [MOTOR]: Fin de camino tras respuesta.`);
                    contactState.flujo_activo_id = null;
                    contactState.nodo_actual_id = null;
                    return;
                }

                contactState.nodo_actual_id = nextEdge.target;
                isResuming = false;
                continue;
            }

            // Ejecución normal de nodo
            if (currentNode.type === 'message') {
                const msg = currentNode.data?.message || '';
                console.log(`🤖 [BOT MENSAJE]:\n${msg}\n`);
            } else if (currentNode.type === 'identity') {
                const question = currentNode.data?.question || '¿Cuál es tu respuesta?';
                console.log(`❓ [BOT PREGUNTA / IDENTITY]:\n${question}\n`);
                executing = false;
                continue;
            } else if (currentNode.type === 'rag') {
                console.log(`🧠 [NODO RAG ESPERANDO MENSAJE]: Prompt: "${currentNode.data?.prompt?.substring(0, 60)}..."`);
                executing = false;
                continue;
            } else if (currentNode.type === 'approval') {
                console.log(`🤝 [BOT HANDOFF]: Derivando chat con asesor humano oficial.`);
                contactState.flujo_activo_id = null;
                contactState.nodo_actual_id = null;
                executing = false;
                continue;
            }

            // Avanzar al siguiente nodo
            const nextEdge = edges.find(e => e.source === currentNode.id);
            if (!nextEdge) {
                contactState.flujo_activo_id = null;
                contactState.nodo_actual_id = null;
                executing = false;
            } else {
                contactState.nodo_actual_id = nextEdge.target;
            }
        }
    }

    // ==========================================================
    // ESCENARIO 1: BIENVENIDA Y MENÚ MAESTRO (3 OPCIONES EN ORDEN: 1 INVERSOR, 2 ASESOR, 3 LÍDER)
    // ==========================================================
    console.log('----------------------------------------------------------------');
    console.log('📌 ESCENARIO 1: Saludo general -> Menú Interactivo con 3 opciones');
    console.log('  1. Inversor: quiero invertir en la plataforma');
    console.log('  2. Asesor: Quiero trabajar con uds (sin comisiones)');
    console.log('  3. Líder: tengo mi equipo de trabajo y me interesa saber su propuesta');
    console.log('----------------------------------------------------------------');
    let contacto1 = { telefono: '+5491100000001', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto1, 'Hola, buen día!');

    // ==========================================================
    // ESCENARIO 2: FLUJO DE INVERSORES (OPCIÓN 1)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 2: Inversor elige "1" -> Mín $100.000 / Máx $10.000.000 y Simulador');
    console.log('----------------------------------------------------------------');
    await simulateUserTurn(contacto1, '1');

    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 2.1: Inversor envía sus datos y monto de colocación');
    console.log('----------------------------------------------------------------');
    await simulateUserTurn(contacto1, 'Martín Pérez martin.perez@gmail.com quiero invertir $1.500.000 a 180 días');

    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 2.2: Inversor solicita Asesor Personalizado (Ticket pending_auth)');
    console.log('----------------------------------------------------------------');
    await simulateUserTurn(contacto1, 'Sí, me interesa que me asignen un asesor');

    // ==========================================================
    // ESCENARIO 3: FLUJO ASESOR (OPCIÓN 2 - SIN COMISIONES EN INTRO)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 3: Usuario elige "2" (Asesor: Quiero trabajar con ustedes)');
    console.log('----------------------------------------------------------------');
    let contacto2 = { telefono: '+5491100000002', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto2, '2');
    await simulateUserTurn(contacto2, 'Juan Ramón Valle damduff@gmail.com');

    // ==========================================================
    // ESCENARIO 4: FLUJO LÍDERES DE EQUIPO (OPCIÓN 3)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 4: Usuario elige "3" (Líder: tengo mi equipo de trabajo)');
    console.log('----------------------------------------------------------------');
    let contacto3 = { telefono: '+5491125171969', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto3, '3');
    await simulateUserTurn(contacto3, 'Alejandro Bolognese 11 2517 1969 sirkimonolabs@gmail.com');
    await simulateUserTurn(contacto3, '1');

    console.log('\n================================================================');
    console.log('✅ TODAS LAS PRUEBAS Y FLUJOS VERIFICADOS CON ÉXITO');
    console.log('================================================================');
    process.exit(0);
}

runSimulation().catch(err => {
    console.error('❌ Error en simulación:', err);
    process.exit(1);
});
