// Tablero del equipo (backend/src/logica/tablero.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarTablero, type ProgresoTablero } from '../src/logica/tablero'

const prog = (p: Partial<ProgresoTablero> & { usuarioId: string; claseId: number }): ProgresoTablero => ({
  marcada: false,
  aperturas: 1,
  segundosMirados: 0,
  posicionMax: 0,
  duracionS: 600,
  duracionCatalogoS: 600,
  medible: true,
  ultimaAperturaMs: 1,
  ...p,
})

const personas = [
  { usuarioId: 'a', nombre: 'Ana', equipoId: 'e1' },
  { usuarioId: 'b', nombre: 'Beto', equipoId: 'e1' },
  { usuarioId: 'c', nombre: 'Caro', equipoId: 'e1' },
  { usuarioId: 'd', nombre: '', equipoId: 'e1' },
]

test('ordena por prácticas, después mirado, después abiertas, después marcadas', () => {
  const filas = armarTablero(
    personas,
    [
      // Beto miró horas, pero no entregó nada.
      prog({ usuarioId: 'b', claseId: 1, segundosMirados: 7200, posicionMax: 600 }),
      // Caro solo marcó.
      prog({ usuarioId: 'c', claseId: 1, aperturas: 0, marcada: true }),
    ],
    [{ usuarioId: 'a', estado: 'aprobado' }],
  )
  assert.deepEqual(filas.map((f) => f.usuarioId), ['a', 'b', 'c', 'd'])
})

test('cuenta salteadas y completas por clase', () => {
  const [f] = armarTablero(
    [personas[0]!],
    [
      prog({ usuarioId: 'a', claseId: 1, segundosMirados: 100, posicionMax: 600 }), // salteada
      prog({ usuarioId: 'a', claseId: 2, segundosMirados: 590, posicionMax: 600 }), // completa
      prog({ usuarioId: 'a', claseId: 3, medible: false, aperturas: 1 }), // Drive: abierta, no mide
    ],
    [],
  )
  assert.equal(f!.salteadas, 1)
  assert.equal(f!.completas, 1)
  assert.equal(f!.abiertas, 3)
  assert.equal(f!.mirado, 690)
})

test('pendiente cuenta como "a medias", no como "sin empezar"', () => {
  const [f] = armarTablero([personas[0]!], [], [{ usuarioId: 'a', estado: 'pendiente' }])
  assert.equal(f!.aMedias, 1)
  assert.equal(f!.sinActividad, false)
})

test('quien no está en la lista de personas no aparece (filtro por equipo)', () => {
  const filas = armarTablero(
    [personas[0]!],
    [prog({ usuarioId: 'intruso', claseId: 1, segundosMirados: 9999 })],
    [{ usuarioId: 'intruso', estado: 'aprobado' }],
  )
  assert.equal(filas.length, 1)
  assert.equal(filas[0]!.mirado, 0)
})

test('sin actividad se marca para atenuar; nombre vacío se muestra como tal', () => {
  const filas = armarTablero(personas, [], [])
  assert.ok(filas.every((f) => f.sinActividad))
  assert.equal(filas.find((f) => f.usuarioId === 'd')!.nombre, 'Sin nombre (d)')
})

test('marcadas suman la duración del catálogo como "horas declaradas"', () => {
  const [f] = armarTablero([personas[0]!], [prog({ usuarioId: 'a', claseId: 1, marcada: true, aperturas: 0 })], [])
  assert.equal(f!.marcadas, 1)
  assert.equal(f!.segundosMarcados, 600)
  assert.equal(f!.abiertas, 0)
})
