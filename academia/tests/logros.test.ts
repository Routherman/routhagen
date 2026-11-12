// Logros por porcentaje (backend/src/logica/logros.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logroActual, logroNuevo, proximoLogro } from '../src/logica/logros'

test('la primera clase desbloquea "Arrancaste"', () => {
  assert.equal(logroNuevo(0, 1, 20)?.id, 'arranque')
})

test('cruzar el 50 % avisa "Mitad de camino"; no cruzar nada no avisa', () => {
  assert.equal(logroNuevo(9, 10, 20)?.id, 'mitad')
  assert.equal(logroNuevo(10, 11, 20), null)
})

test('en un curso de 2 clases, una marca puede cruzar varios umbrales: se avisa el más alto', () => {
  assert.equal(logroNuevo(0, 1, 2)?.id, 'mitad')
  assert.equal(logroNuevo(1, 2, 2)?.id, 'completo')
})

test('próximo logro y cuántas faltan', () => {
  assert.deepEqual(
    (({ logro, faltan }) => ({ id: logro.id, faltan }))(proximoLogro(3, 20)!),
    { id: 'en-camino', faltan: 2 },
  )
  assert.equal(proximoLogro(20, 20), null)
  assert.equal(logroActual(20, 20)?.id, 'completo')
  assert.equal(logroActual(0, 20), null)
})
