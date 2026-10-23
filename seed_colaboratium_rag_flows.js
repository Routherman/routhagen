const db = require('./database');

async function seedRAGFlows() {
    await db.initDB();
    const codigo = 'KRZMJI';

    console.log('================================================================');
    console.log('🚀 INICIANDO MIGRACIÓN Y CARGA DE FLUJOS RAG COLABORATIUM');
    console.log('================================================================');

    // 1. Datos Corporativos Oficiales
    await db.pool.query(
        `UPDATE empresas 
         SET nombre = ?, direccion = ?, email = ?
         WHERE codigo = ?`,
        [
            'Colaboratium',
            'Maipú 568, Piso 8°, CABA (Fiscal) | Av. del Libertador 264, 1° Piso Contrafrente, Vicente López (Comercial)',
            'contacto@colaboratium.com',
            codigo
        ]
    );
    console.log('✅ Empresa Colaboratium actualizada con domicilios oficiales.');

    // 2. Roles del Sistema alineados al negocio
    const rolesToAdd = [
        { nombre: 'Asesores', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Inversores', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Lideres', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Soporte', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } }
    ];

    for (const r of rolesToAdd) {
        const [existing] = await db.pool.query('SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = ?', [codigo, r.nombre]);
        if (existing.length === 0) {
            await db.crearRol(codigo, r.nombre, r.privilegios);
            console.log(`✅ Rol creado: ${r.nombre}`);
        } else {
            console.log(`ℹ️ Rol existente: ${r.nombre}`);
        }
    }

    // 3. PASO 2: ASIGNAR ROL DE ADMINISTRADOR (master, rol_id = 1) A LAS CUENTAS SOLICITADAS
    const adminEmails = [
        'colaboratium@gmail.com',
        'publicidadgloballoan@gmail.com',
        'publididadgloballoan@gmail.com'
    ];

    const [masterRoleRows] = await db.pool.query("SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = 'master'", [codigo]);
    const masterRoleId = masterRoleRows[0]?.id || 1;

    for (const email of adminEmails) {
        const [userCheck] = await db.pool.query('SELECT id, email, rol_id, codigo_empresa FROM users WHERE email = ?', [email]);
        if (userCheck.length > 0) {
            await db.pool.query(
                'UPDATE users SET rol_id = ?, codigo_empresa = ? WHERE email = ?',
                [masterRoleId, codigo, email]
            );
            console.log(`👑 Rol de Administrador (master ID: ${masterRoleId}) asignado a: ${email}`);
        } else {
            console.log(`ℹ️ Usuario ${email} no encontrado en la tabla users aún (se registrará como master al iniciar sesión).`);
        }
    }

    // 4. Inteligencia Central y Guardarraíles Globales (prompt_ia y conocimiento_ia)
    const promptIa = `Eres el Asistente Virtual Oficial de COLABORATIUM (GLOBAL LOAN S.A., Registro Oficial BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).

MARCO LEGAL Y GUARDARRAÍLES GLOBALES OBLIGATORIOS:
1. COSTO CERO PARA EL INVERSOR: Destaca siempre que al inversor JAMÁS se le cobra ningún concepto ni comisión; la plataforma cobra su uso y comisiones exclusivamente al tomador del crédito.
2. OPERATORIA NO CUSTODIAL: El inversor opera 100% bancarizado desde su propio CVU con soporte de Banco BIND y Banco Coinag. Ni Colaboratium ni sus asesores tocan, administran ni reciben fondos de terceros.
3. PROHIBICIÓN NORMATIVA BCRA:
   - NUNCA uses las palabras: "Banco", "Financiera", "Fondo de Inversión", "Plazo Fijo Colaboratium", "Depósito" o "Captación de ahorros".
   - NUNCA prometas "tasa garantizada", "rendimiento asegurado", "sin riesgo" ni "ganancia asegurada". Las tasas son estimadas y variables según el mercado.
4. OMISIÓN DEL CANON EN EL CHAT: NUNCA menciones el canon anual de membresía de USD 20 + IVA en WhatsApp; solo se informa en los Webinars de capacitación.
5. DOMICILIOS OFICIALES:
   - Oficinas Comerciales (reuniones y atención): Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.
   - Domicilio Legal y Fiscal: Maipú 568, Piso 8°, CABA.

PERFILES PRINCIPALES:
- Asesores Comerciales: Comisiones 4% (3 meses), 5% (6 meses) y 6% (12 meses), con 3% al calce inmediato y residual en cuotas. Leads propios (Carlos Gómez: 100% comisión) vs Leads de Colaboratium (Juan Ramírez: 3% inicial en Colaboratium + residual para asesor + 100% en reinversiones).
- Inversores: Tasas variables de mercado (promedio banco 60-90% TNA vs fintech 90-150% TNA = ~75% a 105% TNA estimada). Scoring de IA profunda que aprueba únicamente del 5% al 15% (Renaper, BCRA, Veraz, Nosis, cónyuge, ARCA/AFIP) y atomización en 20+ micropréstamos.
- Líderes: 10% adicional sobre la bolsa total de comisiones de su equipo, 100% en clientes propios, consola jerárquica y auditoría de Decálogo BCRA.

INVITACIÓN A FLUJOS GUIADOS:
Invita al usuario a ingresar a los flujos respondiendo:
- "1" o "asesor": Para el flujo de Asesores Comerciales.
- "2" o "invertir": Para el flujo de Inversores.
- "3" o "lider": Para el flujo de Líderes de Equipo.

REGLAS DE DERIVACIÓN (OBLIGATORIO FINALIZAR CON):
- [ROLE:Asesores] para consultas de comisiones, comercialización o ser asesor.
- [ROLE:Inversores] para consultas de inversión, tasas, plazos o rendimientos.
- [ROLE:Lideres] para estructuras comerciales, bolsa de equipo o alianzas.
- [ROLE:Soporte] para consultas técnicas o generales.
- Si el usuario requiere atención humana personalizada incluye la etiqueta [HANDOFF].`;

    const conocimientoIa = `# BASE DE CONOCIMIENTO OFICIAL COLABORATIUM (GLOBAL LOAN S.A.)

## 1. IDENTIFICACIÓN Y REGISTRO OFICIAL
- Razón Social: GLOBAL LOAN S.A.
- Nombre Comercial: Colaboratium
- Registro Oficial BCRA: Nº 40.015 (Registro oficial: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/)
- Domicilio Legal y Fiscal: Maipú 568, Piso 8°, CABA.
- Oficinas Comerciales: Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Provincia de Buenos Aires.
- Bancos Partners: Banco BIND (Banco Industrial) y Banco Coinag.
- Consola y Plataforma: https://consola.colaboratium.com.ar | https://www.colaboratium.com.ar

## 2. REGLA FUNDAMENTAL: CERO COSTO AL INVERSOR Y NO CUSTODIAL
- Al inversor JAMÁS se le cobra ningún concepto ni comisión. El uso de la plataforma y comisiones los paga exclusivamente el tomador del préstamo.
- Operatoria No Custodial: El inversor opera 100% bancarizado desde su propio CVU. Colaboratium y los asesores nunca tocan ni custodian fondos de terceros.

## 3. PROGRAMA DE ASESORES COMERCIALES (FLUJO A)
- Escala de Comisiones (sobre capital calzado):
  * 3 Meses: 4% Total (3% inmediato al calce + 1% prorrateado en 3 cuotas).
  * 6 Meses: 5% Total (3% inmediato al calce + 2% prorrateado en 6 cuotas).
  * 12 Meses: 6% Total (3% inmediato al calce + 3% prorrateado en 12 cuotas).
  * Reinversiones: Cada vez que el cliente reinvierte sus cuotas, se devenga el 100% de la comisión completa automáticamente.
- Regla de Atribución de Leads:
  * Caso Carlos Gómez (Clientes propios o precargados): El asesor cobra el 100% de la escala desde la primera colocación.
  * Caso Juan Ramírez (Leads de marketing provistos por Colaboratium): El 3% inicial de la primera colocación queda en Colaboratium; el asesor cobra todas las cuotas residuales y, en las reinversiones posteriores, ya cobra el 100% de la comisión plena.
- Conversión: Invitación al Webinar de Capacitación (40 min) o reunión en Vicente López. Canon de USD 20 NO se menciona en chat.

## 4. ATENCIÓN A INVERSORES (FLUJO B)
- Marco Normativo BCRA: No se garantizan tasas fijas ni rendimientos asegurados. Colaboratium es un Marketplace de préstamos P2P.
- Tasas Variables de Mercado:
  * Bancos tradicionales (tasas activas): 60% – 90% TNA.
  * Fintechs de préstamos directos: 90% – 150% TNA (promedio ~120% TNA, CFT 150%-300%).
  * Colaboratium: Tasa variable promedio competitiva (~75% a 105% TNA estimada).
- 4 Pilares de Seguridad:
  1. No Custodial (CVU propio en BIND / Coinag).
  2. Agente de IA Profunda: Analiza Renaper, BCRA, Veraz, Nosis, UIF/Worldsys, cónyuge, trabajo formal, antigüedad y ARCA/AFIP. Aprueba solo entre el 5% y el 15% más solvente.
  3. Atomización: Diversificación automática en 20 o más microcréditos.
  4. Cobranza Automatizada por Bot y convenios con estudios jurídicos.

## 5. LÍDERES DE EQUIPOS COMERCIALES (FLUJO C)
- Esquema Triple de Ingresos:
  1. 10% adicional de la bolsa de comisiones que genere todo su equipo de asesores en consola.
  2. 100% en clientes propios (Caso Carlos Gómez).
  3. Comisiones de leads de marketing asignados (Caso Juan Ramírez).
- Responsabilidad: Supervisar que su red cumpla el Decálogo BCRA. Sistema de penalidades graduadas (Baja: alerta/corrección 24 hs; Media: retención 25% hasta re-test; Grave: baja de asesor infractor manteniendo el 10% del resto del equipo).`;

    await db.actualizarIA(codigo, promptIa, conocimientoIa);
    console.log('✅ Inteligencia Central y Base de Conocimiento RAG actualizadas.');

    // 5. PURGAR TODOS LOS FLUJOS ANTIGUOS Y RESETEAR CONTACTOS
    console.log('🧹 Purgando flujos obsoletos de la empresa...');
    await db.pool.query('UPDATE contactos SET flujo_activo_id = NULL, nodo_actual_id = NULL WHERE codigo_empresa = ?', [codigo]);
    await db.pool.query('DELETE FROM flujos WHERE codigo_empresa = ?', [codigo]);
    console.log('✅ Base de flujos limpiada.');

    // 6. CREACIÓN DE LOS 4 NUEVOS FLUJOS (Flujo Maestro + Flujos A, B y C)

    // --- FLUJO 0: BIENVENIDA Y MENÚ MAESTRO (DEFAULT ENTRY) ---
    const flowDefaultData = {
        name: 'Bienvenida y Menú Maestro Colaboratium',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Punto de Inicio (Saludos / Campaña)',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_msg_bienvenida',
                type: 'message',
                name: 'Presentación Oficial Colaboratium',
                position: { x: 380, y: 200 },
                data: {
                    message: "Hola, ¿cómo estás? Te escribimos de *Colaboratium* (Global Loan S.A.), la primera plataforma de créditos entre particulares (P2P) registrada ante el BCRA bajo el *Nº 40.015* (verificable en: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).\n\nConectamos inversores con créditos calificados por IA en una operatoria 100% bancarizada y No Custodial (Banco BIND y Banco Coinag), donde al inversor *JAMÁS se le cobra ninguna comisión ni gasto* (todo costo lo abona el tomador)."
                }
            },
            {
                id: 'node_msg_opciones',
                type: 'message',
                name: 'Opciones de Interacción',
                position: { x: 720, y: 200 },
                data: {
                    message: "¿Con qué opción te gustaría avanzar? Escribe el número o palabra clave:\n\n1️⃣ Escribe *1* o *asesor*: Quiero ser Asesor Comercial (comisiones del 4%, 5% y 6%, ingresos recurrentes y capacitación).\n2️⃣ Escribe *2* o *invertir*: Quiero Invertir mi Capital (rendimiento de mercado ~75% a 105% TNA, scoring IA del 5% al 15% y atomización en 20+ micropréstamos).\n3️⃣ Escribe *3* o *lider*: Tengo Equipo / Ser Líder (10% adicional sobre la bolsa de comisiones de tu equipo y acceso a consola jerárquica).\n\nTambién puedes consultarme cualquier duda directamente."
                }
            },
            {
                id: 'node_id_seleccion',
                type: 'identity',
                name: 'Captura de Opción',
                position: { x: 1060, y: 200 },
                data: {
                    question: "¿Qué perfil deseas explorar? Escribe 1 (Asesor), 2 (Invertir) o 3 (Líder):",
                    variable_name: "opcion_seleccionada"
                }
            },
            {
                id: 'node_rag_router',
                type: 'rag',
                name: 'Orientador Virtual',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el Orientador Virtual de Colaboratium. Explica brevemente el modelo de Colaboratium e invita al usuario a responder 1 para asesor, 2 para invertir o 3 para líder. Respeta todos los guardarraíles: link BCRA 40.015 obligatorio y cero costo al inversor."
                }
            }
        ],
        edges: [
            { id: 'e0-1', source: 'node_trigger', target: 'node_msg_bienvenida' },
            { id: 'e0-2', source: 'node_msg_bienvenida', target: 'node_msg_opciones' },
            { id: 'e0-3', source: 'node_msg_opciones', target: 'node_id_seleccion' },
            { id: 'e0-4', source: 'node_id_seleccion', target: 'node_rag_router' }
        ]
    };

    const flow0Id = await db.crearFlujo(
        codigo, 
        'Bienvenida y Menú Maestro Colaboratium', 
        'hola, buenas, inicio, empezar, menu, opciones, con quien hablo, comenzar, volver', 
        flowDefaultData
    );
    console.log(`✅ Flujo Maestro creado con ID ${flow0Id}`);

    // --- FLUJO A: ASESORES COMERCIALES ---
    const flowAData = {
        name: 'Flujo A: Asesores Comerciales',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Inicio Asesores',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_a1_propuesta',
                type: 'message',
                name: 'A1: Propuesta y Comisiones',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Excelente! Como *Asesor Comercial de Colaboratium* vas a comercializar la primera plataforma P2P registrada ante el BCRA bajo el *Nº 40.015* (https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) con soporte de *Banco BIND y Banco Coinag*.\n\n*Ventaja clave para tus clientes:* Al inversor *JAMÁS se le cobra ningún concepto ni comisión* (el uso de la plataforma y las comisiones los paga el tomador del crédito), y el inversor mantiene el dinero en su propio CVU.\n\n*Tu Esquema de Comisiones (sobre capital calzado):*\n• *3 meses:* *4% total* (3% inmediato al calce + 1% prorrateado en las 3 cuotas).\n• *6 meses:* *5% total* (3% inmediato al calce + 2% prorrateado en las 6 cuotas).\n• *12 meses:* *6% total* (3% inmediato al calce + 3% prorrateado en las 12 cuotas).\n• *Reinversiones:* Cada vez que tu cliente reinvierte, volvés a cobrar la comisión completa de forma automática."
                }
            },
            {
                id: 'node_a2_leads',
                type: 'message',
                name: 'A2: Regla de Atribución de Leads',
                position: { x: 720, y: 200 },
                data: {
                    message: "*¿Cómo funcionan tus clientes propios vs. los leads que te envía Colaboratium?*\n\n1. *Clientes precargados o traídos por vos (Caso Carlos Gómez):* Cobrás el *100% de la comisión* desde la primera colocación (el 3% inmediato + las cuotas residuales + todas las reinversiones).\n2. *Leads de campañas de marketing de Colaboratium (Caso Juan Ramírez):* Cuando un inversor entra por publicidad de Colaboratium e invierte (ej. $100.000), el 3% inicial de esa primera asignación queda para Colaboratium. Luego ese inversor te es asignado: vos cobrás *todas las cuotas residuales de ese primer crédito* y, cuando el cliente reinvierta sus cuotas, *ya cobrás el 100% de la comisión plena (3% inmediato + residual)*."
                }
            },
            {
                id: 'node_a3_captura',
                type: 'identity',
                name: 'A3: Agenda y Registro de Capacitación',
                position: { x: 1060, y: 200 },
                data: {
                    question: "📅 *FECHAS Y HORARIOS DISPONIBLES DE CAPACITACIÓN*\n\n💻 *WEBINAR VIRTUAL (Vía Google Meet)*:\n• Opción *1*: Lunes 26 de Octubre (10:30 a 12:00 hs)\n• Opción *2*: Lunes 26 de Octubre (12:30 a 14:00 hs)\n• Opción *3*: Lunes 26 de Octubre (14:30 a 16:00 hs)\n• Opción *4*: Miércoles 28 de Octubre (10:30 a 12:00 hs)\n• Opción *6*: Viernes 30 de Octubre (12:00 a 13:30 hs)\n\n🏢 *REUNIÓN PRESENCIAL (Oficinas Comerciales)*:\n📍 *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López*\n• Opción *5*: Miércoles 28 de Octubre (14:30 a 16:00 hs)\n\n👉 *¿A cuál te gustaría sumarte?* Por favor, indícame el número de opción (ej. *1*, *2*, *5*) junto con tu *Nombre completo* y *Correo electrónico* (ej. *1 Juan Ramón Valle damduff@gmail.com*):",
                    variable_name: "datos_contacto_asesor"
                }
            },
            {
                id: 'node_rag_asesores',
                type: 'rag',
                name: 'A4: Asistente IA Asesores',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el asistente de reclutamiento de Asesores Comerciales de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica con claridad la escala de comisiones (4% a 3m, 5% a 6m, 6% a 12m, con 3% inmediato al calce y el resto en cuotas), la diferencia entre leads propios (100% comisión) y leads provistos por Colaboratium (el 3% del primer calce queda en Colaboratium y el asesor cobra el residual en cuotas + el 100% de las reinversiones). Destaca que al inversor jamás se le cobra comisión (paga todo el tomador). No menciones el canon anual en el chat; invita al Webinar de 40 minutos o a las oficinas de Av. del Libertador 264, 1° Piso Contrafrente, Vicente López."
                }
            },
            {
                id: 'node_approval_asesor',
                type: 'approval',
                name: 'Derivación a Asesor Humano',
                position: { x: 1740, y: 200 },
                data: {}
            }
        ],
        edges: [
            { id: 'ea-1', source: 'node_trigger', target: 'node_a1_propuesta' },
            { id: 'ea-2', source: 'node_a1_propuesta', target: 'node_a2_leads' },
            { id: 'ea-3', source: 'node_a2_leads', target: 'node_a3_captura' },
            { id: 'ea-4', source: 'node_a3_captura', target: 'node_rag_asesores' },
            { id: 'ea-5', source: 'node_rag_asesores', target: 'node_approval_asesor' }
        ]
    };

    const flowAId = await db.crearFlujo(
        codigo,
        'Flujo A: Asesores Comerciales',
        'asesor, asesores, comercial, quiero ser asesor, btn_asesor, 1',
        flowAData
    );
    console.log(`✅ Flujo A creado con ID ${flowAId}`);

    // --- FLUJO B: INVERSORES DE CAPITAL ---
    const flowBData = {
        name: 'Flujo B: Inversores de Capital',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Inicio Inversores',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_b1_bienvenida',
                type: 'message',
                name: 'B1: Bienvenida & Transparencia',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Bienvenido a *Colaboratium*! Somos la primera plataforma de créditos entre particulares (P2P) registrada ante el *BCRA bajo el Nº 40.015* (podés verificar nuestro certificado oficial en: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).\n\n*Punto importante:* En Colaboratium *jamás se le cobra comisión ni gasto alguno al inversor*; el uso de la plataforma y las comisiones se le cobran exclusivamente al tomador del préstamo."
                }
            },
            {
                id: 'node_b2_tasas',
                type: 'message',
                name: 'B2: Tasas Variables de Mercado',
                position: { x: 720, y: 200 },
                data: {
                    message: "Siguiendo el marco normativo de transparencia del *BCRA (Registro Nº 40.015 - https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/)*, en Colaboratium *no prometemos tasas fijas ni garantizamos rendimientos asegurados*, ya que no somos un plazo fijo bancario sino un Marketplace de créditos entre particulares (P2P).\n\n*¿Cuánto está rindiendo hoy y cómo se calcula?*\nLas tasas son *variables* y nuestro sistema las obtiene automáticamente del mercado en tiempo real eliminando la intermediación bancaria:\n• Hoy en Argentina el sector bancario opera en tasas activas del *60% al 90% TNA*, mientras que las fintech de préstamos directos cobran entre *90% y 150% TNA*.\n• En Colaboratium accedés a una *tasa promedio competitiva entre el segmento bancario y el fintech (aprox. 75% a 105% TNA estimada)*, la cual verás reflejada en vivo dentro de la plataforma según el plazo (3, 6 o 12 meses) y el perfil de inversión que elijas (*Conservador, Intermedio o Avanzado*)."
                }
            },
            {
                id: 'node_b3_seguridad',
                type: 'message',
                name: 'B3: Seguridad e IA (5% al 15%)',
                position: { x: 1060, y: 200 },
                data: {
                    message: "Nuestro sistema protege tu operatoria mediante 4 pilares de transparencia:\n\n1. *Operación 100% Bancarizada y No Custodial:* Operás desde tu propio CVU (con soporte de *Banco BIND y Banco Coinag*). Colaboratium nunca toca ni administra tu dinero; fluye de tu CVU directo al tomador.\n2. *Agente de IA de Evaluación Profunda (Aprueba del 5% al 15%):* Además de validar biometría *Renaper, BCRA, Veraz, Nosis y UIF/Worldsys*, nuestro Agente de IA analiza *relaciones contractuales de cónyuge, trabajo inscripto, antigüedad laboral e informes de ARCA/AFIP*. Así filtra entre el 85% y el 95% de los pedidos y *aprueba solo entre el 5% y el 15%* de mejores perfiles.\n3. *3 Productos de Inversión y Atomización:* Con ese 5% a 15% aprobado se arman las carteras *Conservadora (Principiante), Intermedia y Avanzada*. La IA fracciona tu inversión en 20 o más microcréditos distintos para diversificar el riesgo al máximo.\n4. *Cobranza por Bot y Estudios Jurídicos Partners:* Débito automático con gestión preventiva por bot y derivación a estudios legales partners en caso de mora."
                }
            },
            {
                id: 'node_b4_captura',
                type: 'identity',
                name: 'B4: Plazo y Capital',
                position: { x: 1400, y: 200 },
                data: {
                    question: "¿Estás buscando invertir a corto plazo (3 a 6 meses) o a 12 meses, y qué capital estimado te interesaría colocar?",
                    variable_name: "perfil_capital_inversor"
                }
            },
            {
                id: 'node_rag_inversores',
                type: 'rag',
                name: 'B5: Asistente Senior Inversores',
                position: { x: 1740, y: 200 },
                data: {
                    prompt: "Eres el asistente de atención a Inversores de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Cumple estrictamente el marco legal del BCRA: NUNCA prometas tasas fijas ni garantices rendimientos. Explica que las tasas son variables, que el sistema las toma automáticamente del mercado y que si preguntan cuánto rinde hoy, debes informar el promedio entre las tasas de bancos (60%-90% TNA) y las de fintechs de préstamos (90%-150% TNA), ubicándose en torno al 75%-105% TNA estimada según el perfil elegido (Conservador, Intermedio o Avanzado). Recalca que al inversor jamás se le cobra comisión alguna (la paga el tomador) y detalla el filtro del Agente de IA (aprueba del 5% al 15%) y atomización en 20+ préstamos."
                }
            },
            {
                id: 'node_approval_inversor',
                type: 'approval',
                name: 'Derivación Oficial Inversores',
                position: { x: 2080, y: 200 },
                data: {}
            }
        ],
        edges: [
            { id: 'eb-1', source: 'node_trigger', target: 'node_b1_bienvenida' },
            { id: 'eb-2', source: 'node_b1_bienvenida', target: 'node_b2_tasas' },
            { id: 'eb-3', source: 'node_b2_tasas', target: 'node_b3_seguridad' },
            { id: 'eb-4', source: 'node_b3_seguridad', target: 'node_b4_captura' },
            { id: 'eb-5', source: 'node_b4_captura', target: 'node_rag_inversores' },
            { id: 'eb-6', source: 'node_rag_inversores', target: 'node_approval_inversor' }
        ]
    };

    const flowBId = await db.crearFlujo(
        codigo,
        'Flujo B: Inversores de Capital',
        'invertir, inversor, inversores, inversion, tasas, rendimientos, ganancia, quiero invertir, btn_inversor, 2',
        flowBData
    );
    console.log(`✅ Flujo B creado con ID ${flowBId}`);

    // --- FLUJO C: LÍDERES DE EQUIPOS ---
    const flowCData = {
        name: 'Flujo C: Líderes de Equipos',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Inicio Líderes',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_c1_esquema',
                type: 'message',
                name: 'C1: Esquema Triple Ingresos',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Bienvenido! Como *Líder de Equipo en Colaboratium* (Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) contarás con acceso jerárquico en `consola.colaboratium.com.ar` y el respaldo de nuestras oficinas comerciales en *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López*.\n\n*Tu Esquema Triple de Ingresos:*\n1. *10% de la Bolsa de Comisiones de tu Equipo:* Cobrás un *10% sobre el total de las comisiones que generen todos los asesores debajo de tu estructura*.\n2. *100% en Clientes Propios / Precargados (Ej. Caso Carlos Gómez):* En los inversores precargados por vos o tu red, se liquida el 100% de la escala oficial desde la primera colocación (*4% en 3 meses, 5% en 6 meses y 6% en 12 meses*, con *3% inmediato al calce* y el resto en cuotas mensuales).\n3. *Leads Enviados por Colaboratium (Ej. Caso Juan Ramírez):* Cuando Colaboratium capta un inversor por marketing (ej. invierte $100.000), solo el *3% de la primera asignación* queda para Colaboratium. Luego el cliente te es asignado a vos: cobrás *todas las cuotas residuales de ese primer préstamo* y, cuando el cliente reinvierta sus cuotas, *ya cobrás el 100% de la comisión plena (3% inicial + residual)*."
                }
            },
            {
                id: 'node_c2_responsabilidad',
                type: 'message',
                name: 'C2: Responsabilidad y Transparencia',
                position: { x: 720, y: 200 },
                data: {
                    message: "*Tu Responsabilidad como Líder y Ventaja Comercial:*\n• *Cero costo para el inversor:* Tu equipo cuenta con un argumento imbatible: Colaboratium *jamás le cobra ningún concepto al inversor* (el uso de la plataforma y las comisiones los paga el tomador del crédito).\n• *Control de Transparencia:* Como Líder sos responsable de supervisar que los asesores de tu grupo respeten el Decálogo de Comunicación del BCRA (no prometer tasas fijas ni rendimientos garantizados, usar material oficial sin alteraciones y mantener cero manejo de dinero o transferencias de clientes)."
                }
            },
            {
                id: 'node_c3_captura',
                type: 'identity',
                name: 'C3: Datos de Red',
                position: { x: 1060, y: 200 },
                data: {
                    question: "¿Cuántos asesores integran hoy tu equipo? Déjame tu nombre completo, teléfono y correo para coordinar una reunión ejecutiva en Vicente López o sumarte al próximo Webinar de Líderes:",
                    variable_name: "datos_red_lider"
                }
            },
            {
                id: 'node_rag_lideres',
                type: 'rag',
                name: 'C4: Asistente Senior Líderes',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el asistente para Líderes de Equipos Comerciales de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica el rol del líder: cobra el 10% adicional de la bolsa total de comisiones que genere su equipo de asesores, más el 100% de comisión en sus propios clientes precargados, más las comisiones residuales y de reinversión plena de los leads que le envíe Colaboratium (donde solo el 3% del primer calce queda en Colaboratium). Enfatiza su obligación de controlar la transparencia y comunicación de sus asesores y destaca que al inversor jamás se le cobra comisión. No menciones el canon anual en el chat."
                }
            },
            {
                id: 'node_approval_lider',
                type: 'approval',
                name: 'Derivación Dirección Comercial',
                position: { x: 1740, y: 200 },
                data: {}
            }
        ],
        edges: [
            { id: 'ec-1', source: 'node_trigger', target: 'node_c1_esquema' },
            { id: 'ec-2', source: 'node_c1_esquema', target: 'node_c2_responsabilidad' },
            { id: 'ec-3', source: 'node_c2_responsabilidad', target: 'node_c3_captura' },
            { id: 'ec-4', source: 'node_c3_captura', target: 'node_rag_lideres' },
            { id: 'ec-5', source: 'node_rag_lideres', target: 'node_approval_lider' }
        ]
    };

    const flowCId = await db.crearFlujo(
        codigo,
        'Flujo C: Líderes de Equipos',
        'lider, lideres, equipo, ser lider, tengo equipo, btn_lider, 3',
        flowCData
    );
    console.log(`✅ Flujo C creado con ID ${flowCId}`);

    console.log('================================================================');
    console.log('🎉 MIGRACIÓN Y CARGA DE FLUJOS COMPLETADA EXITOSAMENTE');
    console.log('================================================================');
    process.exit(0);
}

seedRAGFlows().catch(err => {
    console.error('❌ Error en migración de flujos:', err);
    process.exit(1);
});
