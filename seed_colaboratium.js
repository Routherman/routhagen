const db = require('./database');

async function seed() {
    await db.initDB();
    const codigo = 'KRZMJI';

    console.log('--- Iniciando carga de Colaboratium en base de datos ---');

    // 1. Datos corporativos de Colaboratium
    await db.pool.query(
        `UPDATE empresas 
         SET nombre = ?, direccion = ?, email = ?
         WHERE codigo = ?`,
        [
            'Colaboratium',
            'Maipú 568 Piso 8, CABA, Argentina',
            'contacto@colaboratium.com',
            codigo
        ]
    );
    console.log('✅ Empresa Colaboratium actualizada con dirección y contacto oficial.');

    // 2. Roles del Sistema
    const rolesToAdd = [
        { nombre: 'Consultores', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Onboarding', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Creditos', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } },
        { nombre: 'Soporte', privilegios: { can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false } }
    ];

    for (const r of rolesToAdd) {
        const [existing] = await db.pool.query('SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = ?', [codigo, r.nombre]);
        if (existing.length === 0) {
            await db.crearRol(codigo, r.nombre, r.privilegios);
            console.log(`✅ Rol creado: ${r.nombre}`);
        } else {
            console.log(`ℹ️ Rol ya existente: ${r.nombre}`);
        }
    }

    // 3. Inteligencia (Prompt del Sistema)
    const promptIa = `Eres el Asistente Virtual Inteligente y Consultor Oficial de COLABORATIUM (GLOBAL LOAN S.A., Maipú 568 Piso 8, CABA, Argentina).

MISIÓN Y VISIÓN:
Colaboratium es la plataforma líder de finanzas colaborativas (P2P lending) en Argentina, 100% digital, transparente y regulada, con operatoria respaldada y aprobada por Banco BIND y Banco COINAG. Tu propósito es asesorar tanto a inversores y consultores financieros como a tomadores de créditos o usuarios que realizan su onboarding digital, brindando respuestas precisas, profesionales, cálidas y confiables basadas estrictamente en la base de conocimiento oficial.

TONO Y DIRECTIVAS GENERALES:
- Tono: Profesional, financiero, empático, claro y pedagógico.
- Sé conciso pero exhaustivo al responder dudas de tasas, comisiones, biometría, procesos de onboarding o seguridad.
- Destaca siempre la propuesta de valor: menores tasas para tomadores de crédito, mayores rendimientos para inversores, reducción del spread financiero tradicional, atomización con IA para minimizar riesgo, y transferencias directas CVU a CVU (Colaboratium no administra ni custodia fondos de terceros).

ÁREAS PRINCIPALES DE ATENCIÓN:
1. Consultores Financieros e Inversiones:
   - Esquemas de comisión: 3 meses (4%: 3% inmediato + 1% prorrateado), 6 meses (5%: 3% inmediato + 2% prorrateado), 12 meses (6%: 3% inmediato + 3% prorrateado). Ingreso recurrente en cada reinversión.
   - Seguridad: IA y atomización de micro-préstamos, scoring de rigor (solo 5% de aprobación), cobranza 360°, avales de Banco BIND y Banco COINAG.
2. Onboarding Digital & KYC (Know Your Customer):
   - Proceso 100% digital en 5 pasos (DNI frente/dorso con validación Renaper, biometría facial y video selfie liveness contra Renaper/Addalia/Amazon, DDJJ y TyC, validaciones de compliance Nosis/UIF/AFIP/Worldsys, y asignación de CVU y legajo digital).
   - Políticas de rechazo (Red Flags): DNI adulterado, discordancia biométrica, listas de terrorismo, listas negras de fraude o titular fallecido.
3. Mercado de Créditos Fintech & Préstamos Colaborativos:
   - Alternativa a las tasas abusivas de fintechs convencionales (TNA 100-140%, CFT 150-300%, subprime hasta 350-400%).
   - Modelo P2P con financiamiento de inversores directos, aprobación del 5% más solvente y crédito 100% digital.

INVITACIÓN A FLUJOS GUIADOS:
Puedes invitar proactivamente al usuario a utilizar los flujos automatizados de la plataforma escribiendo la palabra clave correspondiente:
- "consultor": Para iniciar el flujo guiado de consultores e inversiones.
- "onboarding": Para iniciar el flujo de verificación de identidad y alta digital.
- "prestamo": Para iniciar el flujo de solicitud y simulación de préstamos.

REGLAS CRÍTICAS DE RESPUESTA:
1. Si el usuario solicita hablar con una persona, o si su trámite requiere atención humana especializada (ej. rechazo de DNI/biometría o firma de convenio de consultor), debes incluir la etiqueta [HANDOFF].
2. OBLIGATORIO: Finaliza SIEMPRE tu respuesta con la etiqueta de rol correspondiente:
   - [ROLE:Consultores] si la consulta es sobre inversiones, comisiones o alianzas.
   - [ROLE:Onboarding] si es sobre registro, validación DNI, biometría, Renaper o documentación.
   - [ROLE:Creditos] si es sobre solicitud de crédito, montos, tasas de préstamos o scoring.
   - [ROLE:Soporte] para inconvenientes técnicos o reclamos.
   - [ROLE:General] si es un saludo o no corresponde a una categoría específica.`;

    // 4. Biblioteca (Base de Conocimiento)
    const conocimientoIa = `# BASE DE CONOCIMIENTO OFICIAL - COLABORATIUM (GLOBAL LOAN S.A.)

## 1. IDENTIFICACIÓN INSTITUCIONAL Y LEGAL
- Razón Social: GLOBAL LOAN S.A.
- Nombre Comercial: Colaboratium
- Domicilio Legal y Operativo: Maipú 568 Piso 8, Ciudad Autónoma de Buenos Aires (CABA), República Argentina.
- Entidades Financieras Asociadas y Aprobaciones: Operatoria respaldada y aprobada por Banco BIND (Banco Industrial) y Banco COINAG.
- Modelo de Negocio: Plataforma de Finanzas Colaborativas (P2P Lending) 100% digital, transparente y regulada en Argentina.

---

## 2. PROGRAMA PARA CONSULTORES FINANCIEROS Y SOCIOS ESTRATÉGICOS
- Oportunidad Federal: Convocatoria nacional a consultores y asesores financieros para expandir el ecosistema P2P en todo el país.
- Propuesta de Valor: Ofrecer a clientes e inversores rendimientos superiores al mercado tradicional con seguridad técnica y jurídica en una plataforma 100% digital, transparente y regulada.
- Pilares de Tecnología y Seguridad:
  * IA y Atomización: El capital del inversor se fragmenta y diversifica de manera automática en decenas de micro-préstamos para reducir drásticamente el riesgo de incobrabilidad.
  * Scoring de Rigor: Proceso de selección sumamente exigente donde únicamente el 5% de las solicitudes de crédito son aprobadas bajo estrictos estándares crediticios.
  * Gestión de Cobranza 360°: Recordatorios automáticos vía bots omnicanal y convenios legales exclusivos para garantizar alta tasa de recupero de fondos.
  * Trazabilidad Total CVU a CVU: El flujo de fondos se transfiere directamente de cuenta a cuenta entre Claves Virtuales Uniformes (CVU). Colaboratium no administra ni custodia fondos de terceros.

- Esquema Oficial de Comisiones para Consultores Financieros:
  * Plazo 3 Meses: Comisión Total 4% (Cobro Inmediato por Asignación: 3% | Saldo Prorrateado: 1%)
  * Plazo 6 Meses: Comisión Total 5% (Cobro Inmediato por Asignación: 3% | Saldo Prorrateado: 2%)
  * Plazo 12 Meses: Comisión Total 6% (Cobro Inmediato por Asignación: 3% | Saldo Prorrateado: 3%)
- Modalidad de Cobro y Recurrencia:
  * Ingreso Recurrente: El sistema liquida y devenga en forma automática las mismas comisiones en cada reinversión efectuada por el cliente.
  * Política en caso de mora: El impacto económico es proporcional únicamente al saldo pendiente de comisión devengada.

---

## 3. MANUAL DE ONBOARDING DIGITAL Y POLÍTICAS KYC (KNOW YOUR CUSTOMER)
- Objetivo y Cumplimiento:
  * Identificación fehaciente de usuarios, prevención de fraude de identidad y estricto cumplimiento de normativas de Prevención de Lavado de Activos y Financiación del Terrorismo (PLA/FT) ante la UIF (Unidad de Información Financiera).
- Flujo de Alta Digital en 5 Pasos:
  1. Paso 1 - Captura de Documento e Identidad:
     - El usuario inicia el trámite digital en la plataforma de Colaboratium.
     - Fotografía en alta resolución de frente y dorso del Documento Nacional de Identidad (DNI).
     - Validación sistémica instantánea con el Registro Nacional de las Personas (Renaper).
  2. Paso 2 - Biometría Facial y Prueba de Vida (Liveness):
     - Fotografía selfie de rostro para cotejo morfológico facial con la imagen oficial de Renaper.
     - Grabación de Video Selfie ejecutando un movimiento o gesto específico para validar prueba de vida y descartar fotos estáticas, videos grabados o máscaras sintéticas.
  3. Paso 3 - Declaraciones Juradas y Enriquecimiento de Datos:
     - Registro de domicilio personal, ocupación, actividad económica y datos de contacto.
     - Aceptación digital explícita de Términos y Condiciones (TyC) y Declaraciones Juradas (DDJJ).
  4. Paso 4 - Validaciones en Cascada de Compliance y Riesgo:
     - Validación Nosis: Análisis de historial comercial y crediticio.
     - Validación UIF: Verificación de condición de Sujeto Obligado ante la UIF.
     - Validación AFIP: Constancia de inscripción y verificación de categoría y actividad económica.
     - Validación Worldsys: Cruce preventivo contra bases de Personas Expuestas Políticamente (PEP) y listas internacionales de terrorismo/sanciones.
     - Carga de DDJJ y Matriz de Riesgo final.
  5. Paso 5 - Resolución y Alta:
     - Confirmación inmediata vía Webhook seguro. Notificación de cuenta habilitada y asignación de Billetera Digital con CVU personal.

- Motor de Reglas (Más de 50 variables analizadas):
  * Identidad: documentoExiste, documentoValido, fallecido: false, addaliaPruebaVida: true, addaliaValidacionFacial: true, control morfología sin adulteraciones.
  * Fraude: Chequeo de listas negras de DNI, emails y números telefónicos previos; análisis de riesgo digital (Seon) evaluando scoring de dispositivo, IP, email y teléfono.
  * Cumplimiento PLA/FT: Control Sujeto Obligado UIF, condición PEP pública, listas restrictivas terrorismo (Worldsys), regímenes tributarios internacionales FATCA (EE.UU.) y OCDE.

- Legajo Digital del Cliente:
  * Archivo digital inalterable que reúne: datos biográficos y registrales, DNI y CUIL validados, email y teléfono confirmados por OTP, domicilio personal y comercial, constancia de aceptación de TyC/DDJJ, y número de CVU asignado.

- Políticas de Rechazo Inmediato (Red Flags):
  * DNI falso, adulterado o con inconsistencias morfológicas.
  * Falla en la prueba de vida (liveness) o discordancia en la biometría facial.
  * Coincidencia en listas internacionales de Terrorismo (Worldsys).
  * Presencia del solicitante en listas negras de fraude o bloqueo histórico.
  * Condición de "Fallecido" informada por la base de datos de Renaper.

---

## 4. PANORAMA FINTECH DE PRÉSTAMOS EN ARGENTINA (2025 - 2026)
- Definición de Fintech de Préstamos: Plataformas digitales que otorgan financiamiento y créditos por fuera del sistema bancario tradicional (100% digital, evaluación alternativa sin garantías tradicionales).
- Principales Actores del Mercado: Mercado Crédito, Ualá, Naranja X, Moni, Prestix, Credicuotas, Wenance. En Argentina operan aproximadamente 400 fintechs, de las cuales unas 60 son de lending y 40-50 otorgan préstamos directos a individuos.
- Nivel de Tasas de Interés del Sector Fintech Tradicional:
  * TNA promedio: 100% – 140% (media ~120%).
  * CFT (Costo Financiero Total) promedio: 150% – 300% (media ~220%).
  * Segmento Subprime: 300% – 400% (media ~350%).
  * Causa de las altas tasas: Mayor riesgo de impago, clientes sin historial bancario formal, costos elevados de financiamiento propio de las fintechs y otorgamiento sin garantías prendarias ni hipotecarias.
- Dimensiones del Mercado Argentino:
  * Cartera total activa: ~USD 1.500M – 2.000M (aproximadamente $2,4 billones de pesos ARS).
  * Préstamos mensuales otorgados: ~USD 100M – 140M ($150.000M a $200.000M ARS mensuales, con ~400.000 créditos por mes y ticket promedio de $424.090 ARS).
  * Usuarios activos: Más de 5 millones.
  * Ventana de Oportunidad: El crédito fintech representa solo entre el 2% y 2,2% del total del crédito del sistema financiero argentino (15-20% del crédito personal/consumo no tradicional), lo que deja un inmenso terreno virgen para plataformas colaborativas P2P.

- La Ventaja Competitiva de Colaboratium frente a Bancos y Fintechs:
  * Problema del Mercado: Los bancos tradicionales excluyen a millones por falta de historial; las fintechs tradicionales aplican costos asfixiantes superiores al 200%-300%; y los inversores no encuentran instrumentos de renta accesibles y rentables.
  * Solución Colaboratium: Conecta directamente a inversores con tomadores de crédito calificados (scoring riguroso del 5%).
  * Beneficios Clave:
    1. Menores tasas de interés para el tomador del préstamo.
    2. Mayor rentabilidad neta para el inversor.
    3. Reducción sustancial del spread financiero de intermediación bancaria.
    4. Escalabilidad sin riesgo de balance propio (ingresos por fees de originación y administración).
    5. Operaciones directas CVU a CVU con supervisión y aprobación de Banco BIND y Banco COINAG.`;

    await db.actualizarIA(codigo, promptIa, conocimientoIa);
    console.log('✅ Inteligencia (prompt_ia) y Biblioteca (conocimiento_ia) cargadas con éxito en MySQL.');

    // 5. Flujos Conversacionales
    // Limpiamos flujos existentes previos si hubiera para dejar los 3 flujos limpios y sincronizados
    await db.pool.query('DELETE FROM flujos WHERE codigo_empresa = ?', [codigo]);
    console.log('🧹 Limpieza de flujos previos.');

    // FLUJO 1: Consultores Financieros
    const flow1Data = {
        name: 'Programa Consultores Financieros',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Punto de Inicio',
                position: { x: 50, y: 180 },
                data: {}
            },
            {
                id: 'node_msg_intro',
                type: 'message',
                name: 'Propuesta & Bancos BIND y COINAG',
                position: { x: 320, y: 180 },
                data: {
                    message: "¡Hola! Bienvenido al Programa de Consultores Financieros de Colaboratium. 🚀\n\nSomos la plataforma líder en finanzas colaborativas (P2P) en Argentina, con operatoria respaldada y aprobada por Banco BIND y Banco COINAG. Ofrecemos rendimientos superiores para tus clientes e inversores con atomización automatizada por IA y trazabilidad directa CVU a CVU."
                }
            },
            {
                id: 'node_id_perfil',
                type: 'identity',
                name: 'Perfil de Consultor / Inversor',
                position: { x: 620, y: 180 },
                data: {
                    question: "¿Cuentas con cartera activa de inversores/clientes para comercializar el modelo, o te interesa evaluar una inversión a título personal?",
                    variable_name: "tipo_consultor"
                }
            },
            {
                id: 'node_msg_comisiones',
                type: 'message',
                name: 'Esquema de Comisiones Oficial',
                position: { x: 920, y: 180 },
                data: {
                    message: "📊 Esquema de Comisiones para Consultores:\n\n• 3 Meses: 4% Total (3% cobro inmediato por asignación + 1% prorrateado)\n• 6 Meses: 5% Total (3% inmediato + 2% prorrateado)\n• 12 Meses: 6% Total (3% inmediato + 3% prorrateado)\n\n🔄 Ingreso Recurrente: El sistema devenga automáticamente las mismas comisiones en cada reinversión del cliente. Solo el 5% de las solicitudes son aprobadas bajo scoring estricto y contamos con gestión de cobranza 360°."
                }
            },
            {
                id: 'node_rag_consultores',
                type: 'rag',
                name: 'Asistente Experto en Inversiones',
                position: { x: 1220, y: 180 },
                data: {
                    prompt: "Eres el consultor senior de alianzas de Colaboratium. Responde cualquier duda técnica o financiera sobre las comisiones (3 meses: 4%, 6 meses: 5%, 12 meses: 6%), la aprobación bancaria de Banco BIND y COINAG, la atomización de riesgo mediante micro-préstamos y la cobranza 360. Si el consultor desea firmar convenio o comenzar a operar, indícale que derivarás con un asesor de cuentas."
                }
            },
            {
                id: 'node_approval_consultor',
                type: 'approval',
                name: 'Derivación a Asesor de Cuentas',
                position: { x: 1520, y: 180 },
                data: {}
            }
        ],
        edges: [
            { id: 'e1-2', source: 'node_trigger', target: 'node_msg_intro' },
            { id: 'e2-3', source: 'node_msg_intro', target: 'node_id_perfil' },
            { id: 'e3-4', source: 'node_id_perfil', target: 'node_msg_comisiones' },
            { id: 'e4-5', source: 'node_msg_comisiones', target: 'node_rag_consultores' },
            { id: 'e5-6', source: 'node_rag_consultores', target: 'node_approval_consultor' }
        ]
    };

    const flow1Id = await db.crearFlujo(codigo, 'Programa Consultores Financieros', 'consultor', flow1Data);
    console.log(`✅ Flujo 1 creado con ID ${flow1Id}: Programa Consultores Financieros (Trigger: 'consultor')`);

    // FLUJO 2: Onboarding Digital y KYC
    const flow2Data = {
        name: 'Onboarding Digital y Políticas KYC',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Punto de Inicio',
                position: { x: 50, y: 180 },
                data: {}
            },
            {
                id: 'node_msg_kyc_intro',
                type: 'message',
                name: 'Bienvenida KYC & Normativa PLA/FT',
                position: { x: 320, y: 180 },
                data: {
                    message: "Bienvenido al proceso de Onboarding Digital de Colaboratium (GLOBAL LOAN S.A., Maipú 568 Piso 8, CABA). 🛡️\n\nCumplimos con las políticas KYC y normativas PLA/FT ante la UIF para brindarte una cuenta segura y habilitada para operar en minutos."
                }
            },
            {
                id: 'node_id_dni',
                type: 'identity',
                name: 'Validación DNI Renaper',
                position: { x: 620, y: 180 },
                data: {
                    question: "Para iniciar la validación de ejemplar y vigencia en Renaper, por favor ingresa tu número de DNI (sin puntos ni espacios):",
                    variable_name: "dni_solicitante"
                }
            },
            {
                id: 'node_msg_requisitos',
                type: 'message',
                name: 'Pasos de Verificación y Biometría',
                position: { x: 920, y: 180 },
                data: {
                    message: "📋 Pasos para completar tu alta digital:\n\n1. Foto nítida frente y dorso de tu DNI original.\n2. Biometría Facial: Selfie y prueba de vida en video (Liveness) para cotejo con Renaper.\n3. Validaciones de antecedentes: Nosis, AFIP, UIF y listas restrictivas Worldsys.\n4. Firma de DDJJ y asignación de tu CVU personal para operar."
                }
            },
            {
                id: 'node_rag_kyc',
                type: 'rag',
                name: 'Soporte de Validación KYC',
                position: { x: 1220, y: 180 },
                data: {
                    prompt: "Eres el oficial de soporte de Onboarding Digital y Compliance de Colaboratium. Asiste al usuario resolviendo dudas sobre los requisitos fotográficos del DNI, biometría selfie/video liveness, consultas de AFIP/Nosis/UIF y motivos de rechazo (red flags como DNI adulterado, discordancia biométrica o listas restrictivas). Mantén un tono respetuoso, seguro y claro."
                }
            },
            {
                id: 'node_approval_kyc',
                type: 'approval',
                name: 'Derivación a Oficial de Compliance',
                position: { x: 1520, y: 180 },
                data: {}
            }
        ],
        edges: [
            { id: 'e1-2', source: 'node_trigger', target: 'node_msg_kyc_intro' },
            { id: 'e2-3', source: 'node_msg_kyc_intro', target: 'node_id_dni' },
            { id: 'e3-4', source: 'node_id_dni', target: 'node_msg_requisitos' },
            { id: 'e4-5', source: 'node_msg_requisitos', target: 'node_rag_kyc' },
            { id: 'e5-6', source: 'node_rag_kyc', target: 'node_approval_kyc' }
        ]
    };

    const flow2Id = await db.crearFlujo(codigo, 'Onboarding Digital y Políticas KYC', 'onboarding', flow2Data);
    console.log(`✅ Flujo 2 creado con ID ${flow2Id}: Onboarding Digital y Políticas KYC (Trigger: 'onboarding')`);

    // FLUJO 3: Solicitud y Mercado de Préstamos P2P
    const flow3Data = {
        name: 'Solicitud y Mercado de Préstamos P2P',
        nodes: [
            {
                id: 'node_trigger',
                type: 'webhook',
                name: 'Punto de Inicio',
                position: { x: 50, y: 180 },
                data: {}
            },
            {
                id: 'node_msg_credito_intro',
                type: 'message',
                name: 'Propuesta Disruptiva vs Fintechs',
                position: { x: 320, y: 180 },
                data: {
                    message: "¡Hola! En Colaboratium lideramos la revolución de los préstamos en Argentina. 💡\n\nMientras las fintechs tradicionales aplican costos financieros totales (CFT) superiores al 200% o hasta 350% en subprime, nuestro modelo colaborativo conecta de forma directa a tomadores de crédito con inversores, ofreciéndote tasas justas, transparentes y 100% digitales."
                }
            },
            {
                id: 'node_id_monto',
                type: 'identity',
                name: 'Monto y Plazo Deseado',
                position: { x: 620, y: 180 },
                data: {
                    question: "¿Qué monto aproximado necesitas solicitar y en qué plazo preferirías financiarlo (3, 6 o 12 meses)?",
                    variable_name: "monto_y_plazo"
                }
            },
            {
                id: 'node_msg_scoring',
                type: 'message',
                name: 'Scoring de Rigor & Condiciones',
                position: { x: 920, y: 180 },
                data: {
                    message: "ℹ️ Condiciones de nuestra operatoria:\n\n• Scoring de Rigor: Solo el 5% de las solicitudes más calificadas son aprobadas, garantizando una comunidad solvente.\n• 100% digital, sin avales tradicionales ni demoras presenciales.\n• Desembolso directo en tu cuenta bancaria o CVU.\n• Plazos de 3, 6 y 12 meses con cuotas fijas."
                }
            },
            {
                id: 'node_rag_creditos',
                type: 'rag',
                name: 'Simulador y Asesor Crediticio',
                position: { x: 1220, y: 180 },
                data: {
                    prompt: "Eres el asesor de créditos P2P de Colaboratium. Explica las condiciones de préstamos colaborativos, el beneficio frente a tasas usurarias de hasta 350% de fintechs subprime, los requisitos de aprobación de scoring (5%), y cómo el sistema atomiza los créditos fondeados por inversores directos."
                }
            },
            {
                id: 'node_approval_creditos',
                type: 'approval',
                name: 'Derivación a Oficial de Créditos',
                position: { x: 1520, y: 180 },
                data: {}
            }
        ],
        edges: [
            { id: 'e1-2', source: 'node_trigger', target: 'node_msg_credito_intro' },
            { id: 'e2-3', source: 'node_msg_credito_intro', target: 'node_id_monto' },
            { id: 'e3-4', source: 'node_id_monto', target: 'node_msg_scoring' },
            { id: 'e4-5', source: 'node_msg_scoring', target: 'node_rag_creditos' },
            { id: 'e5-6', source: 'node_rag_creditos', target: 'node_approval_creditos' }
        ]
    };

    const flow3Id = await db.crearFlujo(codigo, 'Solicitud y Mercado de Préstamos P2P', 'prestamo', flow3Data);
    console.log(`✅ Flujo 3 creado con ID ${flow3Id}: Solicitud y Mercado de Préstamos P2P (Trigger: 'prestamo')`);

    console.log('--- Proceso de carga finalizado con éxito ---');
    process.exit(0);
}

seed().catch(err => {
    console.error('❌ Error ejecutando seed:', err);
    process.exit(1);
});
