const db = require('./database');

async function applyRAGv3Flows() {
    await db.initDB();
    const codigo = 'KRZMJI';

    console.log('================================================================');
    console.log('🚀 CONFIGURANDO FLUJOS V3 PARA COLABORATIUM SEGÚN SKILL MD');
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

    // 2. Inteligencia Central y Guardarraíles Globales (prompt_ia y conocimiento_ia)
    const promptIa = `Eres el Asistente Virtual Oficial de COLABORATIUM (GLOBAL LOAN S.A., Registro Oficial BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).

MARCO LEGAL Y GUARDARRAÍLES GLOBALES OBLIGATORIOS:
1. COSTO CERO PARA EL INVERSOR: Destaca siempre que al inversor JAMÁS se le cobra ningún concepto ni comisión; la plataforma cobra su uso y comisiones exclusivamente al tomador del crédito.
2. OPERATORIA NO CUSTODIAL: El inversor opera 100% bancarizado desde su propio CVU con soporte de Banco BIND y Banco Coinag. Ni Colaboratium ni sus asesores tocan, administran ni reciben fondos de terceros (Cláusula 2.5 Carta Oferta).
3. PROHIBICIÓN NORMATIVA BCRA (Ley 21.526 y Art. 310 C. Penal):
   - NUNCA uses las palabras: "Banco", "Financiera", "Fondo de Inversión", "Plazo Fijo Colaboratium", "Depósito", "Captación de ahorros", "Sin riesgo".
   - NUNCA prometas "tasa garantizada", "rendimiento asegurado" ni "ganancia asegurada". Las tasas son estimadas y variables según el mercado.
4. OMISIÓN DEL CANON EN EL CHAT: NUNCA menciones el canon anual de membresía de USD 20 + IVA en WhatsApp; participar de la reunión informativa es 100% gratuito y toda la operatoria se explica en el Webinar.
5. DOMICILIOS OFICIALES:
   - Oficinas Comerciales (reuniones y atención): Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.
   - Domicilio Legal y Fiscal: Maipú 568, Piso 8°, CABA.

CIERRE DE CONVERSACIÓN PARA ASESORES Y LÍDERES:
- El objetivo de cierre para candidatos a Asesores Comerciales y Líderes de Equipo es que participen en los Webinars de Capacitación Virtuales (Google Meet) o en las Reuniones Presenciales en Vicente López programadas en el Calendario Oficial.
- Ofréceles siempre la elección del turno del calendario y pídeles su nombre completo y correo electrónico para enviarles la confirmación y el enlace de Google Meet.

PERFILES PRINCIPALES:
- Asesores Comerciales: Comisiones oficiales 4% (3 meses), 5% (6 meses) y 6% (12 meses), con 3% al calce inmediato y residual en cuotas + reinversión automática. Clientes propios / pauta Meta Ads (Caso Carlos Gómez: 100% comisión desde primera operación) vs Leads provistos por Colaboratium (Caso Juan Ramírez: 3% inicial Colaboratium + residual cuotas + 100% reinversiones).
- Inversores: Mercado P2P, límites simplificados desde $100.000 hasta $10.000.000 ARS sin papeles extra, simulador online (https://colaboratium.com.ar/inversiones.php#simulador), tasas variables promedio ~75% a 105% TNA estimada vs Plazo Fijo (16%-24% TNA) y bancos (60%-90% TNA). Scoring de IA profunda (5% al 15% aprobado) y atomización en 20+ micropréstamos.
- Líderes: Esquema Triple de Ingresos (10% overriding sobre bolsa total de asesores, 100% en clientes propios Carlos Gómez, residual y reinversiones en leads Juan Ramírez), consola jerárquica con ranking gráfico y regla de protección del 10% ante desvíos individuales.

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
- Registro Oficial BCRA: Nº 40.015 (Enlace verificable: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/)
- Domicilio Legal y Fiscal: Maipú 568, Piso 8°, CABA.
- Oficinas Comerciales: Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Provincia de Buenos Aires.
- Bancos Partners: Banco BIND (Banco Industrial) y Banco Coinag.
- Consola y Plataforma: https://consola.colaboratium.com.ar | https://www.colaboratium.com.ar
- Título Oficial del Asesor: Asesor / Consultor Financiero Independiente adherido a la Red Colaboratium.

## 2. REGLA FUNDAMENTAL: CERO COSTO AL INVERSOR Y NO CUSTODIAL
- Al inversor JAMÁS se le cobra ningún concepto ni comisión. El uso de la plataforma y comisiones los paga exclusivamente el tomador del crédito.
- Operatoria 100% No Custodial: El inversor opera bancarizado desde su propio CVU (Banco BIND y Banco Coinag). Colaboratium y los asesores nunca tocan ni custodian fondos de terceros.

## 3. PROGRAMA DE ASESORES COMERCIALES (FLUJO A)
- Escala de Comisiones Oficial (sobre capital calzado):
  * 3 Meses: 4% Total (3% inmediato al calce + 1% en 3 cuotas).
  * 6 Meses: 5% Total (3% inmediato al calce + 2% en 6 cuotas).
  * 12 Meses: 6% Total (3% inmediato al calce + 3% en 12 cuotas).
  * Reinversiones: Cada vez que el cliente reinvierte sus cuotas, se devenga el 100% de la comisión completa automáticamente.
- Regla de Atribución de Clientes:
  * Clientes Propios o por Meta Ads (Caso Carlos Gómez): Link UTM desde consola. Pauta mínima de $5.000 ARS/día ($150.000/mes) en Reels/Stories genera 4-10 consultas diarias y 6-18 nuevos inversores/mes al 100% de comisión desde la primera operación.
  * Leads de Marketing Provistos por Colaboratium (Caso Juan Ramírez): El 3% inicial queda en Colaboratium; el asesor asignado cobra todas las cuotas residuales y el 100% de la comisión plena (3% inicial + residual) en todas las reinversiones.
- Cierre Obligatorio: Inscripción y participación en los Webinars de Capacitación Virtuales (Google Meet) o Reunión Presencial en Vicente López del Calendario Oficial. Canon de USD 20 NO se menciona en el chat.

## 4. ATENCIÓN A INVERSORES (FLUJO B)
- Marco Normativo BCRA: No se garantizan tasas fijas ni rendimientos asegurados. Colaboratium es un Marketplace P2P de créditos reales.
- Benchmarks de Mercado 2026:
  * Plazo Fijo y Billeteras remuneradas: 16% a 24% TNA pasiva.
  * Bancos tradicionales (tasas activas): 60% a 90% TNA.
  * Fintechs de créditos directos: 90% a 150% TNA.
  * Colaboratium: Tasa variable promedio competitiva (~75% a 105% TNA estimada, 0% comisión para el inversor).
- Montos: Mínimo $100.000 ARS y máximo $10.000.000 ARS sin papeles extra. Simulador online: https://colaboratium.com.ar/inversiones.php#simulador
- 4 Pilares de Seguridad:
  1. No Custodial (CVU propio en BIND / Coinag).
  2. Agente de IA Profunda: Aprueba solo del 5% al 15% evaluando Renaper, BCRA, Veraz, Nosis, UIF/Worldsys, cónyuge, trabajo formal, antigüedad y ARCA/AFIP.
  3. Atomización en 20+ Micropréstamos en 3 productos: Conservador, Intermedio y Avanzado.
  4. Cobranza Preventiva por Bot y convenios con estudios jurídicos.

## 5. LÍDERES DE EQUIPOS COMERCIALES (FLUJO C)
- Esquema Triple de Ingresos:
  1. 10% adicional sobre la bolsa total de comisiones de todos los asesores en su estructura (Overriding).
  2. 100% de comisión en clientes propios precargados (Caso Carlos Gómez).
  3. Comisiones residuales y reinversiones plenas de leads asignados por marketing (Caso Juan Ramírez).
- Herramientas de Consola: Comercial > Crear Vendedor, Organigrama, Links UTM y Ranking Gráfico por leads y volumen fondeado en ARS (con Top 3).
- Regla de Protección del 10%: El régimen de penalidades es individualizado. Si 1 asesor comete una falta, la sanción aplica solo sobre ese asesor y el líder mantiene su 10% intacto. Si el líder reporta o corrige desvíos a tiempo, tiene 0% de quita sobre su overriding.
- Cierre Obligatorio: Participación en el Webinar de Líderes del Calendario (Google Meet) o Reunión Ejecutiva 1-a-1 en Av. del Libertador 264, Vicente López.`;

    await db.actualizarIA(codigo, promptIa, conocimientoIa);
    console.log('✅ Inteligencia Central y Base de Conocimiento RAG actualizadas.');

    // 3. DEFINICIÓN DE LOS 4 FLUJOS CONVERSACIONALES V3

    // ==========================================================
    // FLUJO 1: BIENVENIDA Y MENÚ MAESTRO (DEFAULT ENTRY)
    // ==========================================================
    const flow1Data = {
        name: 'Bienvenida y Menú Maestro Colaboratium',
        edges: [
            { id: 'e0-1', source: 'node_trigger', target: 'node_msg_bienvenida' },
            { id: 'e0-2', source: 'node_msg_bienvenida', target: 'node_msg_opciones' },
            { id: 'e0-3', source: 'node_msg_opciones', target: 'node_id_seleccion' },
            { id: 'e0-4', source: 'node_id_seleccion', target: 'node_rag_router' }
        ],
        nodes: [
            {
                id: 'node_trigger',
                name: 'Punto de Inicio (Saludos / Campaña)',
                type: 'webhook',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_msg_bienvenida',
                name: 'Presentación Oficial Colaboratium',
                type: 'message',
                position: { x: 380, y: 200 },
                data: {
                    message: "Hola, ¿cómo estás? Te escribimos de *Colaboratium* (Global Loan S.A.), la primera plataforma de créditos entre particulares (P2P) registrada ante el BCRA bajo el *Nº 40.015* (verificable en: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).\n\nConectamos inversores con créditos calificados por IA en una operatoria 100% bancarizada y No Custodial (Banco BIND y Banco Coinag), donde al inversor *JAMÁS se le cobra ninguna comisión ni gasto* (todo costo lo abona el tomador del crédito)."
                }
            },
            {
                id: 'node_msg_opciones',
                name: 'Opciones de Interacción',
                type: 'message',
                position: { x: 720, y: 200 },
                data: {
                    message: "¿Con qué opción te gustaría avanzar? Escribe el número o palabra clave:\n\n1️⃣ Escribe *1* o *inversor*: Quiero Invertir mi Capital (rendimiento estimado variable ~75% a 105% TNA, scoring IA del 5% al 15%, atomización en 20+ microcréditos y simulador online).\n2️⃣ Escribe *2* o *asesor*: Quiero ser Asesor Comercial (escala oficial de comisiones del 4%, 5% y 6%, clientes propios o pauta Meta Ads, y Webinar de Capacitación en vivo).\n3️⃣ Escribe *3* o *lider*: Tengo Equipo de Trabajo / Ser Líder (10% overriding de bolsa de equipo, consola jerárquica con ranking gráfico y Webinar de Líderes).\n\n👉 También podés consultarme cualquier duda directamente."
                }
            },
            {
                id: 'node_id_seleccion',
                name: 'Captura de Opción',
                type: 'identity',
                position: { x: 1060, y: 200 },
                data: {
                    question: "¿Qué perfil deseas explorar? Escribe 1 (Inversor), 2 (Asesor) o 3 (Líder):",
                    variable_name: "opcion_seleccionada"
                }
            },
            {
                id: 'node_rag_router',
                name: 'Orientador Virtual',
                type: 'rag',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el Orientador Virtual de Colaboratium (Global Loan S.A. - Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica brevemente el modelo P2P e invita a responder 1 para inversor, 2 para asesor o 3 para líder. Respeta los guardarraíles: link BCRA 40.015 obligatorio y cero costo al inversor."
                }
            }
        ]
    };

    // ==========================================================
    // FLUJO 2: ASESORES COMERCIALES (FLUJO A)
    // ==========================================================
    const flowAData = {
        name: 'Flujo A: Asesores Comerciales',
        edges: [
            { id: 'ea-1', source: 'node_trigger', target: 'node_a1_propuesta' },
            { id: 'ea-2', source: 'node_a1_propuesta', target: 'node_a2_leads' },
            { id: 'ea-3', source: 'node_a2_leads', target: 'node_a3_captura' },
            { id: 'ea-4', source: 'node_a3_captura', target: 'node_rag_asesores' },
            { id: 'ea-5', source: 'node_rag_asesores', target: 'node_approval_asesor' }
        ],
        nodes: [
            {
                id: 'node_trigger',
                name: 'Inicio Asesores',
                type: 'webhook',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_a1_propuesta',
                name: 'A1: Propuesta y Comisiones Asesor',
                type: 'message',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Excelente! Como *Asesor Comercial de Colaboratium* vas a conectar inversores con la primera plataforma P2P registrada ante el BCRA bajo el *Nº 40.015* (https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) con soporte de *Banco BIND y Banco Coinag*.\n\n*Ventaja clave para tus clientes:* Al inversor *JAMÁS se le cobra ningún concepto ni comisión* (el uso de la plataforma y comisiones los paga exclusivamente el tomador del crédito), y el inversor opera 100% bancarizado desde su propio CVU.\n\n*Tu Escala Oficial de Comisiones (en tu CVU vía Monotributo/RI):*\n• *3 meses:* *4% total* (*3% inmediato* al calce efectivo + 1% en 3 cuotas).\n• *6 meses:* *5% total* (*3% inmediato* al calce efectivo + 2% en 6 cuotas).\n• *12 meses:* *6% total* (*3% inmediato* al calce efectivo + 3% en 12 cuotas).\n• *Comisión Recurrente:* Cada vez que tu inversor cobra cuotas y reinvierte, volvés a cobrar la comisión completa automáticamente."
                }
            },
            {
                id: 'node_a2_leads',
                name: 'A2: Captación, Meta Ads y Atribución',
                type: 'message',
                position: { x: 720, y: 200 },
                data: {
                    message: "*¿Cómo captar clientes y cómo se asignan tus comisiones?*\n\n1. *Clientes Propios o por tu Publicidad en Redes (100% Comisión - Caso Carlos Gómez):* Desde `consola.colaboratium.com.ar` generás tu propio link UTM. En la capacitación te enseñamos el paso a paso en *Meta Ads* (Instagram Reels/Stories con -35% de costo): con una pauta mínima de *$5.000 ARS/día ($150.000 ARS/mes)* generás entre *4 y 10 consultas diarias*, logrando entre *6 y 18 nuevos inversores por mes* con el *100% de la comisión desde la primera colocación*.\n2. *Leads provistos por Colaboratium (Caso Juan Ramírez):* Cuando un inversor entra por publicidad institucional de Colaboratium e invierte, el 3% inicial de ese primer crédito queda en Colaboratium. Luego te asignamos ese cliente: cobrás *todas las cuotas residuales de ese primer crédito* y, apenas reinvierta, *ya cobrás el 100% de la comisión plena (3% inmediato + residual)*.\n\nAdemás contás con nuestras oficinas en *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López* para citar clientes si lo necesitás."
                }
            },
            {
                id: 'node_a3_captura',
                name: 'A3: Cierre y Elección de Webinar del Calendario',
                type: 'identity',
                position: { x: 1060, y: 200 },
                data: {
                    question: "📅 *PRÓXIMAS FECHAS DE WEBINAR DE CAPACITACIÓN EN EL CALENDARIO*\n\nPara sumarte a la reunión informativa virtual de 40 minutos (Google Meet) o presencial en Vicente López, elegí la opción que te quede más cómoda del menú en pantalla o responde con:\n👉 El número de opción elegida (ej. *1*, *2*), tu *Nombre completo* y tu *Correo electrónico* para emitir tu invitación formal y enviarte el link de acceso:",
                    variable_name: "datos_contacto_asesor"
                }
            },
            {
                id: 'node_rag_asesores',
                name: 'A4: Asistente IA Asesores',
                type: 'rag',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el Asistente Oficial de Reclutamiento de Asesores Comerciales de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica con claridad la escala de comisiones (4% a 3m, 5% a 6m, 6% a 12m, con 3% al calce inmediato), clientes propios (100% comisión Caso Carlos Gómez) vs leads provistos por Colaboratium (Caso Juan Ramírez). Enfatiza que al inversor JAMÁS se le cobra comisión (paga todo el tomador). PROHIBIDO mencionar el canon anual de membresía en el chat (se explica en el webinar). Prohibido prometer tasa garantizada. Invita a participar en el Webinar de Capacitación del calendario o a la reunión en Av. del Libertador 264, 1° Piso Contrafrente, Vicente López."
                }
            },
            {
                id: 'node_approval_asesor',
                name: 'Derivación a Asesor Humano',
                type: 'approval',
                position: { x: 1740, y: 200 },
                data: {}
            }
        ]
    };

    // ==========================================================
    // FLUJO 3: INVERSORES DE CAPITAL (FLUJO B)
    // ==========================================================
    const flowBData = {
        name: 'Flujo B: Inversores de Capital',
        edges: [
            { id: 'eb-1', source: 'node_trigger', target: 'node_b1_tasas' },
            { id: 'eb-2', source: 'node_b1_tasas', target: 'node_b2_transparencia' },
            { id: 'eb-3', source: 'node_b2_transparencia', target: 'node_b3_seguridad' },
            { id: 'eb-4', source: 'node_b3_seguridad', target: 'node_b4_captura' },
            { id: 'eb-5', source: 'node_b4_captura', target: 'node_rag_inversores' },
            { id: 'eb-6', source: 'node_rag_inversores', target: 'node_approval_inversor' }
        ],
        nodes: [
            {
                id: 'node_trigger',
                name: 'Inicio Inversores',
                type: 'webhook',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_b1_tasas',
                name: 'B1: Marco Institucional y Simulador Online',
                type: 'message',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Bienvenido a *Colaboratium* (Global Loan S.A.)! Somos la primera plataforma de créditos entre particulares (P2P) registrada ante el *BCRA bajo el Nº 40.015* (verificable en: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).\n\nConectamos tu capital con créditos calificados por IA eliminando la intermediación bancaria, con una ventaja única: *al inversor JAMÁS se le cobra comisión ni gasto alguno* (todo costo lo abona el tomador del préstamo).\n\n💰 *Límites de Inversión Simplificados:*\n• *Monto mínimo:* *$100.000 ARS*\n• *Monto máximo sin presentar documentación extra:* *$10.000.000 ARS*\n\n📊 *Simulador Online:* Podés calcular tus rendimientos estimados según el plazo aquí:\n👉 https://colaboratium.com.ar/inversiones.php#simulador"
                }
            },
            {
                id: 'node_b2_transparencia',
                name: 'B2: Transparencia BCRA y Tasas de Mercado',
                type: 'message',
                position: { x: 720, y: 200 },
                data: {
                    message: "Cumpliendo con las normas de transparencia del *BCRA (Registro Nº 40.015)*, en Colaboratium *no prometemos tasas fijas ni garantizamos rendimientos asegurados*, ya que no somos un depósito bancario sino un Marketplace de créditos reales.\n\n*¿Cómo se calcula tu rendimiento hoy en tiempo real?*\nNuestro sistema releva automáticamente las tasas vigentes del mercado argentino:\n• Mientras un *Plazo Fijo o Billetera Remunerada* paga apenas entre *16% y 24% TNA* (con topes de saldo), los *bancos* prestan ese dinero al *60%–90% TNA* y las *fintechs de préstamos* cobran entre *90% y 150% TNA*.\n• Al eliminar al banco intermediario y tener *0% de comisión para vos*, en Colaboratium accedés a una *tasa variable competitiva promedio de entre 75% y 105% TNA estimada*, según el plazo (3, 6 o 12 meses) y el producto que elijas (*Conservador, Intermedio o Avanzado*)."
                }
            },
            {
                id: 'node_b3_seguridad',
                name: 'B3: Seguridad e IA Profunda (5% al 15%)',
                type: 'message',
                position: { x: 1060, y: 200 },
                data: {
                    message: "Protegemos tu operatoria con 4 pilares de seguridad y trazabilidad:\n\n1. *100% No Custodial (Tu propio CVU):* Operás desde tu propio CVU con soporte de *Banco BIND y Banco Coinag*. Colaboratium nunca toca tu dinero; fluye directo de tu CVU al tomador.\n2. *Agente de IA de Evaluación Profunda (Aprueba solo del 5% al 15%):* Valida biometría facial *Renaper (prueba de vida), Central de Deudores BCRA, Veraz, Nosis y UIF/Worldsys*, e investiga *relaciones contractuales de cónyuge, trabajo formal inscripto, antigüedad laboral e informes de ARCA/AFIP*. Descarta del 85% al 95% y aprueba únicamente al *5%–15% de mejor calificación*.\n3. *Atomización en 20+ Préstamos y 3 Productos:* Tu capital se fracciona en 20 o más microcréditos distintos dentro de 3 opciones: *Conservador* (100% automático), *Intermedio* (asistido por IA) y *Avanzado* (selección por legajo).\n4. *Cobranza Automatizada + Legales:* Débito directo con avisos preventivos por bot (24 hs antes, a las 48 hs, 96 hs y cada 72 hs) y gestión con estudios jurídicos partners."
                }
            },
            {
                id: 'node_b4_captura',
                name: 'B4: Registro y Envío de Guía de Acceso',
                type: 'identity',
                position: { x: 1400, y: 200 },
                data: {
                    question: "Para enviarte a tu correo la *Guía Oficial de Ingreso, Login y Operatoria* y habilitar tu cuenta en la plataforma, por favor indícame tu *Nombre completo*, *Correo electrónico* y el monto estimado que te interesa colocar:",
                    variable_name: "datos_registro_inversor"
                }
            },
            {
                id: 'node_rag_inversores',
                name: 'B5: Asistente Senior Inversores',
                type: 'rag',
                position: { x: 1740, y: 200 },
                data: {
                    prompt: "Eres el Asistente Senior de Inversores de Colaboratium (Global Loan S.A. - Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Marco normativo BCRA estricto: NUNCA prometas tasas fijas ni rendimientos garantizados. Explica el modelo P2P, la tasa variable de mercado (~75% a 105% TNA estimada vs 16%-24% de plazo fijo), los límites ($100.000 a $10.000.000 sin papeles extra), el simulador online (https://colaboratium.com.ar/inversiones.php#simulador) y los 4 pilares: No Custodial (CVU propio en BIND/Coinag), Agente de IA que aprueba solo del 5% al 15%, atomización en 20+ préstamos y cobranza por bot. Cero costo para el inversor."
                }
            },
            {
                id: 'node_approval_inversor',
                name: 'Derivación Oficial Inversores',
                type: 'approval',
                position: { x: 2080, y: 200 },
                data: {}
            }
        ]
    };

    // ==========================================================
    // FLUJO 4: LÍDERES DE EQUIPOS (FLUJO C)
    // ==========================================================
    const flowCData = {
        name: 'Flujo C: Líderes de Equipos',
        edges: [
            { id: 'ec-1', source: 'node_trigger', target: 'node_c1_esquema' },
            { id: 'ec-2', source: 'node_c1_esquema', target: 'node_c2_responsabilidad' },
            { id: 'ec-3', source: 'node_c2_responsabilidad', target: 'node_c3_captura' },
            { id: 'ec-4', source: 'node_c3_captura', target: 'node_rag_lideres' },
            { id: 'ec-5', source: 'node_rag_lideres', target: 'node_approval_lider' }
        ],
        nodes: [
            {
                id: 'node_trigger',
                name: 'Inicio Líderes',
                type: 'webhook',
                position: { x: 50, y: 200 },
                data: {}
            },
            {
                id: 'node_c1_esquema',
                name: 'C1: Activación VIP y Esquema Triple de Ingresos',
                type: 'message',
                position: { x: 380, y: 200 },
                data: {
                    message: "¡Excelente! Si contás con un equipo de vendedores, en *Colaboratium* (Global Loan S.A. - Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) tenemos un rol jerárquico de *Líder de Equipo* con oficina comercial de respaldo en *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López*.\n\n*Como Líder contás con un Esquema Triple de Ingresos:*\n1. *10% de la Bolsa Total de Comisiones de tu Equipo (Overriding):* Cobrás un *10% adicional* sobre la totalidad de las comisiones que generen todos los asesores debajo de tu nodo en el Organigrama.\n2. *100% de Comisión en Clientes Propios / Precargados (Caso Carlos Gómez):* En inversores traídos por tu red (cartera propia o pauta con link UTM), se liquida el 100% de la escala oficial desde el primer calce (*4% a 3m, 5% a 6m y 6% a 12m*, con *3% inmediato al calce* y el resto en cuotas + reinversiones).\n3. *Leads Enviados por el Marketing de Colaboratium (Caso Juan Ramírez):* Cuando Colaboratium capta un inversor por publicidad propia (ej. $100.000), solo el 3% del primer calce queda en Colaboratium. Luego el inversor se te asigna a vos: cobrás *todas las cuotas residuales del primer préstamo y el 100% de la comisión plena (3% inmediato + residual) en todas sus reinversiones futuras*."
                }
            },
            {
                id: 'node_c2_responsabilidad',
                name: 'C2: Herramientas de Consola y Protección del 10%',
                type: 'message',
                position: { x: 720, y: 200 },
                data: {
                    message: "*Herramientas de Consola y Protección de tu Bolsa del 10%:*\n\n• En `consola.colaboratium.com.ar` vas a tener tu panel de Líder donde podés dar de alta vendedores (`Comercial > Crear Vendedor`), emitir links UTM y monitorear el *Ranking Gráfico de Desempeño en tiempo real* (tanto por cantidad de leads captados vs. activos como por volumen de cartera fondeada en ARS con el Top 3 de tu equipo).\n• *Ventaja comercial y protección de tu bolsa del 10%:*\n  - Tus vendedores tienen el mejor argumento del mercado: *al inversor jamás se le cobra comisión* (paga todo el tomador) y nunca sale de su propio CVU.\n  - Tu función como Líder es cuidar que tu equipo cumpla el Decálogo de Transparencia del BCRA (no prometer tasas fijas ni tocar dinero de clientes). Y nuestro sistema protege tu trabajo: *si tenés 10 asesores y 1 comete una infracción, jamás perdés el 10% de todo tu equipo*; la sanción aplica solo sobre el asesor infractor (y si vos mismo reportás o corregís un desvío a tiempo, tenés *0% de quita* sobre tu bolsa)."
                }
            },
            {
                id: 'node_c3_captura',
                name: 'C3: Cierre y Elección de Webinar para Líderes',
                type: 'identity',
                position: { x: 1060, y: 200 },
                data: {
                    question: "👑 *AGENDA Y PRÓXIMAS FECHAS DE WEBINAR PARA LÍDERES EN EL CALENDARIO*\n\nPara avanzar, podés sumarte al Webinar Virtual para Líderes (Google Meet) o coordinar una Reunión Ejecutiva presencial en nuestras oficinas de *Av. del Libertador 264, Vicente López*.\n👉 ¿Cuántos asesores integran hoy tu equipo? Por favor indícame la cantidad, tu *Nombre completo*, *Correo electrónico* y la opción de horario del calendario que prefieras:",
                    variable_name: "datos_red_lider"
                }
            },
            {
                id: 'node_rag_lideres',
                name: 'C4: Asistente Senior Líderes',
                type: 'rag',
                position: { x: 1400, y: 200 },
                data: {
                    prompt: "Eres el Asistente Senior para Líderes de Equipos Comerciales de Colaboratium (Global Loan S.A. - Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica el rol de Líder: 10% overriding sobre la bolsa total de su equipo, 100% comisión en clientes propios (Caso Carlos Gómez), y comisiones en leads de Colaboratium (Caso Juan Ramírez). Destaca las herramientas de consola: panel jerárquico, ranking gráfico y protección del 10% del líder (las sanciones son individuales sobre el asesor infractor y 0% de quita si el líder reporta desvíos). Invita al Webinar de Líderes del calendario o a la reunión ejecutiva en Av. del Libertador 264, Vicente López. Respeta todos los guardarraíles."
                }
            },
            {
                id: 'node_approval_lider',
                name: 'Derivación Dirección Comercial',
                type: 'approval',
                position: { x: 1740, y: 200 },
                data: {}
            }
        ]
    };

    // 4. ACTUALIZAR EN BASE DE DATOS
    const [existingFlows] = await db.pool.query('SELECT id, nombre FROM flujos WHERE codigo_empresa = ? ORDER BY id ASC', [codigo]);

    const triggersMap = {
        bienvenida: 'hola, buenas, buen dia, buen día, buenos dias, buenos días, buenas tardes, buenas noches, que tal, saludos, inicio, empezar, menu, opciones, con quien hablo, comenzar, volver, info, informacion',
        asesores: '2, asesor, asesores, comercial, quiero ser asesor, quiero trabajar con uds, quiero trabajar con ustedes, propuesta, comisiones, meta ads, btn_asesor',
        inversores: '1, invertir, inversor, inversores, inversion, tasas, rendimientos, ganancia, quiero invertir, quiero invertir en la plataforma, cuanto rinde, simulador, plazo fijo, btn_inversor',
        lideres: '3, lider, lideres, equipo, ser lider, tengo equipo, tengo mi equipo de trabajo, broker, red comercial, inmobiliaria, call center, vendedores, btn_lider'
    };

    if (existingFlows.length >= 4) {
        // Actualizar por IDs existentes
        await db.actualizarFlujo(existingFlows[0].id, codigo, flow1Data, true, triggersMap.bienvenida);
        console.log(`✅ Flujo 1 (Bienvenida - ID ${existingFlows[0].id}) actualizado.`);

        await db.actualizarFlujo(existingFlows[1].id, codigo, flowAData, true, triggersMap.asesores);
        console.log(`✅ Flujo 2 (Asesores - ID ${existingFlows[1].id}) actualizado.`);

        await db.actualizarFlujo(existingFlows[2].id, codigo, flowBData, true, triggersMap.inversores);
        console.log(`✅ Flujo 3 (Inversores - ID ${existingFlows[2].id}) actualizado.`);

        await db.actualizarFlujo(existingFlows[3].id, codigo, flowCData, true, triggersMap.lideres);
        console.log(`✅ Flujo 4 (Líderes - ID ${existingFlows[3].id}) actualizado.`);
    } else {
        // Si no existen 4, recrearlos
        await db.pool.query('DELETE FROM flujos WHERE codigo_empresa = ?', [codigo]);
        const id1 = await db.crearFlujo(codigo, flow1Data.name, triggersMap.bienvenida, flow1Data);
        const id2 = await db.crearFlujo(codigo, flowAData.name, triggersMap.asesores, flowAData);
        const id3 = await db.crearFlujo(codigo, flowBData.name, triggersMap.inversores, flowBData);
        const id4 = await db.crearFlujo(codigo, flowCData.name, triggersMap.lideres, flowCData);
        console.log(`✅ 4 Flujos V3 creados con IDs: ${id1}, ${id2}, ${id3}, ${id4}`);
    }

    // Resetear estados activos de prueba en contactos
    await db.pool.query('UPDATE contactos SET flujo_activo_id = NULL, nodo_actual_id = NULL WHERE codigo_empresa = ?', [codigo]);
    console.log('✅ Contactos reseteados listos para los nuevos flujos.');

    console.log('================================================================');
    console.log('🎉 TODOS LOS FLUJOS V3 FUERON APLICADOS CON ÉXITO');
    console.log('================================================================');
    process.exit(0);
}

applyRAGv3Flows().catch(err => {
    console.error('❌ Error aplicando flujos V3:', err);
    process.exit(1);
});
