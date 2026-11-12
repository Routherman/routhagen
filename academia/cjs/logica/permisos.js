"use strict";
// ============================================================================
// Quién puede ver y hacer qué.
//
// Se chequea SIEMPRE en el servidor, en cada endpoint. Esconder un botón en
// la vista no es un permiso: cualquiera puede llamar a la API a mano.
//
//   · vendedor — mira, marca y entrega SUS prácticas.
//   · líder    — además ve el tablero SOLO de su equipo y corrige sus prácticas.
//   · admin    — ve a todos y corrige todo.
//
// Nadie corrige su propia práctica, ni siquiera el admin.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.alcanceDe = alcanceDe;
exports.dentroDelAlcance = dentroDelAlcance;
exports.puedeCorregir = puedeCorregir;
/**
 * El alcance del tablero. `null` = no tiene tablero (el endpoint responde 404,
 * no 403: a un vendedor ni siquiera se le confirma que la página existe).
 */
function alcanceDe(u, equiposQueLidera) {
    if (u.rol === 'admin')
        return { todos: true };
    if (u.rol === 'lider')
        return { todos: false, equipos: [...new Set(equiposQueLidera)] };
    return null;
}
/** ¿Esta persona entra en este alcance? */
function dentroDelAlcance(alcance, persona) {
    if (alcance.todos)
        return true;
    return persona.equipoId != null && alcance.equipos.includes(persona.equipoId);
}
/**
 * ¿Puede corregir la práctica de esta persona?
 * El admin corrige todo menos lo suyo; el líder, solo a su equipo.
 */
function puedeCorregir(corrector, equiposQueLidera, alumno) {
    if (corrector.id === alumno.usuarioId)
        return false;
    const alcance = alcanceDe(corrector, equiposQueLidera);
    if (!alcance)
        return false;
    return dentroDelAlcance(alcance, alumno);
}
