// Tiempo mirado y topes anti-inflado (backend/src/logica/tiempo.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularLatido,
  clasificarClase,
  duracionConfiable,
  duracionInformada,
  enteroNoNegativo,
  horasDeFormacion,
  obligatorioCumplido,
  posicionAcotada,
  sesionVencida,
  TOPE_POR_LATIDO_S,
  VIDA_SESION_MS,
} from '../src/logica/tiempo'

const S = 1000

/** Simula una sesión: aplica latidos en orden y devuelve el total aceptado. */
function simular(latidos: { t: number; pide: number; sesion?: string }[]) {
  let credito = 0
  const ultimo = new Map<string, number>()
  let total = 0
  for (const l of latidos) {
    const id = l.sesion ?? 'a'
    if (!ultimo.has(id)) ultimo.set(id, 0) // todas las sesiones se abren en t=0
    const r = calcularLatido({ ahoraMs: l.t, ultimoLatidoSesionMs: ultimo.get(id)!, creditoHastaMs: credito, pedidoS: l.pide })
    credito = r.nuevoCreditoHastaMs
    ultimo.set(id, l.t)
    total += r.aceptadosS
  }
  return total
}

test('un latido normal de 20 s a los 20 s se acepta entero', () => {
  const r = calcularLatido({ ahoraMs: 20 * S, ultimoLatidoSesionMs: 0, creditoHastaMs: 0, pedidoS: 20 })
  assert.equal(r.aceptadosS, 20)
  assert.equal(r.rechazadosS, 0)
})

test('ningún latido suma más del tope, aunque haya pasado una hora', () => {
  const r = calcularLatido({ ahoraMs: 3600 * S, ultimoLatidoSesionMs: 0, creditoHastaMs: 0, pedidoS: 3600 })
  assert.equal(r.aceptadosS, TOPE_POR_LATIDO_S)
  assert.equal(r.rechazadosS, 3600 - TOPE_POR_LATIDO_S)
})

test('no acepta más que el tiempo transcurrido (+ margen de 2 s)', () => {
  const r = calcularLatido({ ahoraMs: 1 * S, ultimoLatidoSesionMs: 0, creditoHastaMs: 0, pedidoS: 40 })
  assert.equal(r.aceptadosS, 3)
})

test('una ráfaga de latidos cada 1 s pidiendo 40 no infla: suma lo transcurrido + un solo margen', () => {
  const latidos = Array.from({ length: 60 }, (_, i) => ({ t: (i + 1) * S, pide: 40 }))
  const total = simular(latidos)
  assert.ok(total <= 60 + 2, `sumó ${total}`)
  assert.ok(total >= 59)
})

test('el margen no se acumula entre latidos', () => {
  // 100 latidos cada 20 s pidiendo 22 (2 s de más cada vez): no puede sumar 2200.
  const total = simular(Array.from({ length: 100 }, (_, i) => ({ t: (i + 1) * 20 * S, pide: 22 })))
  assert.ok(total <= 2000 + 2, `sumó ${total}`)
})

test('dos pestañas reproduciendo a la vez suman como una sola', () => {
  const latidos: { t: number; pide: number; sesion: string }[] = []
  for (let i = 1; i <= 30; i++) {
    latidos.push({ t: i * 20 * S, pide: 20, sesion: 'a' })
    latidos.push({ t: i * 20 * S + 10, pide: 20, sesion: 'b' })
  }
  const total = simular(latidos)
  assert.ok(total <= 600 + 2, `sumó ${total} en 600 s de reloj`)
})

test('un latido perdido se recupera en el siguiente (mide desde el último que llegó)', () => {
  // El de t=40 no llegó; a los 60 s el reproductor manda los 40 acumulados.
  const total = simular([
    { t: 20 * S, pide: 20 },
    { t: 60 * S, pide: 40 },
  ])
  assert.equal(total, 60)
})

test('un latido pausado no mueve el crédito y deja disponible el tiempo', () => {
  const r = calcularLatido({ ahoraMs: 20 * S, ultimoLatidoSesionMs: 0, creditoHastaMs: 5 * S, pedidoS: 0 })
  assert.equal(r.aceptadosS, 0)
  assert.equal(r.nuevoCreditoHastaMs, 5 * S)
})

test('valores basura en el pedido valen 0', () => {
  for (const v of [-5, NaN, Infinity, 'abc', null, undefined, '12x']) {
    assert.equal(enteroNoNegativo(v), 0, String(v))
  }
  assert.equal(enteroNoNegativo('20'), 20)
  assert.equal(enteroNoNegativo(19.9), 19)
})

test('la duración del catálogo manda sobre la del navegador', () => {
  assert.equal(duracionConfiable(600, 10), 600)
  assert.equal(duracionConfiable(null, 300), 300)
  assert.equal(duracionConfiable('600', null), 600) // llega como texto desde MySQL o una API
  assert.equal(duracionConfiable(null, null), null)
})

test('la duración informada: NaN, Infinity y 0 son "no sé" (null), no se pisa nada', () => {
  assert.equal(duracionInformada(NaN), null)
  assert.equal(duracionInformada(Infinity), null)
  assert.equal(duracionInformada(0), null)
  assert.equal(duracionInformada(null), null)
  assert.equal(duracionInformada(312.7), 312)
  assert.equal(duracionInformada(48 * 3600), null)
})

test('la posición se acota a la duración conocida', () => {
  assert.equal(posicionAcotada(999999, 600), 600)
  assert.equal(posicionAcotada(120, 600), 120)
  assert.equal(posicionAcotada(-3, 600), 0)
  assert.equal(posicionAcotada(500, null), 500)
})

test('clasificación: completa, salteada, en curso, no medible, sin abrir, sin duración', () => {
  const base = { medible: true, aperturas: 1, duracionS: 600 }
  assert.equal(clasificarClase({ ...base, segundosMirados: 500, posicionMax: 590 }), 'completa')
  // Llegó al final mirando 2 minutos de 10: arrastró la barra.
  assert.equal(clasificarClase({ ...base, segundosMirados: 120, posicionMax: 600 }), 'salteada')
  // Llegó al final mirando el 60 %: ni completa ni salteada.
  assert.equal(clasificarClase({ ...base, segundosMirados: 360, posicionMax: 600 }), 'en_curso')
  // Miró mucho pero no llegó al 90 %.
  assert.equal(clasificarClase({ ...base, segundosMirados: 500, posicionMax: 500 }), 'en_curso')
  assert.equal(clasificarClase({ ...base, medible: false, segundosMirados: 0, posicionMax: 0 }), 'no_medible')
  assert.equal(clasificarClase({ ...base, aperturas: 0, segundosMirados: 0, posicionMax: 0 }), 'sin_abrir')
  assert.equal(clasificarClase({ ...base, duracionS: null, segundosMirados: 50, posicionMax: 50 }), 'sin_duracion')
})

test('los umbrales son inclusivos donde dice el documento', () => {
  const base = { medible: true, aperturas: 1, duracionS: 100 }
  assert.equal(clasificarClase({ ...base, segundosMirados: 80, posicionMax: 90 }), 'completa')
  assert.equal(clasificarClase({ ...base, segundosMirados: 49, posicionMax: 90 }), 'salteada')
  assert.equal(clasificarClase({ ...base, segundosMirados: 50, posicionMax: 90 }), 'en_curso')
})

test('video obligatorio: duración menos 3 s de margen', () => {
  assert.equal(obligatorioCumplido(297, 300), true)
  assert.equal(obligatorioCumplido(296, 300), false)
  assert.equal(obligatorioCumplido(2, 3), true)
})

test('la sesión vence a las 12 h', () => {
  assert.equal(sesionVencida(0, VIDA_SESION_MS), false)
  assert.equal(sesionVencida(0, VIDA_SESION_MS + 1), true)
})

test('horas de formación', () => {
  assert.equal(horasDeFormacion(0), '0 min de formación')
  assert.equal(horasDeFormacion(30), 'menos de 1 min de formación')
  assert.equal(horasDeFormacion(1500), '25 min de formación')
  assert.equal(horasDeFormacion(5040), '1,4 h de formación')
  assert.equal(horasDeFormacion(21600), '6 h de formación')
})
