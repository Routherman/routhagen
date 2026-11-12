// El medidor del navegador (frontend/lib/medidor.ts), con un reloj falso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Medidor } from '../../../frontend/src/lib/academia/medidor'
import type { Latido } from '../../../frontend/src/lib/academia/tipos'

function armar(opciones: { falla?: boolean; duracion?: number | null; catalogo?: number | null } = {}) {
  let t = 0
  const enviados: { l: Latido; final: boolean }[] = []
  const m = new Medidor({
    ahora: () => t,
    leerPosicion: () => t / 1000,
    leerDuracion: () => opciones.duracion ?? null,
    duracionCatalogoS: opciones.catalogo ?? null,
    enviar: async (l, final) => {
      enviados.push({ l, final })
      return !opciones.falla
    },
  })
  return { m, enviados, avanzar: (s: number) => (t += s * 1000) }
}

test('solo suma con el video reproduciéndose', async () => {
  const { m, avanzar } = armar()
  avanzar(10) // cargando, sin play
  m.setReproduciendo(true)
  avanzar(15)
  m.setReproduciendo(false)
  avanzar(30) // pausado
  assert.equal(Math.round(m.pendienteS()), 15)
})

test('con la pestaña oculta no suma, aunque el video siga andando', () => {
  const { m, avanzar } = armar()
  m.setReproduciendo(true)
  avanzar(5)
  m.setVisible(false)
  avanzar(600)
  m.setVisible(true)
  avanzar(5)
  assert.equal(Math.round(m.pendienteS()), 10)
})

test('manda el incremento en segundos enteros y guarda la fracción', async () => {
  const { m, enviados, avanzar } = armar()
  m.setReproduciendo(true)
  avanzar(20.6)
  await m.avisar()
  avanzar(19.6)
  await m.avisar()
  assert.deepEqual(enviados.map((e) => e.l.segundos), [20, 20])
  assert.ok(Math.abs(m.pendienteS() - 0.2) < 1e-6)
})

test('menos de 3 s no se manda, salvo el último tramo', async () => {
  const { m, enviados, avanzar } = armar()
  m.setReproduciendo(true)
  avanzar(2)
  await m.avisar()
  assert.equal(enviados.length, 0)
  await m.avisar(true)
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0]!.final, true)
})

test('si un latido falla, lo no enviado vuelve al acumulador (con tope)', async () => {
  const { m, avanzar } = armar({ falla: true })
  m.setReproduciendo(true)
  avanzar(20)
  await m.avisar()
  assert.equal(Math.round(m.pendienteS()), 20)
  avanzar(500)
  await m.avisar()
  assert.equal(Math.round(m.pendienteS()), 120)
})

test('si el reproductor no sabe la duración (NaN/Infinity en HLS) usa la del catálogo', async () => {
  const { m, enviados, avanzar } = armar({ duracion: null, catalogo: 312 })
  m.setReproduciendo(true)
  avanzar(20)
  await m.avisar()
  assert.equal(enviados[0]!.l.duracion, 312)
})

test('tomarTodo vacía el acumulador para mandarlo junto con otra cosa', () => {
  const { m, avanzar } = armar()
  m.setReproduciendo(true)
  avanzar(7.5)
  const l = m.tomarTodo()
  assert.equal(l.segundos, 7)
  assert.ok(m.pendienteS() < 1)
})
