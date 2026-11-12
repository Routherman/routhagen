// Permisos por rol (backend/src/logica/permisos.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alcanceDe, dentroDelAlcance, puedeCorregir, type UsuarioAcademia } from '../src/logica/permisos'

const admin: UsuarioAcademia = { id: 'u1', rol: 'admin' }
const lider: UsuarioAcademia = { id: 'u2', rol: 'lider', equipoId: 'e1' }
const vendedor: UsuarioAcademia = { id: 'u3', rol: 'vendedor', equipoId: 'e1' }

test('admin ve a todos', () => {
  assert.deepEqual(alcanceDe(admin, []), { todos: true })
})

test('el líder ve solo sus equipos', () => {
  const a = alcanceDe(lider, ['e1', 'e1'])
  assert.deepEqual(a, { todos: false, equipos: ['e1'] })
  assert.equal(dentroDelAlcance(a!, { equipoId: 'e1' }), true)
  assert.equal(dentroDelAlcance(a!, { equipoId: 'e2' }), false)
  assert.equal(dentroDelAlcance(a!, { equipoId: null }), false)
})

test('un líder sin equipos no ve a nadie', () => {
  const a = alcanceDe(lider, [])
  assert.equal(dentroDelAlcance(a!, { equipoId: 'e1' }), false)
})

test('el vendedor no tiene tablero (404)', () => {
  assert.equal(alcanceDe(vendedor, ['e1']), null)
})

test('corregir: admin sí, líder solo su equipo, vendedor nunca, nadie lo suyo', () => {
  const alumno = { usuarioId: 'u3', equipoId: 'e1' }
  const deOtroEquipo = { usuarioId: 'u9', equipoId: 'e2' }
  assert.equal(puedeCorregir(admin, [], alumno), true)
  assert.equal(puedeCorregir(admin, [], deOtroEquipo), true)
  assert.equal(puedeCorregir(lider, ['e1'], alumno), true)
  assert.equal(puedeCorregir(lider, ['e1'], deOtroEquipo), false)
  assert.equal(puedeCorregir(vendedor, ['e1'], { usuarioId: 'u7', equipoId: 'e1' }), false)
  assert.equal(puedeCorregir(admin, [], { usuarioId: 'u1', equipoId: null }), false)
  assert.equal(puedeCorregir(lider, ['e1'], { usuarioId: 'u2', equipoId: 'e1' }), false)
})
