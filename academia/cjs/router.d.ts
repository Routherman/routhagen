import { type Request, type Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { type Enunciado } from './enunciados';
import { type Alcance, type UsuarioAcademia } from './logica/permisos';
import { type PersonaTablero } from './logica/tablero';
import { type ConfigVideo } from './logica/video';
export interface OpcionesAcademia {
    /** Pool de mysql2/promise. */
    db: Pool;
    /** Cliente de ioredis o node-redis (o un AlmacenRapido propio). Opcional. */
    redis?: unknown;
    /**
     * EL ADAPTADOR DE LOGIN. Lo implementa el sistema que monta el módulo:
     * a partir del request (su JWT, su sesión, su req.user) devuelve quién es.
     * null = no autenticado (401).
     */
    obtenerUsuario: (req: Request) => Promise<UsuarioAcademia | null> | UsuarioAcademia | null;
    /**
     * Opcional: de qué equipos es líder. Si no se pasa, se usa `usuario.liderDe`
     * y, si tampoco viene, la tabla academia_equipos.
     */
    equiposQueLidera?: (u: UsuarioAcademia) => Promise<string[]>;
    /**
     * Opcional: las personas que abarca un alcance, desde la tabla de usuarios
     * del sistema. Si no se pasa, se leen de academia_personas.
     */
    listarPersonas?: (alcance: Alcance, u: UsuarioAcademia) => Promise<PersonaTablero[]>;
    video?: ConfigVideo;
    /** Los ejercicios reales. Default: los dos de ejemplo. */
    enunciados?: Enunciado[];
    minExplicacion?: number;
    /** Para registrar errores. Default: console.error. */
    registrar?: (mensaje: string, error?: unknown) => void;
    /** Reloj inyectable (tests). */
    ahora?: () => number;
}
export type RouterAcademia = Router & {
    /** Llamar después de editar el catálogo a mano, para no esperar los 60 s del cache. */
    invalidarCatalogo: () => Promise<void>;
};
export declare function academiaRouter(op: OpcionesAcademia): RouterAcademia;
/**
 * Llamar cuando se BORRA un trabajo que estaba enganchado a una práctica.
 * La entrega vuelve a 'pendiente' (ya no hay qué corregir) pero conserva la
 * devolución: lo que el corrector escribió sigue sirviendo.
 */
export declare function trabajoDePracticaBorrado(db: Pool, trabajoRef: string): Promise<number>;
