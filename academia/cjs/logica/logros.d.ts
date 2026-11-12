export interface Logro {
    id: string;
    nombre: string;
    detalle: string;
    /** Qué parte del curso hay que tener marcada, de 0 a 1. */
    desde: number;
}
export declare const LOGROS: Logro[];
/** El último logro alcanzado, o null si todavía ninguno. */
export declare function logroActual(marcadas: number, total: number): Logro | null;
/** El logro que se acaba de desbloquear al pasar de `antes` a `despues` marcadas. */
export declare function logroNuevo(antes: number, despues: number, total: number): Logro | null;
/** El próximo logro y cuántas clases faltan. null si ya están todos. */
export declare function proximoLogro(marcadas: number, total: number): {
    logro: Logro;
    faltan: number;
} | null;
