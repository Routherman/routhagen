// ============================================================================
// Prueba de INTEGRACIÓN contra un MySQL 8 real (opcional).
//
//   ACADEMIA_TEST_DATABASE_URL=mysql://root:clave@localhost:3306/academia_test npm run test:integracion
//
// OJO: usá una base VACÍA y descartable. Crea las tablas, carga datos de
// prueba y no limpia al terminar (para poder mirar qué quedó).
//
// Recorre todo el circuito por HTTP: login, catálogo, abrir, latidos (topes,
// ráfagas, dos pestañas), marcar y logros, obligatorio, prácticas con
// permisos, tablero por rol, y Redis (falso, roto y ausente).
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

const PKG = join(__dirname, '..')
// express y mysql2 viven en backend/node_modules.
const requerir = createRequire(join(PKG, '..', 'package.json'))
const express = requerir('express')
const mysql = requerir('mysql2/promise')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { academiaRouter, trabajoDePracticaBorrado } = require('../src/index')

async function main() {
  const url = process.env.ACADEMIA_TEST_DATABASE_URL
  if (!url) {
    console.log('Sin ACADEMIA_TEST_DATABASE_URL: se saltea la prueba de integración.')
    return
  }
  const db = mysql.createPool({ uri: url, timezone: 'Z', multipleStatements: true })
  try {
    await db.query(readFileSync(`${PKG}/sql/001_academia.sql`, 'utf8'))
    // Segunda corrida: tiene que ser idempotente.
    await db.query(readFileSync(`${PKG}/sql/001_academia.sql`, 'utf8'))

    await db.query(`
      INSERT INTO academia_cursos (id, slug, nombre, estado, orden) VALUES (1, 'primeros-pasos', 'Primeros pasos', 'publicado', 1), (2, 'oculto', 'Oculto', 'borrador', 2);
      INSERT INTO academia_modulos (id, curso_id, nombre, orden) VALUES (1, 1, 'Intro', 1), (2, 2, 'Oculto', 1);
      INSERT INTO academia_clases (id, modulo_id, nombre, proveedor, video_ref, duracion_s, orden) VALUES
        (1, 1, 'Bienvenida', 'youtube', 'https://youtu.be/dQw4w9WgXcQ', 100, 1),
        (2, 1, 'Lectura', 'drive', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', NULL, 2),
        (3, 1, 'Mux', 'mux', 'a1B2c3D4e5F6g7H8', NULL, 3),
        (4, 1, 'Mal cargada', 'youtube', 'https://otro.example.com/video', 60, 4);
      INSERT INTO academia_clases (id, modulo_id, nombre, proveedor, video_ref, duracion_s, orden, obligatoria_clave) VALUES
        (5, 2, 'Obligatorio', 'youtube', 'dQw4w9WgXcQ', 60, 1, 'bienvenida');
      INSERT INTO academia_equipos (id, nombre, lider_usuario_id) VALUES ('e1', 'Equipo 1', 'lider1');
      INSERT INTO academia_personas (usuario_id, nombre, equipo_id) VALUES ('nunca', 'Nunca Entró', 'e1'), ('otro', 'De Otro Equipo', 'e2');
    `)

    // CHECKs: un obligatorio sin duración y un rehacer sin devolución tienen que fallar.
    await assert.rejects(
      db.query(`INSERT INTO academia_clases (modulo_id, nombre, proveedor, video_ref, obligatoria_clave) VALUES (1,'x','youtube','dQw4w9WgXcQ','sin-duracion')`),
    )
    await assert.rejects(db.query(`INSERT INTO academia_practicas (usuario_id, ejercicio, estado) VALUES ('nunca', 9, 'rehacer')`))

    let reloj = Date.UTC(2026, 0, 1, 12)
    const avanzar = (s: number) => (reloj += s * 1000)

    const app = express()
    app.use(
      '/api/academia',
      academiaRouter({
        db,
        ahora: () => reloj,
        registrar: (m: string, e: unknown) => console.error('[registrar]', m, e),
        // Adaptador de prueba: el usuario viene en un header.
        obtenerUsuario: (req: any) => {
          const h = req.get('x-usuario')
          return h ? JSON.parse(h) : null
        },
        video: { mux: undefined },
      }),
    )
    const srv = app.listen(0)
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/academia`

    const como = (u: object | null) => async (ruta: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (u) headers['x-usuario'] = JSON.stringify(u)
      const r = await fetch(base + ruta, { ...init, headers: { ...headers, ...(init.headers as any) } })
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any, headers: r.headers }
    }
    const vendedor = como({ id: 'v1', rol: 'vendedor', nombre: 'Vendedora Uno', equipoId: 'e1' })
    const lider = como({ id: 'lider1', rol: 'lider', nombre: 'Líder', equipoId: 'e1' })
    const admin = como({ id: 'adm', rol: 'admin', nombre: 'Admin' })
    const anon = como(null)
    const latido = (cuerpo: object, tipo = 'text/plain;charset=UTF-8') =>
      fetch(base + '/latido', { method: 'POST', headers: { 'Content-Type': tipo }, body: JSON.stringify(cuerpo) }).then(
        async (r) => ({ status: r.status, body: (await r.json()) as any }),
      )

    // ── Login ──
    assert.equal((await anon('/cursos')).status, 401)
    assert.equal((await como({ id: 'x', rol: 'Admin' })('/cursos')).status, 401)

    // ── Catálogo ──
    const cursos = await vendedor('/cursos')
    assert.equal(cursos.status, 200)
    assert.equal(cursos.body.cursos.length, 1, 'el curso en borrador no aparece')
    assert.equal(cursos.body.cursos[0].modulos[0].clases.length, 4)
    assert.ok(!('video_ref' in cursos.body.cursos[0].modulos[0].clases[0]), 'el catálogo no expone el video')

    // ── Abrir ──
    const ab = await vendedor('/clases/1/abrir', { method: 'POST' })
    assert.equal(ab.status, 200)
    assert.equal(ab.headers.get('cache-control'), 'no-store')
    assert.equal(ab.body.fuente.youtubeId, 'dQw4w9WgXcQ')
    const token = ab.body.sesion.token
    assert.equal((await vendedor('/clases/4/abrir', { method: 'POST' })).status, 422, 'video mal cargado')
    assert.equal((await vendedor('/clases/5/abrir', { method: 'POST' })).status, 200, 'obligatorio en curso oculto se abre')
    assert.equal((await vendedor('/clases/999/abrir', { method: 'POST' })).status, 404)
    assert.equal((await vendedor('/clases/abc/abrir', { method: 'POST' })).status, 400)
    const drive = await vendedor('/clases/2/abrir', { method: 'POST' })
    assert.equal(drive.body.sesion, null)
    assert.equal(drive.body.fuente.medible, false)

    // ── Latidos ──
    avanzar(20)
    let l = await latido({ token, segundos: 20, posicion: 20, duracion: 100 })
    assert.equal(l.status, 200)
    assert.equal(l.body.aceptados, 20)
    // Inflado: 1 h de golpe a los 20 s.
    avanzar(20)
    l = await latido({ token, segundos: 3600, posicion: 40, duracion: 100 })
    assert.ok(l.body.aceptados <= 22, 'solo lo transcurrido + margen')
    // Ráfaga: dos latidos en el mismo instante → 429 (freno sin Redis).
    l = await latido({ token, segundos: 5, posicion: 40 })
    assert.equal(l.status, 429)
    // JSON también se acepta.
    avanzar(20)
    l = await latido({ token, segundos: 20, posicion: 60, duracion: 0 }, 'application/json')
    assert.equal(l.body.aceptados, 20)
    // Token inventado.
    assert.equal((await latido({ token: 'z'.repeat(43), segundos: 20, posicion: 0 })).status, 404)
    assert.equal((await latido({ token: 'corto', segundos: 20, posicion: 0 })).status, 400)
    // Salto al final (arrastró la barra): posición 100, total mirado 60 → en curso (60 %).
    avanzar(5)
    l = await latido({ token, segundos: 5, posicion: 9999, duracion: 100 })
    assert.equal(l.body.estado, 'en_curso')
    const [prog] = await db.query(`SELECT * FROM academia_progreso WHERE usuario_id='v1' AND clase_id=1`)
    assert.ok(prog[0].segundos_mirados <= 67 && prog[0].segundos_mirados >= 65, String(prog[0].segundos_mirados))
    assert.equal(prog[0].posicion_max, 100, 'posición acotada a la duración del catálogo')
    assert.equal(prog[0].aperturas, 1)

    // Dos pestañas a la vez: una segunda sesión de la misma persona no duplica.
    const ab2 = await vendedor('/clases/1/abrir', { method: 'POST' })
    avanzar(20)
    const a1 = await latido({ token, segundos: 20, posicion: 100 })
    const a2 = await latido({ token: ab2.body.sesion.token, segundos: 20, posicion: 20 })
    assert.ok(a1.body.aceptados + a2.body.aceptados <= 22, `dos pestañas sumaron ${a1.body.aceptados + a2.body.aceptados}`)
    const [p2] = await db.query(`SELECT segundos_mirados, completada_at FROM academia_progreso WHERE usuario_id='v1' AND clase_id=1`)
    assert.ok(p2[0].segundos_mirados >= 80 && p2[0].completada_at, 'llegó al 80 % mirado y al final → completa')

    // Mux sin duración en catálogo: la detectada se guarda y NO se pisa con 0.
    const mux = await vendedor('/clases/3/abrir', { method: 'POST' })
    assert.ok(mux.body.fuente.src.startsWith('https://stream.mux.com/'))
    avanzar(20)
    await latido({ token: mux.body.sesion.token, segundos: 20, posicion: 20, duracion: 300 })
    avanzar(20)
    await latido({ token: mux.body.sesion.token, segundos: 20, posicion: 40, duracion: 0 })
    const [p3] = await db.query(`SELECT duracion_detectada FROM academia_progreso WHERE usuario_id='v1' AND clase_id=3`)
    assert.equal(p3[0].duracion_detectada, 300)

    // ── Marcar + logros ──
    let m = await vendedor('/clases/1/marca', { method: 'POST', body: JSON.stringify({ marcada: true }) })
    assert.equal(m.body.logro.id, 'en-camino')
    m = await vendedor('/clases/1/marca', { method: 'POST', body: JSON.stringify({ marcada: true }) })
    assert.equal(m.body.logro, null, 'marcar dos veces no repite el logro')
    m = await vendedor('/clases/2/marca', { method: 'POST', body: JSON.stringify({ marcada: true }) })
    assert.equal(m.body.logro.id, 'mitad')
    m = await vendedor('/clases/2/marca', { method: 'POST', body: JSON.stringify({ marcada: false }) })
    assert.equal(m.body.resumen.marcadas, 1)
    assert.equal((await vendedor('/clases/5/marca', { method: 'POST', body: JSON.stringify({ marcada: true }) })).status, 404)

    // ── Obligatorio ──
    let ob = await vendedor('/obligatorios/bienvenida')
    assert.equal(ob.body.pendiente, true)
    const abOb = await vendedor(`/clases/${ob.body.claseId}/abrir`, { method: 'POST' })
    const tOb = abOb.body.sesion.token
    avanzar(20)
    await latido({ token: tOb, segundos: 20, posicion: 20 })
    // Intenta terminar a los 20 s de 60: no.
    let fin = await vendedor('/obligatorios/bienvenida/terminar', { method: 'POST', body: JSON.stringify({ token: tOb, segundos: 0, posicion: 60 }) })
    assert.equal(fin.status, 422)
    assert.ok(fin.body.faltanS > 0)
    avanzar(20)
    await latido({ token: tOb, segundos: 20, posicion: 40 })
    avanzar(19)
    fin = await vendedor('/obligatorios/bienvenida/terminar', { method: 'POST', body: JSON.stringify({ token: tOb, segundos: 19, posicion: 59 }) })
    assert.equal(fin.status, 200, JSON.stringify(fin.body))
    ob = await vendedor('/obligatorios/bienvenida')
    assert.equal(ob.body.pendiente, false)
    // Con el token de OTRA persona no se puede terminar.
    assert.equal(
      (await lider('/obligatorios/bienvenida/terminar', { method: 'POST', body: JSON.stringify({ token: tOb, segundos: 0, posicion: 0 }) })).status,
      404,
    )
    // Nueva versión del video → vuelve a estar pendiente.
    await db.query(`UPDATE academia_clases SET obligatoria_version = obligatoria_version + 1 WHERE obligatoria_clave = 'bienvenida'`)
    assert.equal((await vendedor('/obligatorios/bienvenida')).body.pendiente, true)

    // ── Prácticas ──
    let pr = await vendedor('/practicas')
    assert.equal(pr.body.practicas.length, 2)
    assert.equal(pr.body.practicas[0].entrega, null, 'la fila no nace sola')
    pr = await vendedor('/practicas/1', { method: 'PUT', body: JSON.stringify({ explicacion: 'borrador' }) })
    assert.equal(pr.body.entrega.estado, 'pendiente')
    pr = await vendedor('/practicas/1/entregar', { method: 'POST', body: JSON.stringify({ trabajoRef: 'T-1', explicacion: 'corta' }) })
    assert.equal(pr.status, 422)
    pr = await vendedor('/practicas/1/entregar', { method: 'POST', body: JSON.stringify({ explicacion: 'x'.repeat(130) }) })
    assert.equal(pr.status, 422, 'falta el trabajo')
    pr = await vendedor('/practicas/1/entregar', { method: 'POST', body: JSON.stringify({ trabajoRef: 'T-1', explicacion: 'x'.repeat(130) }) })
    assert.equal(pr.body.entrega.estado, 'entregado')
    assert.equal((await vendedor('/practicas/1', { method: 'PUT', body: JSON.stringify({ explicacion: 'cambio' }) })).status, 409)
    assert.equal((await vendedor('/practicas/99', { method: 'PUT', body: JSON.stringify({}) })).status, 404)

    const corr = (u: typeof vendedor, cuerpo: object) => u('/practicas/corregir', { method: 'POST', body: JSON.stringify(cuerpo) })
    assert.equal((await corr(vendedor, { usuarioId: 'v1', ejercicio: 1, resultado: 'aprobado' })).status, 404)
    assert.equal((await corr(lider, { usuarioId: 'v1', ejercicio: 1, resultado: 'rehacer', devolucion: 'mal' })).status, 422)
    let c = await corr(lider, { usuarioId: 'v1', ejercicio: 1, resultado: 'rehacer', devolucion: 'Falta comparar las dos alternativas.' })
    assert.equal(c.body.entrega.estado, 'rehacer')
    assert.equal((await corr(lider, { usuarioId: 'v1', ejercicio: 1, resultado: 'aprobado' })).status, 409, 'solo se corrige lo entregado')
    pr = await vendedor('/practicas/1/entregar', { method: 'POST', body: JSON.stringify({ trabajoRef: 'T-2', explicacion: 'y'.repeat(130) }) })
    assert.equal(pr.body.entrega.devolucion, 'Falta comparar las dos alternativas.', 'la devolución queda a la vista')
    // Líder de otro equipo no corrige.
    const liderOtro = como({ id: 'lider2', rol: 'lider', liderDe: ['e2'] })
    assert.equal((await corr(liderOtro, { usuarioId: 'v1', ejercicio: 1, resultado: 'aprobado' })).status, 404)
    const lista = await lider('/practicas/corregir')
    assert.equal(lista.body.entregas.length, 1)
    assert.equal(lista.body.entregas[0].nombre, 'Vendedora Uno')
    c = await corr(admin, { usuarioId: 'v1', ejercicio: 1, resultado: 'aprobado', devolucion: 'Muy bien resuelto.' })
    assert.equal(c.body.entrega.estado, 'aprobado')
    // Se borra el trabajo → vuelve a pendiente, conserva la devolución.
    assert.equal(await trabajoDePracticaBorrado(db, 'T-2'), 1)
    const [pp] = await db.query(`SELECT estado, devolucion, trabajo_ref FROM academia_practicas WHERE usuario_id='v1' AND ejercicio=1`)
    assert.deepEqual([pp[0].estado, pp[0].trabajo_ref], ['pendiente', null])
    assert.equal(pp[0].devolucion, 'Muy bien resuelto.')

    // ── Tablero ──
    assert.equal((await vendedor('/tablero')).status, 404)
    const tl = await lider('/tablero')
    assert.equal(tl.status, 200)
    const ids = tl.body.filas.map((f: any) => f.usuarioId).sort()
    assert.deepEqual(ids, ['lider1', 'nunca', 'v1'], 'el líder ve solo su equipo (incluso a quien nunca entró)')
    const fv = tl.body.filas.find((f: any) => f.usuarioId === 'v1')
    assert.equal(fv.aMedias, 1)
    assert.ok(fv.mirado > 0 && fv.miradoTexto)
    assert.equal(tl.body.filas[0].usuarioId, 'v1', 'quien produjo algo va arriba')
    assert.equal(tl.body.filas.find((f: any) => f.usuarioId === 'nunca').sinActividad, true)
    const ta = await admin('/tablero')
    assert.ok(ta.body.filas.some((f: any) => f.usuarioId === 'otro'), 'admin ve a todos')
    await db.query(`UPDATE academia_personas SET en_seguimiento = 0 WHERE usuario_id = 'otro'`)
    assert.ok(!(await admin('/tablero')).body.filas.some((f: any) => f.usuarioId === 'otro'), 'fuera de seguimiento se esconde')
    assert.ok((await admin('/tablero?todos=1')).body.filas.some((f: any) => f.usuarioId === 'otro'))

    // ── Con Redis (falso, en memoria): freno de ráfagas y cache ──
    const mem = new Map<string, string>()
    const redisFalso = {
      async get(k: string) { return mem.get(k) ?? null },
      async setConVencimiento(k: string, v: string) { mem.set(k, v) },
      async incrConVencimiento(k: string) { const n = Number(mem.get(k) ?? 0) + 1; mem.set(k, String(n)); return n },
      async del(k: string) { mem.delete(k) },
    }
    const app2 = express()
    app2.use('/a', academiaRouter({ db, redis: redisFalso, ahora: () => reloj, obtenerUsuario: () => ({ id: 'v1', rol: 'vendedor' }) }))
    const srv2 = app2.listen(0)
    const base2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}/a`
    assert.equal((await fetch(base2 + '/cursos')).status, 200)
    assert.ok(mem.has('academia:catalogo:v1'), 'catálogo cacheado')
    const ab3 = (await (await fetch(base2 + '/clases/1/abrir', { method: 'POST' })).json()) as any
    const estados: number[] = []
    for (let i = 0; i < 14; i++) {
      avanzar(2)
      const r = await fetch(base2 + '/latido', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: ab3.sesion.token, segundos: 2, posicion: i }) })
      estados.push(r.status)
    }
    assert.ok(estados.slice(12).every((s) => s === 429), `freno de Redis: ${estados.join(',')}`)

    // Redis que explota: sigue andando.
    const redisRoto = { async get() { throw new Error('caído') }, async setConVencimiento() { throw new Error('caído') }, async incrConVencimiento() { throw new Error('caído') }, async del() { throw new Error('caído') } }
    const app3 = express()
    app3.use('/a', academiaRouter({ db, redis: redisRoto, registrar: () => undefined, obtenerUsuario: () => ({ id: 'v1', rol: 'vendedor' }) }))
    const srv3 = app3.listen(0)
    assert.equal((await fetch(`http://127.0.0.1:${(srv3.address() as AddressInfo).port}/a/cursos`)).status, 200)

    srv.close(); srv2.close(); srv3.close()
    const [ses] = await db.query(`SELECT SUM(segundos_rechazados) AS r FROM academia_sesiones`)
    console.log('segundos rechazados en total:', ses[0].r)
    console.log('E2E OK')
  } finally {
    await db.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
