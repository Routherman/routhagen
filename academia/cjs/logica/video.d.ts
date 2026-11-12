export type Proveedor = 'youtube' | 'bunny' | 'mux' | 'directo' | 'drive';
export declare const PROVEEDORES_MEDIBLES: ReadonlySet<Proveedor>;
export declare const esMedible: (p: Proveedor) => boolean;
/**
 * Lleva lo que se cargó en el catálogo (id o link pegado) al id limpio.
 * Devuelve null si no es válido para ese proveedor.
 */
export declare function normalizarRefVideo(proveedor: Proveedor, entrada: string): string | null;
/**
 * Token de Bunny Stream para el embed:
 *   SHA256_HEX(clave_de_seguridad + video_id + vencimiento_unix)
 * (Bunny → Stream → Librería → Security → Embed view token authentication)
 */
export declare function tokenBunny(claveSeguridad: string, videoId: string, venceUnix: number): string;
/**
 * JWT RS256 de Mux para una URL de reproducción firmada.
 * La clave privada que da Mux viene en base64 (es un PEM codificado).
 * Se firma con node:crypto para no sumar una dependencia por esto.
 */
export declare function tokenMux(opciones: {
    playbackId: string;
    signingKeyId: string;
    privateKeyBase64: string;
    venceUnix: number;
}): string;
export interface ConfigVideo {
    bunny?: {
        libraryId: string;
        /** Clave de "Embed view token authentication". Sin ella, el embed va sin firmar. */
        tokenKey?: string;
    };
    mux?: {
        signingKeyId: string;
        privateKeyBase64: string;
    };
    /** Si se define, los videos `directo` solo pueden salir de estos hosts. */
    hostsDirectos?: string[];
    /** Cuánto vive una URL firmada. Default 4 h: alcanza para una clase larga con pausas. */
    vidaUrlFirmadaS?: number;
}
export type FuenteVideo = {
    proveedor: 'youtube';
    medible: true;
    youtubeId: string;
} | {
    proveedor: 'bunny';
    medible: true;
    embedUrl: string;
} | {
    proveedor: 'mux';
    medible: true;
    src: string;
    esHls: true;
} | {
    proveedor: 'directo';
    medible: true;
    src: string;
    esHls: boolean;
} | {
    proveedor: 'drive';
    medible: false;
    embedUrl: string;
};
export declare class ErrorVideo extends Error {
}
export declare function construirFuente(proveedor: Proveedor, ref: string, config: ConfigVideo, ahoraMs: number): FuenteVideo;
