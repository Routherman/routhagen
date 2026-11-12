// ============================================================================
// Cuánto se miró de verdad.
//
// Todo lo de este archivo es lógica pura (sin base, sin Express): recibe
// números y fechas y devuelve números. Así se puede testear cada regla
// anti-trampa por separado, que es lo que más importa del módulo.
//
// El navegador manda cada ~20 s el INCREMENTO de tiempo reproducido (no el
// total). El servidor no le cree a ciegas: el número viene del navegador, que
// es de donde salen todos los números que se pueden inventar. Lo acota con
// tres reglas, de la más simple a la más fuerte:
//
//   1. Tope por latido. Ningún latido suma más de 40 s (el doble del
//      intervalo, para dar margen a un navegador lento). Un cliente modificado
//      no puede mandar "miré 2 horas" de una vez.
//
//   2. No más que el tiempo transcurrido. Un latido no puede sumar más
//      segundos que los que pasaron desde el latido anterior de esa sesión.
//      Sin esto, mandar un latido de 40 s cada 1 s inflaría 40 veces.
//
//   3. Una persona, un reloj. El tiempo acreditado se "apoya" sobre una línea
//      de tiempo por persona (`creditoHasta`): lo que ya se acreditó no se
//      vuelve a acreditar. Dos pestañas reproduciendo a la vez, o dos clases
//      en paralelo, suman como UNA: nadie mira dos videos al mismo tiempo.
//
// El margen de redondeo (2 s) no se acumula: el crédito puede adelantarse al
// reloj real como mucho esos 2 s, y el latido siguiente lo descuenta. Si el
// margen se sumara en cada latido, mandar latidos cada segundo daría 3 s por
// segundo.
// ============================================================================

/** El reproductor avisa cada 20 s. */
export const INTERVALO_LATIDO_S = 20
/** Lo máximo que suma un latido: el doble del intervalo. */
export const TOPE_POR_LATIDO_S = 40
/** Tolerancia de reloj y redondeo entre navegador y servidor. No se acumula. */
export const MARGEN_RELOJ_S = 2
/** Una sesión de reproducción vive 12 h. Después hay que reabrir la clase. */
export const VIDA_SESION_MS = 12 * 60 * 60 * 1000

export interface EntradaLatido {
  /** Ahora, en ms (reloj del SERVIDOR, nunca el del navegador). */
  ahoraMs: number
  /** Último latido aceptado de esta sesión (o cuándo se abrió, si es el primero). */
  ultimoLatidoSesionMs: number
  /** Hasta dónde ya se le acreditó tiempo a esta persona (0 si nunca). */
  creditoHastaMs: number
  /** Los segundos que dice el navegador que se reprodujeron. */
  pedidoS: number
}

export interface ResultadoLatido {
  aceptadosS: number
  rechazadosS: number
  /** El nuevo valor de `creditoHasta` para la persona. */
  nuevoCreditoHastaMs: number
}

/** Convierte cualquier cosa a un entero >= 0. NaN, Infinity, negativos y textos raros dan 0. */
export function enteroNoNegativo(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * Cuántos segundos de un latido se aceptan.
 *
 * `desde` es el punto más tardío entre el último latido de la sesión y lo ya
 * acreditado a la persona: el tiempo disponible es lo que pasó desde ahí.
 */
export function calcularLatido(e: EntradaLatido): ResultadoLatido {
  const pedido = enteroNoNegativo(e.pedidoS)
  const desde = Math.max(e.ultimoLatidoSesionMs, e.creditoHastaMs)
  // OJO: el transcurrido puede ser NEGATIVO (el crédito quedó adelantado por
  // el margen del latido anterior) y tiene que seguir negativo al sumarle el
  // margen. Acotarlo a 0 antes regalaba los 2 s de margen en cada latido: una
  // ráfaga de un latido por segundo sumaba 2 s por segundo.
  const transcurridoS = (e.ahoraMs - desde) / 1000
  const disponible = Math.max(0, Math.floor(Math.min(TOPE_POR_LATIDO_S, transcurridoS + MARGEN_RELOJ_S)))
  const aceptados = Math.max(0, Math.min(pedido, disponible))
  return {
    aceptadosS: aceptados,
    rechazadosS: pedido - aceptados,
    // El crédito se apoya donde terminó lo aceptado. Si no se aceptó nada, no
    // se mueve: el próximo latido tiene el mismo tiempo disponible.
    nuevoCreditoHastaMs: aceptados > 0 ? desde + aceptados * 1000 : e.creditoHastaMs,
  }
}

/** La sesión venció (12 h desde que se abrió la clase). */
export function sesionVencida(iniciadaMs: number, ahoraMs: number): boolean {
  return ahoraMs - iniciadaMs > VIDA_SESION_MS
}

/**
 * La duración en la que se confía.
 *
 * Primero la del catálogo, cargada por una persona. La que informa el
 * navegador solo se usa si el catálogo no la tiene: un cliente tocado podría
 * decir que un video de media hora dura 10 segundos y "completarlo" al toque.
 */
export function duracionConfiable(catalogoS: number | null | undefined, detectadaS: number | null | undefined): number | null {
  const c = enteroNoNegativo(catalogoS)
  if (c > 0) return c
  const d = enteroNoNegativo(detectadaS)
  return d > 0 ? d : null
}

/**
 * La duración que manda el navegador, limpia. Con HLS, `video.duration` es
 * NaN hasta que carga el manifiesto y a veces Infinity: eso es "no sé", no 0.
 * Devuelve null para que el upsert NO pise una duración ya conocida.
 */
export function duracionInformada(v: unknown): number | null {
  const n = enteroNoNegativo(v)
  // Más de 24 h no es una clase: es un dato roto (o un stream en vivo).
  return n > 0 && n <= 24 * 3600 ? n : null
}

/**
 * La posición que manda el navegador, acotada a la duración conocida. Sin
 * esto, una posición inventada (999999) marcaría "llegó al final" de cualquier
 * clase cuya duración se conozca después.
 */
export function posicionAcotada(v: unknown, duracionS: number | null): number {
  const p = enteroNoNegativo(v)
  return duracionS ? Math.min(p, duracionS) : p
}

// ----------------------------------------------------------------------------
// Clasificación de una clase
// ----------------------------------------------------------------------------

/** Llegó al final = la posición máxima pasó el 90 % de la duración. */
export const UMBRAL_FINAL = 0.9
/** Completa = llegó al final Y miró al menos el 80 %. */
export const UMBRAL_COMPLETA = 0.8
/** Salteada = llegó al final mirando MENOS de la mitad. Solo se llega así arrastrando la barra. */
export const UMBRAL_SALTEADA = 0.5

export type EstadoClase =
  | 'no_medible' // Drive: no hay forma de saber qué se reprodujo
  | 'sin_abrir'
  | 'en_curso' // abierta, todavía no llegó al final (o llegó a saltos, entre 50 % y 80 %)
  | 'completa'
  | 'salteada'
  | 'sin_duracion' // miró algo, pero no se conoce la duración: no se puede clasificar

export interface DatosClase {
  medible: boolean
  aperturas: number
  segundosMirados: number
  posicionMax: number
  duracionS: number | null
}

export function clasificarClase(d: DatosClase): EstadoClase {
  if (!d.medible) return 'no_medible'
  if (d.aperturas <= 0 && d.segundosMirados <= 0) return 'sin_abrir'
  if (!d.duracionS) return d.segundosMirados > 0 ? 'sin_duracion' : 'en_curso'
  const llegoAlFinal = d.posicionMax >= UMBRAL_FINAL * d.duracionS
  if (!llegoAlFinal) return 'en_curso'
  if (d.segundosMirados >= UMBRAL_COMPLETA * d.duracionS) return 'completa'
  if (d.segundosMirados < UMBRAL_SALTEADA * d.duracionS) return 'salteada'
  return 'en_curso'
}

/**
 * Para un video obligatorio: lo reproducido tiene que ser al menos la
 * duración menos 3 s (margen de redondeo del navegador).
 */
export const MARGEN_OBLIGATORIO_S = 3
export function obligatorioCumplido(segundosSesion: number, duracionCatalogoS: number): boolean {
  return enteroNoNegativo(segundosSesion) >= Math.max(1, duracionCatalogoS - MARGEN_OBLIGATORIO_S)
}

// ----------------------------------------------------------------------------
// Formato
// ----------------------------------------------------------------------------

/** 4980 → "1,4 h de formación"; 1500 → "25 min de formación". */
export function horasDeFormacion(segundos: number): string {
  const s = enteroNoNegativo(segundos)
  if (s < 60) return s > 0 ? 'menos de 1 min de formación' : '0 min de formación'
  const h = s / 3600
  if (h < 1) return `${Math.round(s / 60)} min de formación`
  const redondeado = Math.round(h * 10) / 10
  return `${String(redondeado).replace('.', ',')} h de formación`
}
