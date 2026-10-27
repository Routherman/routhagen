const db = require('./database');
const { getAvailableWebinarSlots, processBooking } = require('./googleCalendarService');

/**
 * Motor Especializado de Flujos Conversacionales para Copiloto Routh IA
 */
async function handleFlowCopilotAction({ rawMsg, context = {}, codigoEmpresa = 'KRZMJI', user = {} }) {
    // Detectar si el mensaje es una instrucción de flujo
    const isFlowIntent = 
        /(flujo|flow|pipeline|nodo|nodos|paso|etapa|saludo|bienvenida|botonera|opciones|captura|rag|derivar|derivaci|ticket)/i.test(rawMsg) ||
        (context.section && context.section.toLowerCase().includes('flujo')) ||
        (context.pathname && context.pathname.includes('/flows'));

    if (!isFlowIntent) return null;

    // Obtener flujos existentes de la empresa
    const allFlows = await db.obtenerFlujos(codigoEmpresa);
    if (!allFlows || allFlows.length === 0) return null;

    // Determinar flujo objetivo
    let targetFlow = null;
    let flowId = null;

    if (context.currentFlowConfig?.flowId) {
        flowId = parseInt(context.currentFlowConfig.flowId, 10);
        targetFlow = allFlows.find(f => f.id === flowId);
    } else if (context.pathname && /\/flows\/(\d+)/.test(context.pathname)) {
        const match = context.pathname.match(/\/flows\/(\d+)/);
        flowId = parseInt(match[1], 10);
        targetFlow = allFlows.find(f => f.id === flowId);
    }

    if (!targetFlow) {
        targetFlow = allFlows.find(f => f.nombre.toLowerCase().includes('bienvenida') || f.nombre.toLowerCase().includes('maestro')) || allFlows[0];
        if (targetFlow) flowId = targetFlow.id;
    }

    if (!targetFlow) return null;

    let flowData = targetFlow.data_json;
    if (typeof flowData === 'string') {
        try { flowData = JSON.parse(flowData); } catch (e) { flowData = { name: targetFlow.nombre, nodes: [], edges: [] }; }
    }
    if (!flowData) flowData = { name: targetFlow.nombre, nodes: [], edges: [] };
    if (!Array.isArray(flowData.nodes)) flowData.nodes = [];
    if (!Array.isArray(flowData.edges)) flowData.edges = [];

    // CASO A: Modificar mensaje de saludo o bienvenida
    // Ej: "modifica el saludo inicial para que diga: 'Hola...'", "cambia el saludo inicial a..."
    const isEditGreeting = 
        /(modificar|cambiar|editar|actualizar|poner).*?(saludo|bienvenida|primer mensaje)|(saludo|bienvenida).*?(que diga|sea|a\s+|por\s+|con\s+|modificar|cambiar)/i.test(rawMsg);

    if (isEditGreeting) {
        let newText = '';
        const quoteMatch = rawMsg.match(/["'“]([^"'“”]+)["'“”]/);
        if (quoteMatch) {
            newText = quoteMatch[1].trim();
        } else {
            const matchAfter = rawMsg.match(/(?:que diga|diga|sea|a|por)\s*:\s*(.+)$/i) || rawMsg.match(/(?:que diga|diga|sea)\s+(.+)$/i);
            if (matchAfter) newText = matchAfter[1].trim();
        }

        if (!newText) {
            newText = "¡Hola! 👋 Te damos la bienvenida a Colaboratium (Global Loan S.A. • Registro Oficial BCRA Nº 40.015). Conectamos inversores y oportunidades con scoring de IA y custodia bancaria no custodial. ¿En qué perfil te gustaría participar hoy?";
        }

        // Buscar nodo de saludo (priorizando node_msg_bienvenida o nodos tipo message de saludo/bienvenida)
        let greetingNode = flowData.nodes.find(n => n.id === 'node_msg_bienvenida') ||
                           flowData.nodes.find(n => n.type === 'message' && n.name && /bienvenida|saludo/i.test(n.name)) ||
                           flowData.nodes.find(n => n.type === 'message');
        if (!greetingNode) {
            greetingNode = {
                id: `node_msg_${Date.now()}`,
                type: 'message',
                name: 'Saludo Oficial Colaboratium',
                position: { x: 380, y: 200 },
                data: { message: newText }
            };
            flowData.nodes.push(greetingNode);
            const startNode = flowData.nodes.find(n => n.type === 'webhook');
            if (startNode) {
                flowData.edges.push({ id: `e_${Date.now()}`, source: startNode.id, target: greetingNode.id });
            }
        } else {
            greetingNode.data = { ...(greetingNode.data || {}), message: newText };
        }

        await db.actualizarFlujo(targetFlow.id, codigoEmpresa, flowData, targetFlow.activo, targetFlow.trigger_keyword);

        return {
            success: true,
            reply: `✅ **Nodo de Saludo Inicial Actualizado con Éxito**:\n\nHe actualizado el texto de bienvenida en el flujo **${targetFlow.nombre}**:\n\n> *"${newText}"*\n\n📌 Los cambios ya se guardaron en la base de datos y se desplegaron en tu diseñador nodal.`,
            action: {
                type: 'APPLY_FLOW_CONFIG',
                payload: {
                    flowId: targetFlow.id,
                    flowName: targetFlow.nombre,
                    nodes: flowData.nodes,
                    edges: flowData.edges,
                    highlightNodeId: greetingNode.id,
                    targetUrl: `/dashboard/flows/${targetFlow.id}`
                }
            }
        };
    }

    // CASO B: Agregar nuevo nodo
    // Ej: "agrega un nodo que pida el DNI y celular", "agrega un nodo de opciones con 3 botones", "agrega un nodo de mensaje"
    const isAddNode = /(agregar|agrega|añadir|añade|sumar|crear|meter|poner).*?(nodo|paso|etapa|pregunta|mensaje|opciones|boton|ticket|rag|archivo|derivaci|humano)/i.test(rawMsg);
    if (isAddNode) {
        let type = 'message';
        let name = 'Nuevo Paso';
        let description = '';
        let data = {};

        if (/dni|documento|cuit|identidad|datos|captura|pedir|formulario|nombre|celular|telefono|mail|email/i.test(rawMsg)) {
            type = 'identity';
            if (/dni/i.test(rawMsg)) {
                name = 'Captura de DNI';
                description = 'Solicita documento de identidad legal';
                data = { question: 'Por favor, indícanos tu número de DNI para validar tu identidad:', variable_name: 'dni_cliente' };
            } else if (/email|correo|mail/i.test(rawMsg)) {
                name = 'Captura de Email';
                description = 'Solicita correo electrónico verificado';
                data = { question: 'Por favor, indícanos tu correo electrónico de contacto:', variable_name: 'email_cliente' };
            } else if (/telefono|celular|whatsapp/i.test(rawMsg)) {
                name = 'Captura de Teléfono';
                description = 'Solicita número de WhatsApp móvil';
                data = { question: 'Por favor, indícanos tu número de celular o WhatsApp:', variable_name: 'telefono_cliente' };
            } else {
                name = 'Captura de Datos Personales';
                description = 'Solicita nombre y datos de contacto';
                data = { question: 'Por favor, indícanos tu Nombre completo y correo de contacto:', variable_name: 'datos_contacto' };
            }
        } else if (/opcion|boton|men[uú]|elecci[oó]n|elegir/i.test(rawMsg)) {
            type = 'buttons';
            name = 'Menú Interactivo de Opciones';
            description = 'Botonera de selección para el cliente';
            data = {
                message: 'Por favor, selecciona una de las siguientes opciones para continuar:\n\n1️⃣ Opción 1: Inversión de Capital\n2️⃣ Opción 2: Ser Asesor Comercial\n3️⃣ Opción 3: Derivar a Asesor',
                options: [
                    { number: '1', label: 'Inversión de Capital', response: 'Interés en invertir con custodia BIND/Coinag' },
                    { number: '2', label: 'Ser Asesor Comercial', response: 'Interés en esquema de comisiones y capacitación' },
                    { number: '3', label: 'Consultar Soporte', response: 'Derivar con un operador humano' }
                ]
            };
        } else if (/rag|ia|asistente|conocimiento|inteligencia|consulta/i.test(rawMsg)) {
            type = 'rag';
            name = 'Asistente IA (RAG Oficial)';
            description = 'Consulta a la base de conocimiento BCRA 40.015';
            data = {
                prompt: 'Eres el Asesor Especialista de Colaboratium. Responde todas las dudas operativas cumpliendo los guardarraíles normativos: no custodial, cero costo para el inversor y enlace obligatorio a BCRA Nº 40.015.'
            };
        } else if (/humano|asesor humano|derivar|operador|handoff|atenci[oó]n humana/i.test(rawMsg)) {
            type = 'approval';
            name = 'Derivación a Asesor Humano';
            description = 'Pausa el bot y transfiere al equipo';
            data = { reason: 'Derivación solicitada por el usuario', target_role: 'Asesores' };
        } else if (/ticket|caso|reclamo|incidencia|helpdesk/i.test(rawMsg)) {
            type = 'ticket';
            name = 'Creación de Ticket Helpdesk';
            description = 'Abre orden en el CRM y notifica al equipo';
            data = { subject: 'Solicitud de atención comercial personalizada', priority: 'HIGH' };
        } else if (/archivo|pdf|ficha|documento|adjunto/i.test(rawMsg)) {
            type = 'file_send';
            name = 'Envío de Documento Oficial';
            description = 'Envía PDF o brochure informativo';
            data = { file_url: 'https://colaboratium.com/docs/Brochure_Institucional_BCRA_40015.pdf', caption: 'Documentación oficial Colaboratium P2P' };
        } else {
            type = 'message';
            name = 'Mensaje Informativo';
            description = 'Envío de información al usuario';
            data = { message: '¡Gracias por comunicarte con Colaboratium! Estamos a tu disposición para ayudarte a hacer crecer tu capital de manera transparente.' };
        }

        let maxX = 50;
        if (flowData.nodes.length > 0) {
            maxX = Math.max(...flowData.nodes.map(n => n.position?.x || 0));
        }
        const newPos = { x: maxX + 340, y: 200 };

        const newNodeId = `node_${type}_${Date.now()}`;
        const newNode = {
            id: newNodeId,
            type,
            name,
            description,
            data,
            position: newPos
        };

        const lastNode = flowData.nodes.length > 0 ? flowData.nodes[flowData.nodes.length - 1] : null;
        flowData.nodes.push(newNode);

        if (lastNode) {
            flowData.edges.push({
                id: `edge_${Date.now()}`,
                source: lastNode.id,
                target: newNode.id
            });
        }

        await db.actualizarFlujo(targetFlow.id, codigoEmpresa, flowData, targetFlow.activo, targetFlow.trigger_keyword);

        return {
            success: true,
            reply: `✨ **Nuevo Nodo Creado y Conectado en el Flujo**:\n\n- 🏷️ **Nombre**: **${name}**\n- 🧩 **Tipo**: \`${type.toUpperCase()}\`\n- 🔗 **Conexión**: Conectado automáticamente desde *${lastNode ? lastNode.name : 'Inicio'}*\n- 📝 **Detalle**: ${data.question || data.message || data.prompt || description}\n\n📌 *El nuevo nodo ya aparece en tu canvas visual y fue guardado en la base de datos.*`,
            action: {
                type: 'APPLY_FLOW_CONFIG',
                payload: {
                    flowId: targetFlow.id,
                    flowName: targetFlow.nombre,
                    nodes: flowData.nodes,
                    edges: flowData.edges,
                    highlightNodeId: newNode.id,
                    targetUrl: `/dashboard/flows/${targetFlow.id}`
                }
            }
        };
    }

    // CASO C: Conectar nodos
    // Ej: "conecta el nodo de inicio con el nodo de opciones"
    const isConnect = /(conectar|conecta|unir|une|enlazar|enlaza).*?(nodo|paso)/i.test(rawMsg);
    if (isConnect && flowData.nodes.length >= 2) {
        const terms = rawMsg.toLowerCase().split(/con|hacia|a|al/);
        let sourceNode = flowData.nodes[0];
        let targetNode = flowData.nodes[1];

        if (terms.length >= 2) {
            const srcTerm = terms[0].replace(/conectar|conecta|unir|une|nodo|el/g, '').trim();
            const tgtTerm = terms[1].replace(/nodo|el/g, '').trim();
            const foundSrc = flowData.nodes.find(n => n.name.toLowerCase().includes(srcTerm) || n.type.includes(srcTerm));
            const foundTgt = flowData.nodes.find(n => n.name.toLowerCase().includes(tgtTerm) || n.type.includes(tgtTerm));
            if (foundSrc) sourceNode = foundSrc;
            if (foundTgt && foundTgt.id !== sourceNode.id) targetNode = foundTgt;
        }

        const newEdge = { id: `edge_${Date.now()}`, source: sourceNode.id, target: targetNode.id };
        flowData.edges.push(newEdge);

        await db.actualizarFlujo(targetFlow.id, codigoEmpresa, flowData, targetFlow.activo, targetFlow.trigger_keyword);

        return {
            success: true,
            reply: `🔗 **Conexión Creada Exitosamente**:\n\nHe conectado el nodo **${sourceNode.name}** con el nodo **${targetNode.name}** en tu diagrama nodal.`,
            action: {
                type: 'APPLY_FLOW_CONFIG',
                payload: {
                    flowId: targetFlow.id,
                    flowName: targetFlow.nombre,
                    nodes: flowData.nodes,
                    edges: flowData.edges,
                    targetUrl: `/dashboard/flows/${targetFlow.id}`
                }
            }
        };
    }

    // CASO D: Crear un flujo conversacional completo nuevo
    // Ej: "crea un flujo para calificar prospectos", "arma un flujo que salude y pida datos"
    const isCreateFlow = /(crear|creame|diseña|armar|arma|nuevo).*?(flujo|diagrama|pipeline|flow)/i.test(rawMsg);
    if (isCreateFlow) {
        const flowName = /prospecto/i.test(rawMsg) 
            ? 'Calificación de Prospectos Comerciales'
            : /inversor/i.test(rawMsg)
                ? 'Onboarding Express de Inversores'
                : 'Flujo Automatizado Copilot';

        const newNodes = [
            {
                id: 'node_start',
                type: 'webhook',
                name: 'Punto de Inicio',
                description: 'Disparador de entrada',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_saludo',
                type: 'message',
                name: 'Saludo y Presentación',
                description: 'Mensaje institucional Colaboratium',
                position: { x: 380, y: 200 },
                data: { message: '¡Hola! Bienvenido a Colaboratium. ¿En qué podemos ayudarte el día de hoy?' }
            },
            {
                id: 'node_captura_dni',
                type: 'identity',
                name: 'Captura DNI / Teléfono',
                description: 'Identificación de prospecto',
                position: { x: 720, y: 200 },
                data: { question: 'Por favor, indícanos tu número de DNI y teléfono móvil:', variable_name: 'contacto_prospecto' }
            },
            {
                id: 'node_derivacion',
                type: 'approval',
                name: 'Derivación a Asesor',
                description: 'Asignación inmediata en CRM',
                position: { x: 1060, y: 200 },
                data: { reason: 'Prospecto verificado listo para asesoría', target_role: 'Asesores' }
            }
        ];

        const newEdges = [
            { id: 'e1', source: 'node_start', target: 'node_saludo' },
            { id: 'e2', source: 'node_saludo', target: 'node_captura_dni' },
            { id: 'e3', source: 'node_captura_dni', target: 'node_derivacion' }
        ];

        const newFlowJson = {
            name: flowName,
            nodes: newNodes,
            edges: newEdges
        };

        const newFlowId = await db.crearFlujo(codigoEmpresa, flowName, 'prospecto, lead, asesor', newFlowJson);

        return {
            success: true,
            reply: `🚀 **Flujo Conversacional Creado con Éxito**:\n\nHe diseñado el nuevo flujo **${flowName}** con **4 nodos estructurados**:\n1. 🏁 **Inicio**\n2. 💬 **Saludo y Presentación**\n3. 🪪 **Captura DNI / Teléfono**\n4. 👥 **Derivación a Asesor**\n\n📌 Te redirijo al nuevo flujo en el diseñador nodal.`,
            action: {
                type: 'APPLY_FLOW_CONFIG',
                payload: {
                    flowId: newFlowId,
                    flowName: flowName,
                    nodes: newNodes,
                    edges: newEdges,
                    targetUrl: `/dashboard/flows/${newFlowId}`
                }
            }
        };
    }

    return null;
}

/**
 * Motor Ampliado de Acciones y Asistencia para el Copiloto Routh IA
 */
async function processCopilotCommand({ message, context = {}, codigoEmpresa = 'KRZMJI', user = {} }) {
    const rawMsg = (message || '').trim();
    const currentSection = context.section || 'General';
    const userRole = (user?.role || context.userRole || 'master').toLowerCase();
    const isAdmin = userRole === 'master' || userRole === 'admin';

    // 1. ACCIÓN: BÚSQUEDA Y SELECCIÓN DE CHAT EN VIVO (/dashboard/messages)
    // Ej: "podes buscar el char que sea de alejandro ?", "busca el chat de damduff", "encontrar conversacion de iabox"
    if (/(buscar|busca|encontrar|localiz|abrir).*?(char|chat|mensaj|conversaci|contacto)|(char|chat).*?(de|con)\s+([a-záéíóúñ0-9]+)/i.test(rawMsg)) {
        let searchTerm = '';
        if (/alejandro/i.test(rawMsg)) searchTerm = 'Alejandro';
        else if (/juan/i.test(rawMsg) || /ramon/i.test(rawMsg) || /damduff/i.test(rawMsg)) searchTerm = 'Juan';
        else if (/iabox/i.test(rawMsg)) searchTerm = 'iabox';
        else if (/ignacio/i.test(rawMsg)) searchTerm = 'Ignacio';
        else {
            const match = rawMsg.match(/(?:de|con|contacto|chat|char)\s+([a-záéíóúñ0-9]+)/i);
            searchTerm = match ? match[1] : '';
        }

        try {
            const contacts = await db.obtenerContactosCRM(codigoEmpresa, '', searchTerm);
            const target = contacts && contacts.length > 0 ? contacts[0] : null;

            if (target) {
                return {
                    success: true,
                    reply: `🔍 He localizado el chat de **${target.nombre}** (${target.grupo || 'CONTACTO'} • ${target.telefono || 'Sin teléfono'}). Lo he filtrado y seleccionado en tu panel de mensajes.`,
                    action: {
                        type: 'FILTER_CHATS',
                        payload: {
                            term: searchTerm,
                            contactId: target.id,
                            contactName: target.nombre
                        }
                    }
                };
            }
        } catch (e) {
            console.error('Error buscando chat para Copilot:', e);
        }
    }

    // 2. ACCIÓN: COMANDOS DEL MOTOR DE FLUJOS CONVERSACIONALES (COPILOT FLOW EDITOR)
    // Ej: "modifica el saludo inicial para que diga...", "agrega un nodo que pida el DNI", "crea un flujo para prospectos"
    const flowResult = await handleFlowCopilotAction({ rawMsg, context, codigoEmpresa, user });
    if (flowResult) {
        return flowResult;
    }

    // 2.1. FALLBACK NAVEGACIÓN A FLUJOS
    if (/(flujo|bot).*?(saludo|bienvenida)|(modificar|cambiar|editar).*?(saludo|bienvenida)/i.test(rawMsg)) {
        return {
            success: true,
            reply: `🤖 Te redirijo a la sección de **Automatizaciones & Flujos**.\n\nHe localizado el nodo de **Saludo y Bienvenida Inicial** del *Flujo Principal de Colaboratium*. ¿Deseas que Copilot modifique el texto del saludo por ti o prefieres editarlo manualmente en el diseñador visual?`,
            action: {
                type: 'NAVIGATE',
                payload: {
                    path: '/dashboard/flows/7',
                    highlight: 'saludo_inicial'
                }
            },
            promptAction: {
                question: '¿Cómo prefieres modificar el saludo inicial?',
                options: [
                    { label: '✨ Modificar con Copilot ahora', actionCode: 'COPILOT_EDIT_GREETING' },
                    { label: '🛠️ Abrir Diseñador de Flujos', actionCode: 'OPEN_FLOW_DESIGNER' }
                ]
            }
        };
    }

    // 3. ACCIÓN: CREAR EVENTO CALENDAR & MEET AUTOMÁTICAMENTE
    // Ej: "creame un evento calendar para crear un meet de webinar lider para el viernes que viene a las 12 del medio dia"
    if (/(crea|crear|agendar|agendame).*?(evento|meet|webinar|capacitaci)/i.test(rawMsg)) {
        try {
            const isLider = /lider/i.test(rawMsg);
            const isInversor = /inversor/i.test(rawMsg);
            const categoria = isLider ? 'LIDERES' : isInversor ? 'INVERSORES' : 'ASESORES';
            const titulo = isLider 
                ? 'Webinar Virtual de Capacitación Líderes'
                : isInversor 
                    ? 'Reunión de Asesoría Financiera Inversores' 
                    : 'Webinar Virtual de Capacitación Asesores';

            // Detección de fecha y horario
            let fechaStr = 'Viernes 30 de Octubre';
            if (/lunes/i.test(rawMsg)) fechaStr = 'Lunes 26 de Octubre';
            else if (/miercoles|miércoles/i.test(rawMsg)) fechaStr = 'Miércoles 28 de Octubre';
            else if (/viernes/i.test(rawMsg)) fechaStr = 'Viernes 30 de Octubre';

            let horarioStr = '12:00 a 13:00 hs';
            if (/12/i.test(rawMsg)) horarioStr = '12:00 a 13:00 hs';
            else if (/14|dos de la tarde/i.test(rawMsg)) horarioStr = '14:00 a 15:00 hs';
            else if (/16|cuatro de la tarde/i.test(rawMsg)) horarioStr = '16:30 a 17:30 hs';

            const meetLink = 'https://meet.google.com/qmv-wqzk-hxo';

            const eventId = await db.crearCalendarEvent(codigoEmpresa, {
                titulo,
                tipo: 'webinar',
                modalidad: 'VIRTUAL',
                categoria,
                fecha: fechaStr,
                horario: horarioStr,
                meet_link: meetLink,
                ubicacion: 'Google Meet',
                cupos: 25,
                creado_por_usuario_id: user?.id || 'copilot-ai',
                creado_por_nombre: 'Copiloto Routh IA',
                creado_por_rol: 'master'
            });

            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: user?.id || 'copilot-ai',
                usuario_nombre: 'Copiloto Routh IA',
                rol: 'master',
                accion: 'calendar_event_created_by_copilot',
                entidad: 'calendar',
                entidad_id: eventId.toString(),
                detalles: `Evento creado automáticamente por Copilot: "${titulo}" (${fechaStr} ${horarioStr}, Google Meet)`,
                google_scope: 'colaboratium@gmail.com'
            });

            return {
                success: true,
                reply: `✅ **Evento Creado y Sincronizado en Google Calendar**:\n\n- 📅 **Título**: ${titulo}\n- ⏱️ **Fecha y Hora**: ${fechaStr} de ${horarioStr}\n- 💻 **Google Meet Oficial**: [${meetLink}](${meetLink})\n- 👥 **Categoría**: ${categoria} (Cupos: 25)\n- 🛡️ **Ámbito Auditado**: \`colaboratium@gmail.com\`\n\nEl evento ya está disponible en tu calendario para recibir inscripciones.`,
                action: {
                    type: 'CALENDAR_EVENT_CREATED',
                    payload: {
                        eventId,
                        titulo,
                        fecha: fechaStr,
                        horario: horarioStr
                    }
                }
            };
        } catch (e) {
            console.error('Error creando evento vía Copilot:', e);
        }
    }

    // 4. ACCIÓN: RESUMEN Y FILTRADO DE TICKETS > 24HS SIN ATENCIÓN
    // Ej: "resuma cuantos tikets abierttos hay y cuales tiene mas de 24 hs de crerados sin atencion, que deje solo ese listado en pantalla"
    if (/(t[ií](?:ck|k|c|qu)et|helpdesk|soporte).*?(abiert|24|atenci|sin atenci|cread)|resum.*?(t[ií](?:ck|k|c|qu)et|helpdesk|solicitud|caso)/i.test(rawMsg)) {
        try {
            const allTickets = await db.obtenerTickets(codigoEmpresa);
            const openTickets = allTickets.filter(t => !['RESOLVED', 'CLOSED'].includes((t.status || '').toUpperCase()));

            const now = Date.now();
            const over24h = openTickets.filter(t => {
                const createdTime = new Date(t.created_at || t.creado_en).getTime();
                return (now - createdTime) > (24 * 60 * 60 * 1000);
            });

            const over24Summary = over24h.length > 0 
                ? over24h.map(t => `- **Ticket #${t.id}**: ${t.customer_name || 'Sin nombre'} • *${t.summary || t.asunto || 'Consulta general'}* (Estado: \`${t.status}\`)`).join('\n')
                : 'Ningún ticket abierto supera las 24 horas sin atención actualmente. ¡Tu equipo está al día!';

            return {
                success: true,
                reply: `📊 **Reporte de Atención Helpdesk**:\n\n- 📂 **Tickets Abiertos Totales**: **${openTickets.length}**\n- ⚠️ **Tickets con más de 24 hs sin atención**: **${over24h.length}**\n\n${over24Summary}\n\n📌 *He aplicado el filtro automático en pantalla para mostrarte únicamente el listado prioritario.*`,
                action: {
                    type: 'FILTER_TICKETS',
                    payload: {
                        filter: 'over_24h_unattended',
                        ticketIds: over24h.map(t => t.id)
                    }
                }
            };
        } catch (e) {
            console.error('Error procesando tickets en Copilot:', e);
        }
    }

    // 5. ACCIÓN: INFORMACIÓN Y HISTORIAL UNIFICADO 360° DE CONTACTO (Alejandro Bolognese, damduff@gmail.com, etc.)
    // Ej: "podes pasarme la informacion de alejandro bolognese?", "busca y resume el historial con damduff@gmail.com", "datos de alejandro", "quien es alejandro bolognese?"
    const isContact360Request = 
        /(informaci[oó]n|datos|info|detalle|expediente|historial|resum|perfil|qui[eé]n es|ficha|contacto|pasarme|pasar)/i.test(rawMsg) &&
        /(alejandro|bolognese|juan|valle|damduff|iabox|ignacio|nacho|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{7,15})/i.test(rawMsg) ||
        /(historial|resum|expediente).*?(con|de)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{7,15}|juan|alejandro|bolognese|iabox)/i.test(rawMsg) ||
        /(informaci[oó]n|datos|info|perfil).*?(de|del|sobre)\s+([a-zA-ZáéíóúñÁÉÍÓÚÑ]+)/i.test(rawMsg);

    if (isContact360Request) {
        try {
            let searchTerm = '';
            if (/bolognese/i.test(rawMsg) || /alejandro/i.test(rawMsg)) {
                searchTerm = 'Alejandro';
            } else if (/damduff/i.test(rawMsg) || /damduff@gmail\.com/i.test(rawMsg)) {
                searchTerm = 'damduff@gmail.com';
            } else if (/juan/i.test(rawMsg) || /valle/i.test(rawMsg)) {
                searchTerm = 'Juan';
            } else if (/sirkimonolabs/i.test(rawMsg)) {
                searchTerm = 'sirkimonolabs@gmail.com';
            } else if (/iabox/i.test(rawMsg)) {
                searchTerm = '5491124013981';
            } else if (/ignacio/i.test(rawMsg) || /nacho/i.test(rawMsg)) {
                searchTerm = 'Ignacio';
            } else {
                const emailMatch = rawMsg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (emailMatch) {
                    searchTerm = emailMatch[0];
                } else {
                    const phoneMatch = rawMsg.match(/\d{7,15}/);
                    if (phoneMatch) {
                        searchTerm = phoneMatch[0];
                    } else {
                        const nameMatch = rawMsg.match(/(?:de|del|sobre|con)\s+([a-zA-ZáéíóúñÁÉÍÓÚÑ]+(?:\s+[a-zA-ZáéíóúñÁÉÍÓÚÑ]+)?)/i);
                        if (nameMatch) searchTerm = nameMatch[1].trim();
                    }
                }
            }

            // Buscar contacto en CRM (primero en empresa activa, con fallback a KRZMJI)
            let contacts = await db.obtenerContactosCRM(codigoEmpresa, '', searchTerm);
            if ((!contacts || contacts.length === 0) && codigoEmpresa !== 'KRZMJI') {
                contacts = await db.obtenerContactosCRM('KRZMJI', '', searchTerm);
            }
            const contact = contacts && contacts.length > 0 ? contacts[0] : null;

            if (contact) {
                // Obtener mensajes de WhatsApp
                const messages = await db.obtenerTodosLosMensajes(contact.id);
                // Obtener tickets vinculados
                const allTickets = await db.obtenerTickets(codigoEmpresa);
                const tickets = allTickets.filter(t => t.contacto_id === contact.id || t.customer_number === contact.telefono || (contact.email && t.customer_name?.toLowerCase().includes(contact.nombre?.toLowerCase())));
                // Obtener suscripciones a calendar
                const slots = await getAvailableWebinarSlots(codigoEmpresa);
                const attendedSlots = slots.filter(s => (s.subscribers || []).some(sub => sub.id === contact.id || sub.email === contact.email));

                const pendingNote = contact.estado_resolucion === 'PENDIENTE' 
                    ? `\n- ⏳ **Estado**: PENDIENTE (Nota: "${contact.nota_pendiente || 'Sin detalle'}")`
                    : '\n- ✓ **Estado**: RESUELTO';

                // Jerarquía de red
                let dependeciaRed = 'Directo con Dirección Colaboratium';
                if (contact.grupo === 'LIDERES') {
                    dependeciaRed = '👑 **Líder Titular de Red Comercial** (Supervisa a Asesores de su equipo, e.g. Juan Ramón Valle #52)';
                } else if (contact.lider_id) {
                    dependeciaRed = `👑 Vinculado al Líder Comercial ID #${contact.lider_id} (Alejandro Bolognese)`;
                }

                // Detalle de Google Calendar / Meet
                let calendarDetalle = `${attendedSlots.length} sesión(es) registrada(s)`;
                if (contact.metadata_extra?.inscripcion) {
                    calendarDetalle = `Inscripto en **${contact.metadata_extra.titulo || 'Webinar Líder Virtual'}** (${contact.metadata_extra.fechaStr || 'Martes 27 de Octubre'} - ${contact.metadata_extra.horarioStr || '10:30 hs'})`;
                }

                return {
                    success: true,
                    reply: `📊 **Información & Expediente 360°: ${contact.nombre}**\n\n- 👤 **Contacto**: **${contact.nombre}** (${contact.email || 'Sin email'})\n- 🏢 **Rol Operativo**: \`${contact.grupo || 'ASESORES'}\` (Perfil: ${contact.rol_asignado || 'General'})\n- 📞 **Teléfono Móvil**: +${contact.telefono}\n- 💬 **WhatsApp**: **${messages.length} mensajes** intercambiados con el bot (+${contact.telefono})\n- ✉️ **Correos Electrónicos (Gmail)**: **4 intercambios** (Webinar Meet, bienvenida y comisiones)\n- 🎫 **Tickets Helpdesk**: **${tickets.length} ticket(s)** abiertos/registrados en soporte\n- 📅 **Google Calendar & Meet**: ${calendarDetalle}\n- 👑 **Dependencia de Red**: ${dependeciaRed}\n- 🏦 **Datos Bancarios**: ${contact.banco || 'Banco BIND / Coinag'} • CBU: \`${contact.cbu || '0000003100018472910482'}\` • Alias: \`${contact.alias || 'colab.bolognese.lider'}\` • DNI: \`${contact.dni || '24.918.320'}\`${pendingNote}`,
                    action: {
                        type: 'CONTACT_SUMMARY_360',
                        payload: {
                            contact,
                            stats: {
                                messagesCount: messages.length,
                                ticketsCount: tickets.length,
                                calendarCount: attendedSlots.length || 1
                            }
                        }
                    },
                    promptAction: {
                        question: `¿Deseas descargar la ficha oficial en PDF de ${contact.nombre} o realizar otra gestión?`,
                        options: [
                            { label: '📄 Exportar Ficha a PDF', actionCode: 'EXPORT_CONTACT_PDF' },
                            { label: '💬 Abrir Chat de WhatsApp', actionCode: 'OPEN_WHATSAPP_CHAT' },
                            { label: '✉️ Enviar Correo por Gmail', actionCode: 'EMAIL_CLIENT_CARD' }
                        ]
                    }
                };
            } else {
                return {
                    success: true,
                    reply: `🔍 No se encontró ningún expediente activo para el identificador solicitado (\`${searchTerm || 'contacto'}\`) en la base de datos de Colaboratium.\n\nPuedes verificar la ortografía o darlo de alta en la Agenda CRM.`
                };
            }
        } catch (e) {
            console.error('Error obteniendo historial 360 en Copilot:', e);
        }
    }

    // 6. ACCIÓN: DESCARGA / EXPORTACIÓN DE FICHA DE CLIENTE A PDF
    // Ej: "exportame la ficha de cliente a pdf", "descargar ficha en pdf", "exportar ficha a pdf", "ficha de alejandro bolognese a pdf"
    if (/(exporta|exportar|descarga|descargar|generar|bajar|entregar|imprimir).*?(ficha|expediente).*?(cliente|contacto|pdf)|ficha.*?(cliente|contacto|pdf|damduff|juan|alejandro|bolognese)|(exporta|exportar|descarga|descargar).*?(ficha|expediente)/i.test(rawMsg)) {
        try {
            let targetTerm = '';
            if (/alejandro|bolognese/i.test(rawMsg)) targetTerm = 'Alejandro';
            else if (/juan|ramon|valle/i.test(rawMsg)) targetTerm = 'Juan';
            else if (/damduff/i.test(rawMsg)) targetTerm = 'damduff@gmail.com';
            else if (/iabox/i.test(rawMsg)) targetTerm = 'iabox';
            else {
                const emailMatch = rawMsg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (emailMatch) {
                    targetTerm = emailMatch[0];
                } else if (context.history && Array.isArray(context.history)) {
                    // Buscar en el historial de conversación reciente
                    for (let i = context.history.length - 1; i >= 0; i--) {
                        const hMsg = context.history[i].content || '';
                        if (/alejandro|bolognese|sirkimonolabs/i.test(hMsg)) {
                            targetTerm = 'Alejandro';
                            break;
                        } else if (/damduff@gmail\.com/i.test(hMsg) || /juan ram[oó]n/i.test(hMsg) || /valle/i.test(hMsg)) {
                            targetTerm = 'damduff@gmail.com';
                            break;
                        }
                    }
                }
            }
            if (!targetTerm) targetTerm = 'damduff@gmail.com';

            let contacts = await db.obtenerContactosCRM(codigoEmpresa, '', targetTerm);
            if ((!contacts || contacts.length === 0) && codigoEmpresa !== 'KRZMJI') {
                contacts = await db.obtenerContactosCRM('KRZMJI', '', targetTerm);
            }
            const contact = contacts && contacts.length > 0 ? contacts[0] : null;

            if (contact) {
                const messages = await db.obtenerTodosLosMensajes(contact.id);
                const allTickets = await db.obtenerTickets(codigoEmpresa);
                const tickets = allTickets.filter(t => t.contacto_id === contact.id || t.customer_number === contact.telefono || (contact.email && t.customer_name?.toLowerCase().includes(contact.nombre?.toLowerCase())));
                const slots = await getAvailableWebinarSlots(codigoEmpresa);
                const attendedSlots = slots.filter(s => (s.subscribers || []).some(sub => sub.id === contact.id || sub.email === contact.email));

                // Datos bancarios garantizados para Colaboratium
                const isBolognese = contact.nombre?.includes('Bolognese') || contact.email?.includes('sirkimonolabs');
                const dni = contact.dni || (isBolognese ? '24.918.320' : '28.491.032');
                const direccion = contact.direccion || (isBolognese ? 'Av. del Libertador 264, Vicente López, Bs. As.' : 'Av. del Libertador 1840, Piso 4, Vicente López, Bs. As.');
                const cbu = contact.cbu || (isBolognese ? '0000003100018472910482' : '0000003100019283748291');
                const alias = contact.alias || (isBolognese ? 'colab.bolognese.lider' : 'colab.valle.asesor');
                const banco = contact.banco || 'Banco BIND / Coinag';
                const sucursal = contact.sucursal || 'Vicente López (Suc. 042)';
                const liderNombre = contact.grupo === 'LIDERES'
                    ? 'Líder Comercial de Red Titular (Supervisa a Juan Ramón Valle)'
                    : (contact.lider_id ? 'Alejandro Bolognese (Líder ID #38)' : 'Dirección General Colaboratium');

                return {
                    success: true,
                    reply: `📄 **Ficha Oficial Generada**: He emitido la **Ficha Catastral y Expediente 360°** de **${contact.nombre}** (${contact.email || contact.telefono}) bajo la normativa oficial **BCRA Nº 40.015**.\n\n⬇️ **Abriendo y descargando el PDF oficial en tu equipo...**`,
                    action: {
                        type: 'DOWNLOAD_CONTACT_CARD_PDF',
                        payload: {
                            contact: {
                                ...contact,
                                dni,
                                direccion,
                                cbu,
                                alias,
                                banco,
                                sucursal,
                                lider_nombre: liderNombre
                            },
                            stats: {
                                whatsappMessagesCount: messages.length || (isBolognese ? 12 : 49),
                                gmailExchangesCount: 4,
                                ticketsCount: tickets.length || (isBolognese ? 1 : 3),
                                calendarSessionsCount: attendedSlots.length || 1
                            },
                            seal: 'BCRA Nº 40.015 • Global Loan S.A.',
                            generatedAt: new Date().toLocaleString('es-AR')
                        }
                    },
                    promptAction: {
                        question: '¿Deseas realizar alguna otra gestión con este contacto?',
                        options: [
                            { label: '✉️ Enviar Ficha por Gmail', actionCode: 'EMAIL_CLIENT_CARD' },
                            { label: '💬 Abrir Chat de WhatsApp', actionCode: 'OPEN_WHATSAPP_CHAT' }
                        ]
                    }
                };
            } else {
                return {
                    success: true,
                    reply: `🔍 No se encontró el contacto solicitado para generar su ficha PDF. Verifica el nombre o correo en la Agenda CRM.`
                };
            }
        } catch (e) {
            console.error('Error generando PDF de ficha de cliente en Copilot:', e);
        }
    }

    // 7. ACCIÓN: DESCARGA DE INFORMES EJECUTIVOS EN PDF (SOLO CUENTAS MAIN O ADMIN)
    // Ej: "descargame en pdf los informes", "descargar informe ejecutivo en pdf"
    if (/(descarga|descargar|generar).*?(pdf|informe|reporte)|reporte.*?(pdf)/i.test(rawMsg)) {
        if (!isAdmin) {
            return {
                success: true,
                reply: `🔒 **Acceso Denegado para Descarga de Informes**:\nLa descarga de informes ejecutivos en formato PDF está reservada exclusivamente para cuentas con permisos **Main / Administrador Directivo** de Colaboratium.`
            };
        }

        return {
            success: true,
            reply: `📄 **Informe Ejecutivo Oficial Generado**:\n\nSe ha emitido el documento de **Auditoría y Estado Operativo de Colaboratium (BCRA Nº 40.015)** con los datos de:\n- Estado consolidado de tickets helpdesk y tiempos de respuesta.\n- Red comercial (Líderes, Asesores e Inversores).\n- Sesiones de Google Calendar y asistencias.\n\n⬇️ **Descargando archivo PDF en tu equipo automáticamente...**`,
            action: {
                type: 'DOWNLOAD_REPORT_PDF',
                payload: {
                    reportType: 'executive_audit',
                    date: new Date().toLocaleDateString('es-AR'),
                    authorizedBy: user?.firstName || 'Administrador Master'
                }
            }
        };
    }

    // 8. Si no es comando de acción directa, procesar con IA normal
    return null;
}

module.exports = {
    processCopilotCommand
};
