// Reglas de prácticas (backend/src/logica/practicas.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_EXPLICACION, puedeEditar, puntosDePracticas, validarCorreccion, validarEntrega } from '../src/logica/practicas'

const larga = 'x'.repeat(MIN_EXPLICACION)

test('no se entrega sin trabajo cuando el ejercicio lo pide', () => {
  const r = validarEntrega(null, { trabajoRef: null, explicacion: larga }, { requiereTrabajo: true })
  assert.equal(r.ok, false)
})

test('no se entrega con una explicación corta (los espacios no cuentan)', () => {
  const r = validarEntrega('pendiente', { trabajoRef: 'T-1', explicacion: ' '.repeat(200) + 'corta' }, { requiereTrabajo: true })
  assert.equal(r.ok, false)
})

test('se entrega con trabajo + explicación, desde pendiente o rehacer', () => {
  for (const estado of [null, 'pendiente', 'rehacer'] as const) {
    assert.equal(validarEntrega(estado, { trabajoRef: 'T-1', explicacion: larga }, { requiereTrabajo: true }).ok, true)
  }
})

test('una entregada o aprobada no se toca', () => {
  assert.equal(puedeEditar('entregado').ok, false)
  assert.equal(puedeEditar('aprobado').ok, false)
  assert.equal(validarEntrega('aprobado', { trabajoRef: 'T', explicacion: larga }, { requiereTrabajo: false }).ok, false)
})

test('rehacer exige devolución escrita', () => {
  assert.equal(validarCorreccion('entregado', { resultado: 'rehacer', devolucion: 'mal' }).ok, false)
  assert.equal(validarCorreccion('entregado', { resultado: 'rehacer', devolucion: '   '.repeat(10) }).ok, false)
  assert.equal(validarCorreccion('entregado', { resultado: 'rehacer', devolucion: 'Falta comparar las dos alternativas.' }).ok, true)
  assert.equal(validarCorreccion('entregado', { resultado: 'aprobado', devolucion: null }).ok, true)
})

test('solo se corrige lo entregado', () => {
  for (const estado of [null, 'pendiente', 'aprobado', 'rehacer'] as const) {
    assert.equal(validarCorreccion(estado, { resultado: 'aprobado', devolucion: null }).ok, false, String(estado))
  }
})

test('puntos: aprobada 3, entregada 2, rehacer y a medias 1', () => {
  assert.equal(puntosDePracticas({ aprobadas: 1, entregadas: 1, rehacer: 1, aMedias: 1 }), 7)
})
