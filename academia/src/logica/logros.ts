// ============================================================================
// Logros por porcentaje del curso.
//
// Por PORCENTAJE y no por cantidad de clases: así un curso corto también se
// termina y no queda siempre "a mitad de camino". Pocos hitos, puestos donde
// la gente abandona.
//
// Se calculan sobre las clases MARCADAS: son marcas de avance propio, no una
// verificación (eso lo dice el tiempo mirado). El logro se avisa en el momento
// en que se desbloquea, que es cuando motiva.
// ============================================================================

export interface Logro {
  id: string
  nombre: string
  detalle: string
  /** Qué parte del curso hay que tener marcada, de 0 a 1. */
  desde: number
}

export const LOGROS: Logro[] = [
  { id: 'arranque', nombre: 'Arrancaste', detalle: 'Tu primera clase', desde: 0.001 },
  { id: 'en-camino', nombre: 'En camino', detalle: 'Un cuarto del curso', desde: 0.25 },
  { id: 'mitad', nombre: 'Mitad de camino', detalle: 'La mitad del curso', desde: 0.5 },
  { id: 'ultima-vuelta', nombre: 'Última vuelta', detalle: 'Tres cuartos del curso', desde: 0.75 },
  { id: 'completo', nombre: 'Curso completo', detalle: 'Todas las clases', desde: 1 },
]

const proporcion = (marcadas: number, total: number) => (total > 0 ? marcadas / total : 0)

/** El último logro alcanzado, o null si todavía ninguno. */
export function logroActual(marcadas: number, total: number): Logro | null {
  const p = proporcion(marcadas, total)
  return [...LOGROS].reverse().find((l) => p >= l.desde) ?? null
}

/** El logro que se acaba de desbloquear al pasar de `antes` a `despues` marcadas. */
export function logroNuevo(antes: number, despues: number, total: number): Logro | null {
  const a = proporcion(antes, total)
  const d = proporcion(despues, total)
  // Si una sola marca cruza dos umbrales (curso de 2 clases), se avisa el más alto.
  return [...LOGROS].reverse().find((l) => a < l.desde && d >= l.desde) ?? null
}

/** El próximo logro y cuántas clases faltan. null si ya están todos. */
export function proximoLogro(marcadas: number, total: number): { logro: Logro; faltan: number } | null {
  if (total <= 0) return null
  const p = proporcion(marcadas, total)
  const logro = LOGROS.find((l) => p < l.desde)
  if (!logro) return null
  const necesarias = Math.ceil(logro.desde * total)
  return { logro, faltan: Math.max(1, necesarias - marcadas) }
}
