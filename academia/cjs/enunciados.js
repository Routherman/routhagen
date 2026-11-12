"use strict";
// ============================================================================
// Los enunciados de las prácticas.
//
// Viven acá y no en la base a propósito: es texto que se corrige, se reescribe
// y se discute. Cambiarlo es editar este archivo, no correr una migración.
//
// Estos dos son EJEMPLOS de forma: reemplazalos por los ejercicios reales.
// La regla de oro: cada ejercicio se resuelve en la herramienta REAL del
// sistema, marcada como práctica (para que quede afuera de métricas, rankings
// y avisos), y la entrega guarda un puntero a ese trabajo (`trabajoRef`).
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENUNCIADOS_EJEMPLO = void 0;
exports.ENUNCIADOS_EJEMPLO = [
    {
        numero: 1,
        titulo: 'Ejemplo: carga completa de un caso',
        habilidad: 'Usar la herramienta principal de punta a punta',
        pedido: '“Necesito que me armes una propuesta con estas condiciones y me digas cuál te parece mejor.”',
        incluye: ['Todos los datos obligatorios cargados', 'Dos alternativas comparadas', 'Una recomendación final'],
        explicar: 'Por qué recomendaste esa alternativa y qué otras miraste antes de decidir.',
        requiereTrabajo: true,
        linkHerramienta: '/herramienta/nueva?practica=1&ejercicio=1',
    },
    {
        numero: 2,
        titulo: 'Ejemplo: responder una objeción',
        habilidad: 'Explicar una decisión con argumentos',
        pedido: '“Lo vi más barato en otro lado, ¿por qué debería elegirte?”',
        incluye: ['Una respuesta concreta, sin descalificar a la competencia', 'Al menos dos argumentos verificables'],
        explicar: 'Qué respondiste y por qué elegiste esos argumentos y no otros.',
        requiereTrabajo: false,
    },
];
