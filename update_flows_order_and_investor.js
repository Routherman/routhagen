const db = require('./database');

async function updateFlows() {
  await db.initDB();
  const codigoEmpresa = 'KRZMJI';

  console.log('🔄 Actualizando flujos para Colaboratium con el nuevo orden y propuesta de Inversor...');

  // ==========================================================
  // 1. FLUJO 7: BIENVENIDA Y MENÚ MAESTRO
  // ==========================================================
  const flujo7Data = {
    name: "Bienvenida y Menú Maestro Colaboratium",
    edges: [
      { id: "e0-1", source: "node_trigger", target: "node_msg_bienvenida" },
      { id: "e0-2", source: "node_msg_bienvenida", target: "node_msg_opciones" },
      { id: "e0-3", source: "node_msg_opciones", target: "node_id_seleccion" },
      { id: "e0-4", source: "node_id_seleccion", target: "node_rag_router" }
    ],
    nodes: [
      {
        id: "node_trigger",
        name: "Punto de Inicio (Saludos / Campaña)",
        type: "webhook",
        position: { x: 50, y: 200 },
        data: {}
      },
      {
        id: "node_msg_bienvenida",
        name: "Presentación Oficial Colaboratium",
        type: "message",
        position: { x: 380, y: 200 },
        data: {
          message: "Hola, ¿cómo estás? Te escribimos de *Colaboratium* (Global Loan S.A.), la primera plataforma de créditos entre particulares (P2P) registrada ante el BCRA bajo el *Nº 40.015* (verificable en: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/).\n\nConectamos inversores con créditos calificados por IA en una operatoria 100% bancarizada y No Custodial (Banco BIND y Banco Coinag), donde al inversor *JAMÁS se le cobra ninguna comisión ni gasto* (todo costo lo abona el tomador)."
        }
      },
      {
        id: "node_msg_opciones",
        name: "Opciones de Interacción",
        type: "message",
        position: { x: 720, y: 200 },
        data: {
          message: "¿Con qué opción te gustaría avanzar? Escribe el número o palabra clave:\n\n1️⃣ Escribe *1* o *inversor*: Quiero Invertir en la Plataforma (desde $100.000 hasta $10.000.000 sin papeles extra, scoring IA y atomización en 20+ préstamos).\n2️⃣ Escribe *2* o *asesor*: Quiero Trabajar con Ustedes (capacitación oficial, herramientas digitales avanzadas y respaldo comercial en Vicente López).\n3️⃣ Escribe *3* o *lider*: Tengo mi Equipo de Trabajo y me interesa saber su propuesta (acceso jerárquico a consola y 10% adicional sobre comisiones de red).\n\n👉 También puedes seleccionar tu opción directamente en el menú en pantalla o consultarme cualquier duda."
        }
      },
      {
        id: "node_id_seleccion",
        name: "Captura de Opción",
        type: "identity",
        position: { x: 1060, y: 200 },
        data: {
          question: "¿Qué perfil deseas explorar? Escribe 1 (Inversor), 2 (Asesor) o 3 (Líder):",
          variable_name: "opcion_seleccionada"
        }
      },
      {
        id: "node_rag_router",
        name: "Orientador Virtual",
        type: "rag",
        position: { x: 1400, y: 200 },
        data: {
          prompt: "Eres el Orientador Virtual de Colaboratium. Explica brevemente el modelo de Colaboratium e invita al usuario a responder 1 para invertir, 2 para asesor o 3 para líder. Respeta todos los guardarraíles: link BCRA 40.015 obligatorio y cero costo al inversor."
        }
      }
    ]
  };

  await db.actualizarFlujo(
    7,
    codigoEmpresa,
    flujo7Data,
    true,
    'hola, buenas, buen dia, buen día, buenos dias, buenos días, buenas tardes, buenas noches, que tal, saludos, inicio, empezar, menu, opciones, con quien hablo, comenzar, volver'
  );
  console.log('✅ Flujo 7 (Bienvenida) actualizado.');

  // ==========================================================
  // 2. FLUJO 8: ASESORES COMERCIALES (SIN COMISIONES EXPLÍCITAS EN INTRO)
  // ==========================================================
  const flujo8Data = {
    name: "Flujo A: Asesores Comerciales",
    edges: [
      { id: "ea-1", source: "node_trigger", target: "node_a1_propuesta" },
      { id: "ea-2", source: "node_a1_propuesta", target: "node_a2_leads" },
      { id: "ea-3", source: "node_a2_leads", target: "node_a3_captura" },
      { id: "ea-4", source: "node_a3_captura", target: "node_rag_asesores" },
      { id: "ea-5", source: "node_rag_asesores", target: "node_approval_asesor" }
    ],
    nodes: [
      {
        id: "node_trigger",
        name: "Inicio Asesores",
        type: "webhook",
        position: { x: 50, y: 200 },
        data: {}
      },
      {
        id: "node_a1_propuesta",
        name: "A1: Propuesta Asesor Comercial",
        type: "message",
        position: { x: 380, y: 200 },
        data: {
          message: "¡Excelente! Como *Asesor Comercial de Colaboratium* vas a comercializar la primera plataforma P2P registrada ante el BCRA bajo el *Nº 40.015* (https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) con soporte de *Banco BIND y Banco Coinag*.\n\n*Ventaja clave para tus clientes:* Al inversor *JAMÁS se le cobra ningún concepto ni comisión* (el uso de la plataforma y los gastos los paga exclusivamente el tomador del crédito), y el inversor opera 100% bancarizado desde su propio CVU.\n\nContarás con capacitación continua, herramientas digitales avanzadas, ingresos recurrentes y el respaldo de nuestras oficinas comerciales en Vicente López."
        }
      },
      {
        id: "node_a2_leads",
        name: "A2: Regla de Atribución de Clientes",
        type: "message",
        position: { x: 720, y: 200 },
        data: {
          message: "*¿Cómo funciona la asignación de tus clientes en Colaboratium?*\n\n1. *Clientes propios o referidos por vos:* Tu cartera permanece 100% asignada a tu usuario, asegurándote la liquidación de cada colocación y todas las reinversiones futuras de manera automática.\n2. *Leads provistos por Colaboratium:* Cuando un cliente ingresa por nuestras campañas de marketing institucional, te es asignado para el acompañamiento y seguimiento comercial continuo."
        }
      },
      {
        id: "node_a3_captura",
        name: "A3: Registro y Contacto",
        type: "identity",
        position: { x: 1060, y: 200 },
        data: {
          question: "¿Te gustaría sumarte al próximo *Webinar de Capacitación (40 min)* o visitarnos en nuestras oficinas comerciales de *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López*? Por favor, déjame tu *Nombre completo* y *Correo electrónico*:",
          variable_name: "datos_contacto_asesor"
        }
      },
      {
        id: "node_rag_asesores",
        name: "A4: Asistente IA Asesores",
        type: "rag",
        position: { x: 1400, y: 200 },
        data: {
          prompt: "Eres el asistente de reclutamiento de Asesores Comerciales de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica el rol del asesor, las herramientas digitales, la capacitación continua y que al inversor jamás se le cobra comisión. Invita al Webinar de Capacitación o a las oficinas comerciales de Vicente López."
        }
      },
      {
        id: "node_approval_asesor",
        name: "Derivación a Asesor Humano",
        type: "approval",
        position: { x: 1740, y: 200 },
        data: {}
      }
    ]
  };

  await db.actualizarFlujo(
    8,
    codigoEmpresa,
    flujo8Data,
    true,
    '2, asesor, asesores, comercial, quiero ser asesor, quiero trabajar con uds, quiero trabajar con ustedes, btn_asesor'
  );
  console.log('✅ Flujo 8 (Asesores) actualizado sin comisiones en intro.');

  // ==========================================================
  // 3. FLUJO 9: INVERSORES DE CAPITAL (CON MONTOS Y SIMULADOR)
  // ==========================================================
  const flujo9Data = {
    name: "Flujo B: Inversores de Capital",
    edges: [
      { id: "eb-1", source: "node_trigger", target: "node_b1_tasas" },
      { id: "eb-2", source: "node_b1_tasas", target: "node_b2_transparencia" },
      { id: "eb-3", source: "node_b2_transparencia", target: "node_b3_seguridad" },
      { id: "eb-4", source: "node_b3_seguridad", target: "node_b4_captura" },
      { id: "eb-5", source: "node_b4_captura", target: "node_rag_inversores" },
      { id: "eb-6", source: "node_rag_inversores", target: "node_approval_inversor" }
    ],
    nodes: [
      {
        id: "node_trigger",
        name: "Inicio Inversores",
        type: "webhook",
        position: { x: 50, y: 200 },
        data: {}
      },
      {
        id: "node_b1_tasas",
        name: "B1: Modelo de Inversión y Simulador",
        type: "message",
        position: { x: 380, y: 200 },
        data: {
          message: "¡Excelente decisión! En *Colaboratium* (Global Loan S.A. - Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/) conectás tu capital directamente con créditos calificados por IA en una operatoria 100% bancarizada y No Custodial (Banco BIND y Banco Coinag).\n\n💰 *Límites de Inversión Simplificados:*\n• *Monto mínimo:* *$100.000 ARS*\n• *Monto máximo sin presentar documentación extra:* *$10.000.000 ARS*\n\n📊 *Simulador Online:* Podés calcular tus rendimientos estimados según el plazo aquí:\n👉 https://colaboratium.com.ar/inversiones.php#simulador\n\n*Punto clave:* Al inversor *JAMÁS se le cobra comisión ni gasto alguno* (todo costo lo abona el tomador del préstamo)."
        }
      },
      {
        id: "node_b2_transparencia",
        name: "B2: Transparencia BCRA y Rendimientos",
        type: "message",
        position: { x: 720, y: 200 },
        data: {
          message: "Siguiendo el marco normativo de transparencia del *BCRA*, en Colaboratium *no prometemos tasas fijas ni rendimientos garantizados*, ya que somos un Marketplace P2P.\n\n*¿Cuánto está rindiendo hoy?*\nLas tasas son variables y el sistema las toma automáticamente del mercado:\n• El sector bancario opera en torno al *60% - 90% TNA*, y las fintech de créditos entre *90% - 150% TNA*.\n• En Colaboratium accedés a un rendimiento promedio competitivo (*aprox. 75% a 105% TNA estimada*), visible en tiempo real en la plataforma según el plazo (3, 6 o 12 meses) y el perfil (*Conservador, Intermedio o Avanzado*)."
        }
      },
      {
        id: "node_b3_seguridad",
        name: "B3: Seguridad e IA (5% al 15%)",
        type: "message",
        position: { x: 1060, y: 200 },
        data: {
          message: "Tu capital está protegido por 4 pilares fundamentales:\n1. *No Custodial:* Operás desde tu propio CVU bancarizado (BIND / Coinag). Colaboratium nunca toca tu dinero.\n2. *Filtro Profundo de IA:* Se analizan ingresos, relación contractual, AFIP/ARCA, Nosis y Veraz; *se aprueba solo el mejor 5% al 15% de solicitudes*.\n3. *Atomización del Riesgo:* Tu inversión se divide en 20 o más micropréstamos.\n4. *Cobranza Preventiva:* Débito automático y seguimiento preventivo."
        }
      },
      {
        id: "node_b4_captura",
        name: "B4: Registro y Envío de Guía de Acceso",
        type: "identity",
        position: { x: 1400, y: 200 },
        data: {
          question: "Para enviarte a tu correo la *Guía de Ingreso, Login y Operatoria* y habilitar tu cuenta en la plataforma, por favor indícame tu *Nombre completo*, *Correo electrónico* y el monto estimado que te interesa colocar:",
          variable_name: "datos_registro_inversor"
        }
      },
      {
        id: "node_rag_inversores",
        name: "B5: Asistente Senior Inversores",
        type: "rag",
        position: { x: 1740, y: 200 },
        data: {
          prompt: "Eres el asistente de atención a Inversores de Colaboratium (Global Loan S.A., Registro BCRA Nº 40.015: https://www.bcra.gob.ar/registro-de-proveedores-de-servicios-de-creditos-entre-particulares-a-traves-de-plataformas/). Explica montos (mínimo $100.000 y máximo $10.000.000 sin papeles extra), comparte el simulador https://colaboratium.com.ar/inversiones.php#simulador y reitera que al inversor jamás se le cobra comisión. Invita a recibir la guía de ingreso por correo y a solicitar la asignación de un Asesor Financiero personalizado."
        }
      },
      {
        id: "node_approval_inversor",
        name: "Derivación Oficial Inversores",
        type: "approval",
        position: { x: 2080, y: 200 },
        data: {}
      }
    ]
  };

  await db.actualizarFlujo(
    9,
    codigoEmpresa,
    flujo9Data,
    true,
    '1, invertir, inversor, inversores, inversion, tasas, rendimientos, ganancia, quiero invertir, quiero invertir en la plataforma, btn_inversor'
  );
  console.log('✅ Flujo 9 (Inversores) actualizado con montos y simulador.');

  // ==========================================================
  // 4. FLUJO 10: LÍDERES (TRIGGER KEYWORDS)
  // ==========================================================
  const [f10Rows] = await db.pool.query('SELECT data_json FROM flujos WHERE id = 10');
  await db.actualizarFlujo(
    10,
    codigoEmpresa,
    f10Rows[0].data_json,
    true,
    '3, lider, lideres, equipo, ser lider, tengo equipo, tengo mi equipo de trabajo, btn_lider'
  );
  console.log('✅ Flujo 10 (Líderes) actualizado con trigger 3.');

  console.log('✨ Todos los flujos han sido sincronizados exitosamente.');
  process.exit(0);
}

updateFlows().catch(err => {
  console.error('❌ Error actualizando flujos:', err);
  process.exit(1);
});
