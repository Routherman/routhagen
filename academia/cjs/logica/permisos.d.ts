export type Rol = 'admin' | 'lider' | 'vendedor';
export interface UsuarioAcademia {
    /** El id del usuario en el sistema (lo que sale del login). Se guarda como texto. */
    id: string;
    rol: Rol;
    /** Nombre para mostrar en el tablero. Si viene, se actualiza solo. */
    nombre?: string | null;
    /** El equipo al que pertenece. `undefined` = no tocar lo guardado; `null` = sin equipo. */
    equipoId?: string | null;
    /** Los equipos que lidera. Si el login no lo dice, se busca en academia_equipos. */
    liderDe?: string[];
}
/** Qué personas abarca el tablero de alguien. */
export type Alcance = {
    todos: true;
} | {
    todos: false;
    equipos: string[];
};
/**
 * El alcance del tablero. `null` = no tiene tablero (el endpoint responde 404,
 * no 403: a un vendedor ni siquiera se le confirma que la página existe).
 */
export declare function alcanceDe(u: UsuarioAcademia, equiposQueLidera: string[]): Alcance | null;
/** ¿Esta persona entra en este alcance? */
export declare function dentroDelAlcance(alcance: Alcance, persona: {
    equipoId: string | null;
}): boolean;
/**
 * ¿Puede corregir la práctica de esta persona?
 * El admin corrige todo menos lo suyo; el líder, solo a su equipo.
 */
export declare function puedeCorregir(corrector: UsuarioAcademia, equiposQueLidera: string[], alumno: {
    usuarioId: string;
    equipoId: string | null;
}): boolean;
