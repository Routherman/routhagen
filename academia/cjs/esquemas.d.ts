import { z } from 'zod';
export declare const idNumerico: z.ZodCoercedNumber<unknown>;
export declare const usuarioAdaptado: z.ZodObject<{
    id: z.ZodPipe<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>, z.ZodString>;
    rol: z.ZodEnum<{
        admin: "admin";
        lider: "lider";
        vendedor: "vendedor";
    }>;
    nombre: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    equipoId: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>, z.ZodString>>>;
    liderDe: z.ZodOptional<z.ZodArray<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>>>;
}, z.core.$strip>;
export declare const cuerpoMarca: z.ZodObject<{
    marcada: z.ZodBoolean;
}, z.core.$strip>;
/** El latido. El token es la credencial (ver router: sendBeacon no manda headers). */
export declare const cuerpoLatido: z.ZodObject<{
    token: z.ZodString;
    segundos: z.ZodCoercedNumber<unknown>;
    posicion: z.ZodCatch<z.ZodCoercedNumber<unknown>>;
    duracion: z.ZodCatch<z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>>;
}, z.core.$strip>;
export declare const cuerpoBorrador: z.ZodObject<{
    trabajoRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    explicacion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const cuerpoEntrega: z.ZodObject<{
    trabajoRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    explicacion: z.ZodString;
}, z.core.$strip>;
export declare const cuerpoCorreccion: z.ZodObject<{
    usuarioId: z.ZodString;
    ejercicio: z.ZodCoercedNumber<unknown>;
    resultado: z.ZodEnum<{
        aprobado: "aprobado";
        rehacer: "rehacer";
    }>;
    devolucion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const claveObligatorio: z.ZodString;
