/** El reproductor avisa cada 20 s. */
export declare const INTERVALO_LATIDO_S = 20;
/** Lo máximo que suma un latido: el doble del intervalo. */
export declare const TOPE_POR_LATIDO_S = 40;
/** Tolerancia de reloj y redondeo entre navegador y servidor. No se acumula. */
export declare const MARGEN_RELOJ_S = 2;
/** Una sesión de reproducción vive 12 h. Después hay que reabrir la clase. */
export declare const VIDA_SESION_MS: number;
export interface EntradaLatido {
    /** Ahora, en ms (reloj del SERVIDOR, nunca el del navegador). */
    ahoraMs: number;
    /** Último latido aceptado de esta sesión (o cuándo se abrió, si es el primero). */
    ultimoLatidoSesionMs: number;
    /** Hasta dónde ya se le acreditó tiempo a esta persona (0 si nunca). */
    creditoHastaMs: number;
    /** Los segundos que dice el navegador que se reprodujeron. */
    pedidoS: number;
}
export interface ResultadoLatido {
    aceptadosS: number;
    rechazadosS: number;
    /** El nuevo valor de `creditoHasta` para la persona. */
    nuevoCreditoHastaMs: number;
}
/** Convierte cualquier cosa a un entero >= 0. NaN, Infinity, negativos y textos raros dan 0. */
export declare function enteroNoNegativo(v: unknown): number;
/**
 * Cuántos segundos de un latido se aceptan.
 *
 * `desde` es el punto más tardío entre el último latido de la sesión y lo ya
 * acreditado a la persona: el tiempo disponible es lo que pasó desde ahí.
 */
export declare function calcularLatido(e: EntradaLatido): ResultadoLatido;
/** La sesión venció (12 h desde que se abrió la clase). */
export declare function sesionVencida(iniciadaMs: number, ahoraMs: number): boolean;
/**
 * La duración en la que se confía.
 *
 * Primero la del catálogo, cargada por una persona. La que informa el
 * navegador solo se usa si el catálogo no la tiene: un cliente tocado podría
 * decir que un video de media hora dura 10 segundos y "completarlo" al toque.
 */
export declare function duracionConfiable(catalogoS: number | null | undefined, detectadaS: number | null | undefined): number | null;
/**
 * La duración que manda el navegador, limpia. Con HLS, `video.duration` es
 * NaN hasta que carga el manifiesto y a veces Infinity: eso es "no sé", no 0.
 * Devuelve null para que el upsert NO pise una duración ya conocida.
 */
export declare function duracionInformada(v: unknown): number | null;
/**
 * La posición que manda el navegador, acotada a la duración conocida. Sin
 * esto, una posición inventada (999999) marcaría "llegó al final" de cualquier
 * clase cuya duración se conozca después.
 */
export declare function posicionAcotada(v: unknown, duracionS: number | null): number;
/** Llegó al final = la posición máxima pasó el 90 % de la duración. */
export declare const UMBRAL_FINAL = 0.9;
/** Completa = llegó al final Y miró al menos el 80 %. */
export declare const UMBRAL_COMPLETA = 0.8;
/** Salteada = llegó al final mirando MENOS de la mitad. Solo se llega así arrastrando la barra. */
export declare const UMBRAL_SALTEADA = 0.5;
export type EstadoClase = 'no_medible' | 'sin_abrir' | 'en_curso' | 'completa' | 'salteada' | 'sin_duracion';
export interface DatosClase {
    medible: boolean;
    aperturas: number;
    segundosMirados: number;
    posicionMax: number;
    duracionS: number | null;
}
export declare function clasificarClase(d: DatosClase): EstadoClase;
/**
 * Para un video obligatorio: lo reproducido tiene que ser al menos la
 * duración menos 3 s (margen de redondeo del navegador).
 */
export declare const MARGEN_OBLIGATORIO_S = 3;
export declare function obligatorioCumplido(segundosSesion: number, duracionCatalogoS: number): boolean;
/** 4980 → "1,4 h de formación"; 1500 → "25 min de formación". */
export declare function horasDeFormacion(segundos: number): string;
