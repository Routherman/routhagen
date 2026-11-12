export interface AlmacenRapido {
    get(clave: string): Promise<string | null>;
    setConVencimiento(clave: string, valor: string, segundos: number): Promise<void>;
    incrConVencimiento(clave: string, segundos: number): Promise<number>;
    del(clave: string): Promise<void>;
}
/** Envuelve un cliente de ioredis o de node-redis. */
export declare function adaptarRedis(cliente: unknown): AlmacenRapido | null;
/** Un almacén que nunca falla hacia afuera. */
export declare function almacenSeguro(a: AlmacenRapido | null, alFallar?: (e: unknown) => void): {
    disponible: boolean;
    get: (k: string) => Promise<string | null>;
    set: (k: string, v: string, s: number) => Promise<void | undefined>;
    /** null = no se pudo contar (sin Redis): el llamador decide sin el límite. */
    incr: (k: string, s: number) => Promise<number | null>;
    del: (k: string) => Promise<void | undefined>;
};
export type AlmacenSeguro = ReturnType<typeof almacenSeguro>;
