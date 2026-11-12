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
    }
];

module.exports = { ENUNCIADOS_COLABORATIUM };
