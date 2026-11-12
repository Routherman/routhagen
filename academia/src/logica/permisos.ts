// ============================================================================
// Quién puede ver y hacer qué.
//
// Se chequea SIEMPRE en el servidor, en cada endpoint. Esconder un botón en
// la vista no es un permiso: cualquiera puede llamar a la API a mano.
//
//   · vendedor — mira, marca y entrega SUS prácticas.
//   · líder    — además ve el tablero SOLO de su equipo y corrige sus prácticas.
//   · admin    — ve a todos y corrige todo.
//
// Nadie corrige su propia práctica, ni siquiera el admin.
// ============================================================================

export type Rol = 'admin' | 'lider' | 'vendedor'

export interface UsuarioAcademia {
  /** El id del usuario en el sistema (lo que sale del login). Se guarda como texto. */
  id: string
  rol: Rol
  /** Nombre para mostrar en el tablero. Si viene, se actualiza solo. */
  nombre?: string | null
  /** El equipo al que pertenece. `undefined` = no tocar lo guardado; `null` = sin equipo. */
  equipoId?: string | null
  /** Los equipos que lidera. Si el login no lo dice, se busca en academia_equipos. */
  liderDe?: string[]
}

/** Qué personas abarca el tablero de alguien. */
export type Alcance = { todos: true } | { todos: false; equipos: string[] }

/**
 * El alcance del tablero. `null` = no tiene tablero (el endpoint responde 404,
 * no 403: a un vendedor ni siquiera se le confirma que la página existe).
 */
export function alcanceDe(u: UsuarioAcademia, equiposQueLidera: string[]): Alcance | null {
  if (u.rol === 'admin') return { todos: true }
  if (u.rol === 'lider') return { todos: false, equipos: [...new Set(equiposQueLidera)] }
  return null
}

/** ¿Esta persona entra en este alcance? */
export function dentroDelAlcance(alcance: Alcance, persona: { equipoId: string | null }): boolean {
  if (alcance.todos) return true
  return persona.equipoId != null && alcance.equipos.includes(persona.equipoId)
}

/**
 * ¿Puede corregir la práctica de esta persona?
 * El admin corrige todo menos lo suyo; el líder, solo a su equipo.
 */
export function puedeCorregir(
  corrector: UsuarioAcademia,
  equiposQueLidera: string[],
  alumno: { usuarioId: string; equipoId: string | null },
): boolean {
  if (corrector.id === alumno.usuarioId) return false
  const alcance = alcanceDe(corrector, equiposQueLidera)
  if (!alcance) return false
  return dentroDelAlcance(alcance, alumno)
}
