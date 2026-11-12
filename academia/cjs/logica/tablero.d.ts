import { type EstadoPractica } from './practicas';
export interface PersonaTablero {
    usuarioId: string;
    nombre: string | null;
    equipoId: string | null;
}
export interface ProgresoTablero {
    usuarioId: string;
    claseId: number;
    marcada: boolean;
    aperturas: number;
    segundosMirados: number;
    posicionMax: number;
    /** Ya resuelta con duracionConfiable(). */
    duracionS: number | null;
    /** Duración del catálogo, para sumar "horas marcadas". */
    duracionCatalogoS: number | null;
    medible: boolean;
    ultimaAperturaMs: number | null;
}
export interface PracticaTablero {
    usuarioId: string;
    estado: EstadoPractica;
}
export interface FilaTablero {
    usuarioId: string;
    nombre: string;
    equipoId: string | null;
    /** Segundos de reproducción real. */
    mirado: number;
    completas: number;
    salteadas: number;
    /** Clases distintas abiertas. */
    abiertas: number;
    marcadas: number;
    /** Suma de la duración de las marcadas: "lo que dice haber visto". */
    segundosMarcados: number;
    aprobadas: number;
    entregadas: number;
    rehacer: number;
    aMedias: number;
    /** Última vez que abrió una clase (ms), o null. */
    ultimaVezMs: number | null;
    /** Para atenuar la fila en la vista. */
    sinActividad: boolean;
    puntosPracticas: number;
}
export declare function armarTablero(personas: PersonaTablero[], progreso: ProgresoTablero[], practicas: PracticaTablero[]): FilaTablero[];
