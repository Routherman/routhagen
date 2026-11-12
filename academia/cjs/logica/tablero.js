"use strict";
// ============================================================================
// El tablero del equipo: una fila por persona.
//
// Muestra las señales JUNTAS y nunca las fusiona en un solo número. Alguien
// con muchas marcadas y ninguna abierta no está mintiendo necesariamente
// (pudo haber visto los cursos antes de que existiera el reproductor), pero es
// una conversación distinta a la de alguien que miró diez horas.
//
// Orden: prácticas → mirado → abiertas → marcadas. De lo más difícil de
// fingir a lo más fácil. Arriba va quien produjo algo y abajo quien no
// arrancó, que es justo lo que se viene a mirar.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.armarTablero = armarTablero;
const tiempo_1 = require("./tiempo");
const practicas_1 = require("./practicas");
function armarTablero(personas, progreso, practicas) {
    const filas = new Map();
    for (const p of personas) {
        filas.set(p.usuarioId, {
            usuarioId: p.usuarioId,
            // Un nombre vacío se muestra así a propósito: si aparece en todas las
            // filas, el nombre se está leyendo de un campo que nadie completa.
            nombre: p.nombre?.trim() || `Sin nombre (${p.usuarioId})`,
            equipoId: p.equipoId,
            mirado: 0,
            completas: 0,
            salteadas: 0,
            abiertas: 0,
            marcadas: 0,
            segundosMarcados: 0,
            aprobadas: 0,
            entregadas: 0,
            rehacer: 0,
            aMedias: 0,
            ultimaVezMs: null,
            sinActividad: true,
            puntosPracticas: 0,
        });
    }
    for (const r of progreso) {
        // Lo que no está en la lista de personas no se muestra: el filtro por
        // equipo ya se hizo al armar `personas`, y esto es la segunda red.
        const f = filas.get(r.usuarioId);
        if (!f)
            continue;
        f.mirado += r.segundosMirados;
        if (r.aperturas > 0)
            f.abiertas += 1;
        if (r.marcada) {
            f.marcadas += 1;
            f.segundosMarcados += r.duracionCatalogoS ?? 0;
        }
        const estado = (0, tiempo_1.clasificarClase)({
            medible: r.medible,
            aperturas: r.aperturas,
            segundosMirados: r.segundosMirados,
            posicionMax: r.posicionMax,
            duracionS: r.duracionS,
        });
        if (estado === 'completa')
            f.completas += 1;
        if (estado === 'salteada')
            f.salteadas += 1;
        if (r.ultimaAperturaMs != null && (f.ultimaVezMs == null || r.ultimaAperturaMs > f.ultimaVezMs)) {
            f.ultimaVezMs = r.ultimaAperturaMs;
        }
    }
    for (const p of practicas) {
        const f = filas.get(p.usuarioId);
        if (!f)
            continue;
        if (p.estado === 'aprobado')
            f.aprobadas += 1;
        else if (p.estado === 'entregado')
            f.entregadas += 1;
        else if (p.estado === 'rehacer')
            f.rehacer += 1;
        // `pendiente` = arrancó y no entregó. Es "a medias", no "sin empezar".
        else
            f.aMedias += 1;
    }
    for (const f of filas.values()) {
        f.puntosPracticas = (0, practicas_1.puntosDePracticas)(f);
        f.sinActividad = f.abiertas === 0 && f.marcadas === 0 && f.mirado === 0 && f.puntosPracticas === 0;
    }
    return [...filas.values()].sort((a, b) => b.puntosPracticas - a.puntosPracticas ||
        b.mirado - a.mirado ||
        b.abiertas - a.abiertas ||
        b.marcadas - a.marcadas ||
        a.nombre.localeCompare(b.nombre, 'es'));
}
