// ============================================================================
// Reglas de las prácticas: qué se puede entregar, qué se puede corregir.
//
// Estados:  pendiente ──► entregado ──► aprobado
//               ▲              │
//               └── rehacer ◄──┘
//
// · La fila NACE cuando la persona arranca (guarda un borrador o engancha el
//   trabajo), no se crean todas vacías: si no, el tablero del corrector se
//   llena de gente que no empezó.
// · `pendiente` es "a medias", no "sin empezar". Confundirlos mostró como
//   inactiva a gente que ya tenía el trabajo hecho.
// · No se manda a rehacer sin una devolución escrita.
// · Rehacer pisa la entrega: importa el trabajo final.
// ============================================================================

export type EstadoPractica = 'pendiente' | 'entregado' | 'aprobado' | 'rehacer'

/** Mínimo de la explicación al entregar. Copiar un resultado no es resolver. */
export const MIN_EXPLICACION = 120
/** Mínimo de la devolución para mandar a rehacer. */
export const MIN_DEVOLUCION = 20

export type ErrorRegla = { ok: false; status: number; error: string }
export type Ok = { ok: true }

/** ¿Se puede editar el borrador en este estado? */
export function puedeEditar(estado: EstadoPractica | null): Ok | ErrorRegla {
  if (estado === 'aprobado') return { ok: false, status: 409, error: 'Esta práctica ya está aprobada.' }
  if (estado === 'entregado') {
    return { ok: false, status: 409, error: 'Ya la entregaste: esperá la corrección para volver a tocarla.' }
  }
  return { ok: true }
}

export function validarEntrega(
  estado: EstadoPractica | null,
  datos: { trabajoRef: string | null; explicacion: string },
  reglas: { requiereTrabajo: boolean; minExplicacion?: number },
): Ok | ErrorRegla {
  const editable = puedeEditar(estado)
  if (!editable.ok) return editable
  if (reglas.requiereTrabajo && !datos.trabajoRef?.trim()) {
    return { ok: false, status: 422, error: 'Falta enganchar el trabajo hecho en el sistema.' }
  }
  const min = reglas.minExplicacion ?? MIN_EXPLICACION
  if (datos.explicacion.trim().length < min) {
    return {
      ok: false,
      status: 422,
      error: `La explicación tiene que tener al menos ${min} caracteres: el porqué es la mitad del ejercicio.`,
    }
  }
  return { ok: true }
}

export function validarCorreccion(
  estado: EstadoPractica | null,
  datos: { resultado: 'aprobado' | 'rehacer'; devolucion: string | null },
): Ok | ErrorRegla {
  if (estado !== 'entregado') {
    return { ok: false, status: 409, error: 'Solo se corrige una práctica entregada.' }
  }
  if (datos.resultado === 'rehacer' && (datos.devolucion ?? '').trim().length < MIN_DEVOLUCION) {
    return {
      ok: false,
      status: 422,
      error: `Para mandar a rehacer escribí qué corregir (al menos ${MIN_DEVOLUCION} caracteres).`,
    }
  }
  return { ok: true }
}

/**
 * Puntos de prácticas para ordenar el tablero: aprobada 3, entregada 2,
 * rehacer y a medias 1. Mirar se puede simular dejando el video correr; un
 * trabajo entregado y corregido, no. Por eso es lo primero que ordena.
 */
export function puntosDePracticas(c: { aprobadas: number; entregadas: number; rehacer: number; aMedias: number }): number {
  return c.aprobadas * 3 + c.entregadas * 2 + c.rehacer + c.aMedias
}
