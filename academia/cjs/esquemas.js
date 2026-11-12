"use strict";
// ============================================================================
// Validación de entrada (zod). Todo lo que llega del navegador pasa por acá
// antes de tocar la base. Los números se aceptan como texto también (algunos
// clientes los mandan así) pero se convierten y se validan: una duración en
// texto sumada sin convertir concatena strings en vez de sumar.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.claveObligatorio = exports.cuerpoCorreccion = exports.cuerpoEntrega = exports.cuerpoBorrador = exports.cuerpoLatido = exports.cuerpoMarca = exports.usuarioAdaptado = exports.idNumerico = void 0;
const zod_1 = require("zod");
exports.idNumerico = zod_1.z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
exports.usuarioAdaptado = zod_1.z.object({
    id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((v) => String(v)).pipe(zod_1.z.string().min(1).max(64)),
    rol: zod_1.z.enum(['admin', 'lider', 'vendedor']),
    nombre: zod_1.z.string().max(200).nullish(),
    equipoId: zod_1.z
        .union([zod_1.z.string(), zod_1.z.number()])
        .transform((v) => String(v))
        .pipe(zod_1.z.string().min(1).max(64))
        .nullish(),
    liderDe: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((v) => String(v))).optional(),
});
exports.cuerpoMarca = zod_1.z.object({ marcada: zod_1.z.boolean() });
/** El latido. El token es la credencial (ver router: sendBeacon no manda headers). */
exports.cuerpoLatido = zod_1.z.object({
    token: zod_1.z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    segundos: zod_1.z.coerce.number().finite().min(0).max(100000),
    posicion: zod_1.z.coerce.number().finite().min(0).max(10 * 24 * 3600).catch(0),
    // NaN / Infinity / null llegan cuando el video todavía no sabe cuánto dura.
    duracion: zod_1.z.coerce.number().finite().min(0).max(10 * 24 * 3600).nullish().catch(null),
});
exports.cuerpoBorrador = zod_1.z.object({
    trabajoRef: zod_1.z.string().trim().max(191).nullish(),
    explicacion: zod_1.z.string().max(20000).nullish(),
});
exports.cuerpoEntrega = zod_1.z.object({
    trabajoRef: zod_1.z.string().trim().max(191).nullish(),
    explicacion: zod_1.z.string().max(20000),
});
exports.cuerpoCorreccion = zod_1.z.object({
    usuarioId: zod_1.z.string().min(1).max(64),
    ejercicio: exports.idNumerico,
    resultado: zod_1.z.enum(['aprobado', 'rehacer']),
    devolucion: zod_1.z.string().max(20000).nullish(),
});
exports.claveObligatorio = zod_1.z.string().regex(/^[a-z0-9_-]{1,64}$/i);
