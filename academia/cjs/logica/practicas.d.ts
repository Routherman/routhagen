export type EstadoPractica = 'pendiente' | 'entregado' | 'aprobado' | 'rehacer';
/** Mínimo de la explicación al entregar. Copiar un resultado no es resolver. */
export declare const MIN_EXPLICACION = 120;
/** Mínimo de la devolución para mandar a rehacer. */
export declare const MIN_DEVOLUCION = 20;
export type ErrorRegla = {
    ok: false;
    status: number;
    error: string;
};
export type Ok = {
    ok: true;
};
/** ¿Se puede editar el borrador en este estado? */
export declare function puedeEditar(estado: EstadoPractica | null): Ok | ErrorRegla;
export declare function validarEntrega(estado: EstadoPractica | null, datos: {
    trabajoRef: string | null;
    explicacion: string;
}, reglas: {
    requiereTrabajo: boolean;
    minExplicacion?: number;
}): Ok | ErrorRegla;
export declare function validarCorreccion(estado: EstadoPractica | null, datos: {
    resultado: 'aprobado' | 'rehacer';
    devolucion: string | null;
}): Ok | ErrorRegla;
/**
 * Puntos de prácticas para ordenar el tablero: aprobada 3, entregada 2,
 * rehacer y a medias 1. Mirar se puede simular dejando el video correr; un
 * trabajo entregado y corregido, no. Por eso es lo primero que ordena.
 */
export declare function puntosDePracticas(c: {
    aprobadas: number;
    entregadas: number;
    rehacer: number;
    aMedias: number;
}): number;
