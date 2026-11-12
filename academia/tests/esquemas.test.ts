// Validación de entrada (backend/src/esquemas.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuerpoLatido, usuarioAdaptado } from '../src/esquemas'

const token = 'a'.repeat(43)

test('latido válido; la duración nula o rota queda en null', () => {
  const r = cuerpoLatido.parse({ token, segundos: '20', posicion: 31, duracion: null })
  assert.equal(r.segundos, 20)
  assert.equal(r.duracion, null)
})

test('latido con token raro o segundos negativos se rechaza', () => {
  assert.equal(cuerpoLatido.safeParse({ token: 'corto', segundos: 20, posicion: 0 }).success, false)
  assert.equal(cuerpoLatido.safeParse({ token: "x' OR 1=1 --".padEnd(40, 'x'), segundos: 20, posicion: 0 }).success, false)
  assert.equal(cuerpoLatido.safeParse({ token, segundos: -5, posicion: 0 }).success, false)
})

test('el adaptador de login: ids numéricos pasan a texto, roles desconocidos no pasan', () => {
  assert.deepEqual(usuarioAdaptado.parse({ id: 42, rol: 'lider', equipoId: 7 }), { id: '42', rol: 'lider', equipoId: '7' })
  assert.equal(usuarioAdaptado.safeParse({ id: 1, rol: 'Admin' }).success, false)
  assert.equal(usuarioAdaptado.safeParse({ id: 1, rol: 'superuser' }).success, false)
})
