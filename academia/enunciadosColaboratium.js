/**
 * Enunciados reales de prácticas para la Academia Colaboratium / Routh Agent.
 * Mantener los números estables: se referencian en academia_practicas.ejercicio.
 */
const ENUNCIADOS_COLABORATIUM = [
    {
        numero: 1,
        titulo: 'Simulación de Inversión y Alta de Ticket Operativo',
        habilidad: 'Dominar la operatoria no custodial y cargar una gestión completa en Routh Agent',
        pedido: '“Tengo capital disponible para invertir a 6 meses, pero quiero operar directo desde mi cuenta bancaria sin que nadie custodie mi dinero. ¿Cómo se instrumenta y qué respaldo tengo?”',
        incluye: [
            'Explicación de operatoria 100% bancarizada y no custodial (Banco BIND / Coinag)',
            'Criterios de atomización y scoring de riesgo crediticio (Global Loan S.A. - BCRA Nº 40.015)',
            'Ticket de práctica creado en Routh Agent con resumen y datos completos (sin usar % en mensajes de pauta)'
        ],
        explicar: 'Qué parámetros cargaste en el ticket de práctica (monto estimado, plazo y perfil), cómo garantizaste la trazabilidad del cliente y qué argumentos le diste sobre la seguridad de los fondos.',
        requiereTrabajo: true,
        linkHerramienta: '/dashboard/tickets?practica=1&ejercicio=1'
    },
    {
        numero: 2,
        titulo: 'Manejo de Objeciones frente a Competencia Bancaria o Billeteras',
        habilidad: 'Defender la propuesta de valor sin descalificar competidores',
        pedido: '“Ya tengo cuenta en un banco tradicional y en una billetera virtual conocida, ¿por qué debería invertir o asesorar operaciones con Colaboratium?”',
        incluye: [
            'Respuesta respetuosa y consultiva, sin descalificar a otras entidades',
            'Al menos dos diferenciales verificables: costo cero para el inversor y selección por scoring IA',
            'Cierre con invitación concreta al Webinar de Capacitación o reunión en Vicente López'
        ],
        explicar: 'Qué enfoque comercial elegiste para responder la objeción y por qué esos diferenciales generan mayor confianza en un perfil conservador o moderado.',
        requiereTrabajo: false
    },
    {
        numero: 3,
        titulo: 'Atribución de Leads y Clasificación en Agenda CRM',
        habilidad: 'Diferenciar cartera propia vs leads de marketing y registrar seguimiento correcto',
        pedido: '“Un referido mío me preguntó por privado después de ver una publicación general. ¿Cómo lo cargo en Routh Agent y cómo queda su atribución?”',
        incluye: [
            'Distinción clara entre leads propios y leads asignados por marketing',
            'Registro de ficha en Agenda CRM con canal, estado y próximo paso',
            'Política de contacto inicial y derivación a reunión presencial o Meet'
        ],
        explicar: 'Cómo documentaste el origen del contacto en la ficha CRM y qué criterio aplicaste para priorizar el seguimiento sin pisar asignaciones de otros asesores.',
        requiereTrabajo: false,
        linkHerramienta: '/dashboard/crm?practica=1&ejercicio=3'
    },
    {
        numero: 4,
        titulo: 'Roleplay Compliance BCRA Nº 40.015 y Uso de Marca',
        habilidad: 'Responder consultas difíciles cumpliendo estrictamente el Anexo III sin prometer tasas fijas',
        pedido: '“¿Esto funciona como un plazo fijo de Colaboratium con ganancia 100% asegurada? Si quiero, ¿te puedo transferir el efectivo o USDT a tu cuenta personal para que lo cargues vos?”',
        incluye: [
            'Aclaración formal de que Colaboratium (Global Loan S.A. - BCRA Nº 40.015) es una plataforma tecnológica P2P y no un banco ni plazo fijo',
            'Explicación de tasas variables estimadas de mercado y riesgo crediticio mitigado por IA (5%–15% de aprobación) + atomización en 20+ créditos',
            'Rechazo rotundo a recibir dinero/cripto en cuentas personales, explicando la operatoria 100% No Custodial desde CVU propio (BIND / Coinag)'
        ],
        explicar: 'Qué respuesta redactaste palabra por palabra para el prospecto y qué sanciones contractuales de la Carta Oferta evitaste al mantener la comunicación conforme al Manual de Marca.',
        requiereTrabajo: false
    },
    {
        numero: 5,
        titulo: 'Campaña Meta Ads ($5.000 ARS/día + UTM) y Disponibilidad Declarada',
        habilidad: 'Estructurar captación digital conforme a marca y configurar SLA operativos reales',
        pedido: '“Armá tu plan de arranque publicitario individual en Meta Ads con enlace UTM de consola y definí tu ventana horaria de Disponibilidad Declarada para proteger tu Score 360°.”',
        incluye: [
            'Copy de anuncio para Reels/Stories (9:16) o Feed con Disclaimer Legal oficial al pie y sin promesas de rendimiento garantizado',
            'Definición de segmentación (27–65 años Argentina) y referencia obligatoria al enlace UTM generado en consola.colaboratium.com.ar',
            'Horario concreto de Disponibilidad Declarada para responder leads en menos de 5 minutos (+15 pts) y evitar penalizaciones (-10 >1h / -40 >24h)'
        ],
        explicar: 'Cómo alineaste la pauta de $5.000 ARS/día con tus horarios reales de atención para sostener rango Oro o Diamante sin perder leads asignados.',
        requiereTrabajo: false
    },
    {
        numero: 6,
        titulo: 'Gestión de Líderes: Auditoría de Red y Devolución de Prácticas',
        habilidad: 'Supervisar cumplimiento normativo, reactivar asesores y corregir entregas en Academia',
        pedido: '“Un asesor de tu equipo publicó una placa sin Disclaimer BCRA, lleva 16 días sin registrar actividad y entregó una práctica incompleta sin ticket vinculado. ¿Cómo intervenís?”',
        incluye: [
            'Acción inmediata de auditoría de marca (retiro/corrección de pieza y verificación de enlace UTM) vinculada a tu rol de Líder',
            'Plan de reactivación documentado para evitar descuentos en el Score de Líder (-15 pts por inactivos >14 días o -20 pts por demora >4h)',
            'Borrador de devolución constructiva (>=20 caracteres) para marcar la práctica como "Rehacer" en el Tablero de Equipo'
        ],
        explicar: 'Qué métricas del Tablero de Academia revisaste antes de responder al asesor y cómo aseguraste la trazabilidad del acompañamiento.',
        requiereTrabajo: false,
        linkHerramienta: '/dashboard/academia/equipo'
    }
];

module.exports = { ENUNCIADOS_COLABORATIUM };
