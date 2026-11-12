// ============================================================================
// Validación de entrada (zod). Todo lo que llega del navegador pasa por acá
// antes de tocar la base. Los números se aceptan como texto también (algunos
// clientes los mandan así) pero se convierten y se validan: una duración en
// texto sumada sin convertir concatena strings en vez de sumar.
// ============================================================================

import { z } from 'zod'

export const idNumerico = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const usuarioAdaptado = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1).max(64)),
  rol: z.enum(['admin', 'lider', 'vendedor']),
  nombre: z.string().max(200).nullish(),
  equipoId: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .pipe(z.string().min(1).max(64))
    .nullish(),
  liderDe: z.array(z.union([z.string(), z.number()]).transform((v) => String(v))).optional(),
})

export const cuerpoMarca = z.object({ marcada: z.boolean() })

/** El latido. El token es la credencial (ver router: sendBeacon no manda headers). */
export const cuerpoLatido = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  segundos: z.coerce.number().finite().min(0).max(100000),
  posicion: z.coerce.number().finite().min(0).max(10 * 24 * 3600).catch(0),
  // NaN / Infinity / null llegan cuando el video todavía no sabe cuánto dura.
  duracion: z.coerce.number().finite().min(0).max(10 * 24 * 3600).nullish().catch(null),
})

export const cuerpoBorrador = z.object({
  trabajoRef: z.string().trim().max(191).nullish(),
  explicacion: z.string().max(20000).nullish(),
})

export const cuerpoEntrega = z.object({
  trabajoRef: z.string().trim().max(191).nullish(),
  explicacion: z.string().max(20000),
})

export const cuerpoCorreccion = z.object({
  usuarioId: z.string().min(1).max(64),
  ejercicio: idNumerico,
  resultado: z.enum(['aprobado', 'rehacer']),
  devolucion: z.string().max(20000).nullish(),
})

export const claveObligatorio = z.string().regex(/^[a-z0-9_-]{1,64}$/i)
