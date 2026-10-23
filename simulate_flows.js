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

                    const emailMatch = userMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
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
                            codigoEmpresa
                        });

                        console.log(`\n🎟️ [TICKET CREADO EN BD]: Ticket #${bookingRes.ticketId}`);
                        console.log(`📧 [EMAIL CONFIRMACIÓN]: Enviado a ${detectedEmail}`);
                        console.log(`📢 [NOTIFICACIÓN COMPAÑÍA]: Enviado a colaboratium@gmail.com`);
                        console.log(`\n🤖 [RESPUESTA BOT CONFIRMACIÓN]:\n${bookingRes.whatsappResponse}\n`);

                        contactState.flujo_activo_id = null;
                        contactState.nodo_actual_id = null;
                        return;
                    }
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
    // ESCENARIO 1: BIENVENIDA Y MENÚ MAESTRO (DISPARADOR POR SALUDO)
    // ==========================================================
    console.log('----------------------------------------------------------------');
    console.log('📌 ESCENARIO 1: Saludo general y navegación al Menú Maestro');
    console.log('----------------------------------------------------------------');
    let contacto1 = { telefono: '+5491100000001', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto1, 'Hola, buenas tardes!');

    // ==========================================================
    // ESCENARIO 2: FLUJO A - ASESORES COMERCIALES (VÍA OPCIÓN 1)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 2: Usuario selecciona opción 1 (Quiero ser Asesor)');
    console.log('----------------------------------------------------------------');
    await simulateUserTurn(contacto1, '1');
    // Responder la captura de identidad y calendario
    await simulateUserTurn(contacto1, 'Juan Ramón valle damduff@gmail.com');

    // ==========================================================
    // ESCENARIO 3: FLUJO B - INVERSORES DE CAPITAL (VÍA INTENCIÓN DIRECTA)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 3: Usuario nuevo pregunta directamente por inversiones');
    console.log('----------------------------------------------------------------');
    let contacto2 = { telefono: '+5491100000002', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto2, 'Hola, quiero invertir mi capital. ¿Qué tasas pagan?');
    // Responder la pregunta de plazo y capital
    await simulateUserTurn(contacto2, 'Quiero invertir $500.000 a un plazo de 6 meses');

    // ==========================================================
    // ESCENARIO 4: FLUJO C - LÍDERES DE EQUIPO (VÍA BOTÓN META btn_lider O TEXTO)
    // ==========================================================
    console.log('\n----------------------------------------------------------------');
    console.log('📌 ESCENARIO 4: Usuario hace clic en el botón [btn_lider] o escribe "3"');
    console.log('----------------------------------------------------------------');
    let contacto3 = { telefono: '+5491100000003', flujo_activo_id: null, nodo_actual_id: null };
    await simulateUserTurn(contacto3, 'btn_lider');
    // Responder la consulta de equipo
    await simulateUserTurn(contacto3, 'Tengo un equipo de 6 asesores, soy Roberto Díaz, tel 1144556677');

    console.log('\n================================================================');
    console.log('✅ SIMULACIÓN FINALIZADA CON ÉXITO');
    console.log('================================================================');
    process.exit(0);
}

runSimulation().catch(err => {
    console.error('❌ Error en simulación:', err);
    process.exit(1);
});
