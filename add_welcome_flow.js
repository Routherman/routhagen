const db = require('./database');

async function addWelcomeFlow() {
    await db.initDB();
    const codigo = 'KRZMJI';

    console.log('--- Creando Flujo de Bienvenida y Presentación ---');

    const triggerKeywords = 'hola, buenas, con quien hablo';
    const flowName = 'Bienvenida y Presentación Colaboratium';

    const flowData = {
        name: flowName,
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Punto de Inicio (Saludos)',
                position: { x: 50, y: 180 },
                data: {}
            },
            {
                id: 'node_msg_bienvenida',
                type: 'message',
                name: 'Presentación Oficial Colaboratium',
                position: { x: 360, y: 180 },
                data: {
                    message: "¡Hola! Te damos una cordial bienvenida a Colaboratium (GLOBAL LOAN S.A., Maipú 568 Piso 8, CABA). 👋🏛️\n\nSomos la plataforma pionera de finanzas colaborativas (P2P lending) en Argentina, 100% digital, transparente y regulada, con operatoria respaldada y aprobada por Banco BIND y Banco COINAG.\n\nConectamos de forma directa (CVU a CVU) a inversores con tomadores de crédito calificados bajo un scoring estricto del 5%, atomizando los micro-préstamos con IA para minimizar el riesgo y ofreciendo las mejores tasas y rendimientos del mercado."
                }
            },
            {
                id: 'node_msg_menu',
                type: 'message',
                name: 'Opciones de Asistencia',
                position: { x: 700, y: 180 },
                data: {
                    message: "¿En qué te podemos asesorar hoy? Puedes consultarme lo que necesites o escribir una de estas palabras clave para iniciar un proceso guiado:\n\n• Escribe *consultor*: Si deseas sumarte como socio/consultor financiero o invertir capital.\n• Escribe *prestamo*: Para solicitar un crédito con cuotas fijas y sin intermediación bancaria tradicional.\n• Escribe *onboarding*: Para conocer los 5 pasos y validar tu identidad KYC.\n\n¡Estoy a tu disposición para ayudarte!"
                }
            },
            {
                id: 'node_rag_asistente',
                type: 'rag',
                name: 'Asistente IA (Ollama Local)',
                position: { x: 1040, y: 180 },
                data: {
                    prompt: "Eres el Asistente Virtual Oficial de Colaboratium. Responde al usuario con calidez, solvencia y claridad técnica. Explica qué es Colaboratium, el respaldo de Banco BIND y Banco COINAG, el modelo P2P directo CVU a CVU, y guía al usuario según su necesidad (inversiones/consultores, créditos o proceso de onboarding). Recuérdale que puede escribir 'consultor', 'prestamo' u 'onboarding' para trámites guiados."
                }
            }
        ],
        edges: [
            { id: 'e1-2', source: 'node_trigger', target: 'node_msg_bienvenida' },
            { id: 'e2-3', source: 'node_msg_bienvenida', target: 'node_msg_menu' },
            { id: 'e3-4', source: 'node_msg_menu', target: 'node_rag_asistente' }
        ]
    };

    // Verificamos si ya existe un flujo con este nombre o palabra clave para actualizarlo o crearlo
    const [existing] = await db.pool.query(
        'SELECT id FROM flujos WHERE codigo_empresa = ? AND (nombre = ? OR trigger_keyword LIKE "%hola%")',
        [codigo, flowName]
    );

    if (existing.length > 0) {
        const id = existing[0].id;
        await db.actualizarFlujo(id, codigo, flowData, true, triggerKeywords);
        console.log(`✅ Flujo de bienvenida actualizado exitosamente con ID: ${id}`);
    } else {
        const newId = await db.crearFlujo(codigo, flowName, triggerKeywords, flowData);
        console.log(`✅ Flujo de bienvenida creado exitosamente con ID: ${newId}`);
    }

    // Actualizamos el prompt del sistema para incluir este nuevo flujo
    const empresa = await db.obtenerEmpresa(codigo);
    if (empresa && empresa.prompt_ia) {
        let updatedPrompt = empresa.prompt_ia;
        if (!updatedPrompt.includes('"hola"')) {
            updatedPrompt = updatedPrompt.replace(
                '- "consultor": Para iniciar el flujo guiado de consultores e inversiones.',
                '- "hola", "buenas" o "con quien hablo": Para recibir la bienvenida y conocer la presentación de Colaboratium.\n- "consultor": Para iniciar el flujo guiado de consultores e inversiones.'
            );
            await db.actualizarIA(codigo, updatedPrompt, empresa.conocimiento_ia);
            console.log('✅ Prompt del sistema actualizado con el nuevo disparador de bienvenida.');
        }
    }

    console.log('--- Proceso completado exitosamente ---');
    process.exit(0);
}

addWelcomeFlow().catch(err => {
    console.error('❌ Error agregando flujo de bienvenida:', err);
    process.exit(1);
});
