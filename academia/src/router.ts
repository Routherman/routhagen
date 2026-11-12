// ============================================================================
// El router de la Academia.
//
//   app.use('/api/academia', academiaRouter({ db, redis, obtenerUsuario }))
//
// Endpoints (todos responden JSON):
//
//   GET  /yo                       quién soy y si tengo tablero
//   GET  /cursos                   catálogo publicado + mi progreso
//   POST /clases/:id/abrir         registra "abierta", devuelve el video y un token de sesión
//   POST /clases/:id/marca         marcar / desmarcar como vista (devuelve el logro si se cruzó uno)
//   POST /latido                   tiempo reproducido (se autentica con el token de sesión)
//   GET  /obligatorios/:clave      ¿le falta ver este video obligatorio?
//   POST /obligatorios/:clave/terminar   verifica que lo vio entero y lo anota
//   GET  /practicas                enunciados + mis entregas
//   PUT  /practicas/:n             guardar borrador (la fila nace acá)
//   POST /practicas/:n/entregar    entregar
//   GET  /practicas/corregir       entregas de mi alcance (admin / líder)
//   POST /practicas/corregir       aprobar o mandar a rehacer (admin / líder)
//   GET  /tablero                  una fila por persona (admin: todos; líder: su equipo)
//
// Los permisos se chequean acá, en cada endpoint, nunca en la vista.
// ============================================================================

import { createHash, randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type Response, type Router } from 'express'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ZodError } from 'zod'

import { ENUNCIADOS_EJEMPLO, type Enunciado } from './enunciados'
import {
  claveObligatorio,
  cuerpoBorrador,
  cuerpoCorreccion,
  cuerpoEntrega,
  cuerpoLatido,
  cuerpoMarca,
  idNumerico,
  usuarioAdaptado,
} from './esquemas'
import { logroActual, logroNuevo, proximoLogro } from './logica/logros'
import { alcanceDe, puedeCorregir, type Alcance, type UsuarioAcademia } from './logica/permisos'
import { MIN_EXPLICACION, puedeEditar, validarCorreccion, validarEntrega, type EstadoPractica } from './logica/practicas'
import { armarTablero, type PersonaTablero, type ProgresoTablero } from './logica/tablero'
import {
  INTERVALO_LATIDO_S,
  calcularLatido,
  clasificarClase,
  duracionConfiable,
  duracionInformada,
  horasDeFormacion,
  obligatorioCumplido,
  posicionAcotada,
  sesionVencida,
} from './logica/tiempo'
import { ErrorVideo, construirFuente, esMedible, type ConfigVideo, type Proveedor } from './logica/video'
import { adaptarRedis, almacenSeguro, type AlmacenRapido } from './redis'

// ----------------------------------------------------------------------------
// Opciones
// ----------------------------------------------------------------------------

export interface OpcionesAcademia {
  /** Pool de mysql2/promise. */
  db: Pool
  /** Cliente de ioredis o node-redis (o un AlmacenRapido propio). Opcional. */
  redis?: unknown
  /**
   * EL ADAPTADOR DE LOGIN. Lo implementa el sistema que monta el módulo:
   * a partir del request (su JWT, su sesión, su req.user) devuelve quién es.
   * null = no autenticado (401).
   */
  obtenerUsuario: (req: Request) => Promise<UsuarioAcademia | null> | UsuarioAcademia | null
  /**
   * Opcional: de qué equipos es líder. Si no se pasa, se usa `usuario.liderDe`
   * y, si tampoco viene, la tabla academia_equipos.
   */
  equiposQueLidera?: (u: UsuarioAcademia) => Promise<string[]>
  /**
   * Opcional: las personas que abarca un alcance, desde la tabla de usuarios
   * del sistema. Si no se pasa, se leen de academia_personas.
   */
  listarPersonas?: (alcance: Alcance, u: UsuarioAcademia) => Promise<PersonaTablero[]>
  video?: ConfigVideo
  /** Los ejercicios reales. Default: los dos de ejemplo. */
  enunciados?: Enunciado[]
  minExplicacion?: number
  /** Para registrar errores. Default: console.error. */
  registrar?: (mensaje: string, error?: unknown) => void
  /** Reloj inyectable (tests). */
  ahora?: () => number
}

// ----------------------------------------------------------------------------
// Errores
// ----------------------------------------------------------------------------

class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(mensaje)
  }
}

const noEncontrado = () => new ErrorHttp(404, 'No encontrado')

type Manejador = (req: Request, res: Response) => Promise<void>
const envolver = (fn: Manejador) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next)
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex')
const ms = (v: unknown): number | null => (v instanceof Date ? v.getTime() : v ? new Date(String(v)).getTime() : null)
const num = (v: unknown): number => Number(v ?? 0) || 0

async function enTransaccion<T>(db: Pool, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  // Un reintento ante deadlock: dos latidos de la misma persona en el mismo
  // milisegundo pueden chocar, y perder ese tramo no tiene sentido.
  for (let intento = 0; ; intento++) {
    const c = await db.getConnection()
    try {
      await c.beginTransaction()
      const r = await fn(c)
      await c.commit()
      return r
    } catch (e) {
      await c.rollback().catch(() => undefined)
      const codigo = (e as { code?: string }).code
      if (intento === 0 && (codigo === 'ER_LOCK_DEADLOCK' || codigo === 'ER_LOCK_WAIT_TIMEOUT')) continue
      throw e
    } finally {
      c.release()
    }
  }
}

// ----------------------------------------------------------------------------
// Fábrica
// ----------------------------------------------------------------------------

export type RouterAcademia = Router & {
  /** Llamar después de editar el catálogo a mano, para no esperar los 60 s del cache. */
  invalidarCatalogo: () => Promise<void>
}

const CLAVE_CATALOGO = 'academia:catalogo:v1'

export function academiaRouter(op: OpcionesAcademia): RouterAcademia {
  const db = op.db
  const ahora = op.ahora ?? (() => Date.now())
  const registrar = op.registrar ?? ((m, e) => console.error(`[academia] ${m}`, e ?? ''))
  const enunciados = op.enunciados ?? ENUNCIADOS_EJEMPLO
  const minExplicacion = op.minExplicacion ?? MIN_EXPLICACION
  const configVideo = op.video ?? {}

  const crudo = op.redis as Partial<AlmacenRapido> | undefined
  const almacen = almacenSeguro(
    crudo && typeof crudo.setConVencimiento === 'function' ? (crudo as AlmacenRapido) : adaptarRedis(op.redis),
    (e) => registrar('Redis falló; se sigue solo con MySQL', e),
  )

  const router = express.Router() as RouterAcademia
  router.use(express.json({ limit: '32kb' }))

  // ── Login ────────────────────────────────────────────────────────────────

  // La fila de academia_personas se mantiene sola, pero no en cada request:
  // un upsert por persona cada 5 minutos alcanza.
  const personasAlDia = new Map<string, number>()

  async function asegurarPersona(u: UsuarioAcademia) {
    const clave = `${u.id}|${u.nombre ?? ''}|${u.equipoId === undefined ? '~' : u.equipoId ?? ''}`
    const vence = personasAlDia.get(clave)
    if (vence && vence > ahora()) return
    if (u.equipoId !== undefined) {
      await db.query(
        `INSERT INTO academia_personas (usuario_id, nombre, equipo_id) VALUES (?, ?, ?) AS n
         ON DUPLICATE KEY UPDATE nombre = COALESCE(n.nombre, academia_personas.nombre), equipo_id = n.equipo_id`,
        [u.id, u.nombre ?? null, u.equipoId],
      )
    } else {
      await db.query(
        `INSERT INTO academia_personas (usuario_id, nombre) VALUES (?, ?) AS n
         ON DUPLICATE KEY UPDATE nombre = COALESCE(n.nombre, academia_personas.nombre)`,
        [u.id, u.nombre ?? null],
      )
    }
    if (personasAlDia.size > 5000) personasAlDia.clear()
    personasAlDia.set(clave, ahora() + 5 * 60 * 1000)
  }

  async function usuarioDe(req: Request): Promise<UsuarioAcademia> {
    const bruto = await op.obtenerUsuario(req)
    if (!bruto) throw new ErrorHttp(401, 'Iniciá sesión')
    // Se valida también lo que devuelve el adaptador: un rol mal escrito en el
    // JWT ('Admin', 'leader') no puede caer en un permiso por default.
    const r = usuarioAdaptado.safeParse(bruto)
    if (!r.success) {
      registrar('obtenerUsuario devolvió algo inválido', r.error.flatten())
      throw new ErrorHttp(401, 'Sesión inválida')
    }
    const u: UsuarioAcademia = { ...r.data, equipoId: 'equipoId' in bruto ? r.data.equipoId ?? null : undefined }
    await asegurarPersona(u)
    return u
  }

  async function equiposDe(u: UsuarioAcademia): Promise<string[]> {
    if (u.rol !== 'lider') return []
    if (op.equiposQueLidera) return op.equiposQueLidera(u)
    if (u.liderDe) return u.liderDe
    const [filas] = await db.query<RowDataPacket[]>(
      'SELECT id FROM academia_equipos WHERE lider_usuario_id = ?',
      [u.id],
    )
    return filas.map((f) => String(f.id))
  }

  async function personasDe(alcance: Alcance, u: UsuarioAcademia, incluirNoSeguidos: boolean): Promise<PersonaTablero[]> {
    if (op.listarPersonas) return op.listarPersonas(alcance, u)
    if (!alcance.todos && alcance.equipos.length === 0) return []
    const filtroSeguimiento = incluirNoSeguidos ? '' : 'AND en_seguimiento = 1'
    const [filas] = alcance.todos
      ? await db.query<RowDataPacket[]>(
          `SELECT usuario_id, nombre, equipo_id FROM academia_personas WHERE activo = 1 ${filtroSeguimiento}`,
        )
      : await db.query<RowDataPacket[]>(
          `SELECT usuario_id, nombre, equipo_id FROM academia_personas
           WHERE activo = 1 ${filtroSeguimiento} AND equipo_id IN (?)`,
          [alcance.equipos],
        )
    return filas.map((f) => ({ usuarioId: String(f.usuario_id), nombre: f.nombre ?? null, equipoId: f.equipo_id ?? null }))
  }

  // ── Catálogo ─────────────────────────────────────────────────────────────

  interface ClaseCatalogo {
    id: number
    moduloId: number
    nombre: string
    descripcion: string | null
    proveedor: Proveedor
    duracionS: number | null
    orden: number
  }
  interface CursoCatalogo {
    id: number
    slug: string
    nombre: string
    descripcion: string | null
    portadaUrl: string | null
    modulos: { id: number; nombre: string; clases: ClaseCatalogo[] }[]
  }

  async function catalogo(): Promise<CursoCatalogo[]> {
    const guardado = await almacen.get(CLAVE_CATALOGO)
    if (guardado) {
      try {
        return JSON.parse(guardado) as CursoCatalogo[]
      } catch {
        /* cache roto: se rearma */
      }
    }
    const [cursos] = await db.query<RowDataPacket[]>(
      `SELECT id, slug, nombre, descripcion, portada_url FROM academia_cursos
       WHERE estado = 'publicado' ORDER BY orden, id`,
    )
    const [modulos] = await db.query<RowDataPacket[]>(
      `SELECT m.id, m.curso_id, m.nombre FROM academia_modulos m
       JOIN academia_cursos c ON c.id = m.curso_id AND c.estado = 'publicado'
       ORDER BY m.orden, m.id`,
    )
    // video_ref NO sale en el catálogo: el video se entrega recién al abrir la
    // clase, con sesión, y eso es lo que registra "abierta".
    const [clases] = await db.query<RowDataPacket[]>(
      `SELECT cl.id, cl.modulo_id, cl.nombre, cl.descripcion, cl.proveedor, cl.duracion_s, cl.orden
       FROM academia_clases cl
       JOIN academia_modulos m ON m.id = cl.modulo_id
       JOIN academia_cursos c ON c.id = m.curso_id AND c.estado = 'publicado'
       ORDER BY cl.orden, cl.id`,
    )
    const porModulo = new Map<number, ClaseCatalogo[]>()
    for (const c of clases) {
      const lista = porModulo.get(num(c.modulo_id)) ?? []
      lista.push({
        id: num(c.id),
        moduloId: num(c.modulo_id),
        nombre: c.nombre,
        descripcion: c.descripcion ?? null,
        proveedor: c.proveedor,
        // Siempre Number(): una duración que llega como texto y se suma sin
        // convertir concatena strings (un curso llegó a durar 10^31 horas).
        duracionS: num(c.duracion_s) > 0 ? num(c.duracion_s) : null,
        orden: num(c.orden),
      })
      porModulo.set(num(c.modulo_id), lista)
    }
    const resultado: CursoCatalogo[] = cursos.map((c) => ({
      id: num(c.id),
      slug: c.slug,
      nombre: c.nombre,
      descripcion: c.descripcion ?? null,
      portadaUrl: c.portada_url ?? null,
      modulos: modulos
        .filter((m) => num(m.curso_id) === num(c.id))
        .map((m) => ({ id: num(m.id), nombre: m.nombre, clases: porModulo.get(num(m.id)) ?? [] })),
    }))
    await almacen.set(CLAVE_CATALOGO, JSON.stringify(resultado), 60)
    return resultado
  }

  router.invalidarCatalogo = () => almacen.del(CLAVE_CATALOGO)

  async function progresoDe(usuarioId: string, claseIds?: number[]) {
    if (claseIds && claseIds.length === 0) return new Map<number, RowDataPacket>()
    const [filas] = claseIds
      ? await db.query<RowDataPacket[]>(
          'SELECT * FROM academia_progreso WHERE usuario_id = ? AND clase_id IN (?)',
          [usuarioId, claseIds],
        )
      : await db.query<RowDataPacket[]>('SELECT * FROM academia_progreso WHERE usuario_id = ?', [usuarioId])
    return new Map(filas.map((f) => [num(f.clase_id), f]))
  }

  function progresoPublico(clase: { proveedor: Proveedor; duracionS: number | null }, p: RowDataPacket | undefined) {
    const duracion = duracionConfiable(clase.duracionS, p?.duracion_detectada)
    const datos = {
      medible: esMedible(clase.proveedor),
      aperturas: num(p?.aperturas),
      segundosMirados: num(p?.segundos_mirados),
      posicionMax: num(p?.posicion_max),
      duracionS: duracion,
    }
    return {
      marcada: !!p?.marcada_at,
      abierta: datos.aperturas > 0,
      segundosMirados: datos.segundosMirados,
      ultimaPosicion: num(p?.ultima_posicion),
      completada: !!p?.completada_at,
      estado: clasificarClase(datos),
    }
  }

  function resumenCurso(curso: CursoCatalogo, prog: Map<number, RowDataPacket>) {
    const clases = curso.modulos.flatMap((m) => m.clases)
    const marcadas = clases.filter((c) => prog.get(c.id)?.marcada_at)
    return {
      total: clases.length,
      marcadas: marcadas.length,
      // "Horas de formación" = duración de lo marcado (lo que DICE haber visto).
      // El tiempo realmente reproducido va aparte: `segundosMirados`.
      segundosMarcados: marcadas.reduce((s, c) => s + (c.duracionS ?? 0), 0),
      segundosMirados: clases.reduce((s, c) => s + num(prog.get(c.id)?.segundos_mirados), 0),
      logro: logroActual(marcadas.length, clases.length),
      proximo: proximoLogro(marcadas.length, clases.length),
    }
  }

  // ── /yo ──────────────────────────────────────────────────────────────────

  router.get(
    '/yo',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      res.json({ id: u.id, rol: u.rol, nombre: u.nombre ?? null, tieneTablero: alcanceDe(u, []) !== null })
    }),
  )

  // ── /cursos ──────────────────────────────────────────────────────────────

  router.get(
    '/cursos',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const [cursos, prog] = await Promise.all([catalogo(), progresoDe(u.id)])
      res.json({
        cursos: cursos.map((c) => ({
          ...c,
          modulos: c.modulos.map((m) => ({
            ...m,
            clases: m.clases.map((cl) => ({
              ...cl,
              medible: esMedible(cl.proveedor),
              progreso: progresoPublico(cl, prog.get(cl.id)),
            })),
          })),
          resumen: resumenCurso(c, prog),
        })),
      })
    }),
  )

  // ── Abrir una clase ──────────────────────────────────────────────────────

  async function claseConCurso(id: number) {
    const [filas] = await db.query<RowDataPacket[]>(
      `SELECT cl.*, c.id AS curso_id, c.slug AS curso_slug, c.nombre AS curso_nombre, c.estado AS curso_estado
       FROM academia_clases cl
       JOIN academia_modulos m ON m.id = cl.modulo_id
       JOIN academia_cursos c ON c.id = m.curso_id
       WHERE cl.id = ?`,
      [id],
    )
    return filas[0]
  }

  router.post(
    '/clases/:id/abrir',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const id = idNumerico.parse(req.params.id)
      const clase = await claseConCurso(id)
      // Un curso en borrador no existe para nadie. Los videos obligatorios sí
      // se pueden abrir aunque vivan en un curso oculto.
      if (!clase || (clase.curso_estado !== 'publicado' && !clase.obligatoria_clave)) throw noEncontrado()

      const proveedor = clase.proveedor as Proveedor
      const t = ahora()
      // Si el video está mal cargado, se corta acá: 422 con mensaje claro, y
      // no se registra una apertura de algo que no se pudo ver.
      const fuente = construirFuente(proveedor, String(clase.video_ref), configVideo, t)
      const medible = esMedible(proveedor)

      // Token secreto de la sesión de reproducción. Es la credencial de los
      // latidos: se entrega solo a quien abrió la clase con su login.
      const token = randomBytes(32).toString('base64url')
      const momento = new Date(t)
      await enTransaccion(db, async (c) => {
        await c.query(
          `INSERT INTO academia_sesiones (token_hash, usuario_id, clase_id, iniciada_at, ultimo_latido_at, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [hash(token), u.id, id, momento, momento, String(req.get('user-agent') ?? '').slice(0, 255) || null],
        )
        await c.query(
          `INSERT INTO academia_progreso (usuario_id, clase_id, aperturas, primera_apertura_at, ultima_apertura_at)
           VALUES (?, ?, 1, ?, ?) AS n
           ON DUPLICATE KEY UPDATE aperturas = academia_progreso.aperturas + 1,
             primera_apertura_at = COALESCE(academia_progreso.primera_apertura_at, n.primera_apertura_at),
             ultima_apertura_at = n.ultima_apertura_at`,
          [u.id, id, momento, momento],
        )
      })

      const prog = await progresoDe(u.id, [id])
      const duracionS = num(clase.duracion_s) > 0 ? num(clase.duracion_s) : null
      // La URL del video puede venir firmada y con vencimiento: nunca se cachea.
      res.set('Cache-Control', 'no-store')
      res.json({
        clase: {
          id,
          nombre: clase.nombre,
          descripcion: clase.descripcion ?? null,
          duracionS,
          curso: { id: num(clase.curso_id), slug: clase.curso_slug, nombre: clase.curso_nombre },
          obligatoriaClave: clase.obligatoria_clave ?? null,
        },
        fuente,
        // Drive no mide: no hay token, el reproductor no manda latidos.
        sesion: medible ? { token, intervaloS: INTERVALO_LATIDO_S } : null,
        progreso: progresoPublico({ proveedor, duracionS }, prog.get(id)),
      })
    }),
  )

  // ── Marcar como vista ────────────────────────────────────────────────────

  router.post(
    '/clases/:id/marca',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const id = idNumerico.parse(req.params.id)
      const { marcada } = cuerpoMarca.parse(req.body)
      const cursos = await catalogo()
      const curso = cursos.find((c) => c.modulos.some((m) => m.clases.some((cl) => cl.id === id)))
      if (!curso) throw noEncontrado()
      const idsCurso = curso.modulos.flatMap((m) => m.clases.map((cl) => cl.id))

      const antes = await progresoDe(u.id, idsCurso)
      const marcadasAntes = [...antes.values()].filter((p) => p.marcada_at).length

      if (marcada) {
        // Upsert: tocar dos veces la misma clase no puede dar error, y la
        // fecha de la primera marca se conserva.
        await db.query(
          `INSERT INTO academia_progreso (usuario_id, clase_id, marcada_at) VALUES (?, ?, ?) AS n
           ON DUPLICATE KEY UPDATE marcada_at = COALESCE(academia_progreso.marcada_at, n.marcada_at)`,
          [u.id, id, new Date(ahora())],
        )
      } else {
        // Desmarcar no borra la fila: lo abierto y lo mirado son otra señal.
        await db.query('UPDATE academia_progreso SET marcada_at = NULL WHERE usuario_id = ? AND clase_id = ?', [u.id, id])
      }

      const despues = await progresoDe(u.id, idsCurso)
      const marcadasDespues = [...despues.values()].filter((p) => p.marcada_at).length
      res.json({
        marcada,
        // El logro se avisa en el momento en que se desbloquea.
        logro: marcada ? logroNuevo(marcadasAntes, marcadasDespues, idsCurso.length) : null,
        resumen: resumenCurso(curso, despues),
      })
    }),
  )

  // ── Latido ───────────────────────────────────────────────────────────────

  /**
   * Procesa un latido dentro de una transacción. Se usa desde /latido y desde
   * /obligatorios/:clave/terminar (que manda el último tramo junto).
   */
  async function procesarLatido(datos: { token: string; segundos: number; posicion: number; duracion?: number | null }) {
    const tokenHash = hash(datos.token)

    // Freno de ráfagas en Redis, antes de tocar MySQL. Un cliente normal manda
    // 3 latidos por minuto. Sin Redis, el freno es el de abajo (1 s mínimo).
    const cuenta = await almacen.incr(`academia:latidos:${tokenHash.slice(0, 24)}`, 60)
    if (cuenta != null && cuenta > 12) throw new ErrorHttp(429, 'Demasiados latidos')

    const [previa] = await db.query<RowDataPacket[]>('SELECT usuario_id FROM academia_sesiones WHERE token_hash = ?', [
      tokenHash,
    ])
    if (!previa[0]) throw new ErrorHttp(404, 'Sesión de reproducción desconocida')
    const usuarioId = String(previa[0].usuario_id)

    return enTransaccion(db, async (c) => {
      const t = ahora()

      // Orden de bloqueo fijo (reloj de la persona → sesión) para que dos
      // latidos simultáneos de la misma persona se pongan en fila en vez de
      // trabarse. Y en fila es justamente lo que hace falta: el reloj se lee
      // y se escribe de a uno.
      await c.query('INSERT IGNORE INTO academia_reloj_usuario (usuario_id, credito_hasta) VALUES (?, ?)', [
        usuarioId,
        new Date(0),
      ])
      const [reloj] = await c.query<RowDataPacket[]>(
        'SELECT credito_hasta FROM academia_reloj_usuario WHERE usuario_id = ? FOR UPDATE',
        [usuarioId],
      )
      const [sesiones] = await c.query<RowDataPacket[]>(
        `SELECT s.*, cl.proveedor, cl.duracion_s, cl.obligatoria_clave, cl.obligatoria_version
         FROM academia_sesiones s JOIN academia_clases cl ON cl.id = s.clase_id
         WHERE s.token_hash = ? FOR UPDATE`,
        [tokenHash],
      )
      const s = sesiones[0]
      if (!s) throw new ErrorHttp(404, 'Sesión de reproducción desconocida')
      if (sesionVencida(ms(s.iniciada_at)!, t)) throw new ErrorHttp(410, 'La sesión venció: volvé a abrir la clase')
      if (!esMedible(s.proveedor as Proveedor)) throw new ErrorHttp(409, 'Esta clase no mide reproducción')

      const ultimoMs = ms(s.ultimo_latido_at)!
      // Freno sin Redis: dos latidos de la misma sesión en menos de un segundo
      // no son un reproductor, son un script.
      if (num(s.latidos) > 0 && t - ultimoMs < 1000) throw new ErrorHttp(429, 'Demasiados latidos')

      const r = calcularLatido({
        ahoraMs: t,
        ultimoLatidoSesionMs: ultimoMs,
        creditoHastaMs: ms(reloj[0]?.credito_hasta) ?? 0,
        pedidoS: datos.segundos,
      })

      const claseId = num(s.clase_id)
      const [progFilas] = await c.query<RowDataPacket[]>(
        'SELECT duracion_detectada FROM academia_progreso WHERE usuario_id = ? AND clase_id = ? FOR UPDATE',
        [usuarioId, claseId],
      )
      const informada = duracionInformada(datos.duracion)
      const duracion = duracionConfiable(s.duracion_s, informada ?? progFilas[0]?.duracion_detectada)
      const posicion = posicionAcotada(datos.posicion, duracion)

      await c.query(
        `UPDATE academia_sesiones
         SET ultimo_latido_at = ?, latidos = latidos + 1,
             segundos_aceptados = segundos_aceptados + ?, segundos_rechazados = segundos_rechazados + ?,
             ultima_posicion = ?
         WHERE id = ?`,
        [new Date(t), r.aceptadosS, r.rechazadosS, posicion, s.id],
      )
      await c.query('UPDATE academia_reloj_usuario SET credito_hasta = ? WHERE usuario_id = ?', [
        new Date(r.nuevoCreditoHastaMs),
        usuarioId,
      ])
      // · La posición máxima nunca baja (GREATEST).
      // · La duración detectada solo se escribe si vino un número: no se pisa
      //   lo conocido con nada (COALESCE con null).
      // Con el alias `AS n`, las columnas de la fila existente van calificadas
      // con el nombre de la tabla: sin calificar, MySQL las da por ambiguas.
      await c.query(
        `INSERT INTO academia_progreso (usuario_id, clase_id, segundos_mirados, posicion_max, ultima_posicion, duracion_detectada)
         VALUES (?, ?, ?, ?, ?, ?) AS n
         ON DUPLICATE KEY UPDATE
           segundos_mirados = academia_progreso.segundos_mirados + n.segundos_mirados,
           posicion_max = GREATEST(academia_progreso.posicion_max, n.posicion_max),
           ultima_posicion = n.ultima_posicion,
           duracion_detectada = COALESCE(n.duracion_detectada, academia_progreso.duracion_detectada)`,
        [usuarioId, claseId, r.aceptadosS, posicion, posicion, informada],
      )

      const [despues] = await c.query<RowDataPacket[]>(
        'SELECT * FROM academia_progreso WHERE usuario_id = ? AND clase_id = ?',
        [usuarioId, claseId],
      )
      const p = despues[0]!
      const estado = clasificarClase({
        medible: true,
        aperturas: num(p.aperturas),
        segundosMirados: num(p.segundos_mirados),
        posicionMax: num(p.posicion_max),
        duracionS: duracionConfiable(s.duracion_s, p.duracion_detectada),
      })
      if (estado === 'completa' && !p.completada_at) {
        await c.query('UPDATE academia_progreso SET completada_at = ? WHERE usuario_id = ? AND clase_id = ?', [
          new Date(t),
          usuarioId,
          claseId,
        ])
      }

      return {
        sesionId: num(s.id),
        usuarioId,
        claseId,
        obligatoriaClave: (s.obligatoria_clave as string | null) ?? null,
        obligatoriaVersion: num(s.obligatoria_version),
        duracionCatalogoS: num(s.duracion_s) > 0 ? num(s.duracion_s) : null,
        segundosSesion: num(s.segundos_aceptados) + r.aceptadosS,
        aceptados: r.aceptadosS,
        rechazados: r.rechazadosS,
        estado,
      }
    })
  }

  /** El cuerpo del latido llega como JSON o como text/plain (sendBeacon). */
  function cuerpoDeLatido(req: Request): unknown {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body)
      } catch {
        throw new ErrorHttp(400, 'Latido ilegible')
      }
    }
    return req.body
  }

  // Este endpoint NO pasa por obtenerUsuario: se autentica con el token de la
  // sesión de reproducción. Es a propósito. El último tramo se manda con
  // navigator.sendBeacon al cerrar la pestaña (un fetch normal se cancela, y
  // ese tramo suele ser el más largo), y sendBeacon no puede mandar el header
  // Authorization. Con text/plain, además, no hay preflight de CORS.
  router.post(
    '/latido',
    express.text({ type: ['text/plain', 'text/*'], limit: '4kb' }),
    envolver(async (req, res) => {
      const datos = cuerpoLatido.parse(cuerpoDeLatido(req))
      const r = await procesarLatido(datos)
      res.json({ aceptados: r.aceptados, rechazados: r.rechazados, estado: r.estado })
    }),
  )

  // ── Videos obligatorios ──────────────────────────────────────────────────

  async function obligatorio(clave: string) {
    const [filas] = await db.query<RowDataPacket[]>(
      'SELECT id, nombre, duracion_s, obligatoria_version FROM academia_clases WHERE obligatoria_clave = ?',
      [clave],
    )
    return filas[0]
  }

  router.get(
    '/obligatorios/:clave',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const clave = claveObligatorio.parse(req.params.clave)
      const ob = await obligatorio(clave)
      if (!ob) throw noEncontrado()
      const [vistos] = await db.query<RowDataPacket[]>(
        'SELECT 1 FROM academia_obligatorios_vistos WHERE usuario_id = ? AND clave = ? AND version = ?',
        [u.id, clave, num(ob.obligatoria_version)],
      )
      res.json({ pendiente: vistos.length === 0, claseId: num(ob.id), nombre: ob.nombre, duracionS: num(ob.duracion_s) })
    }),
  )

  router.post(
    '/obligatorios/:clave/terminar',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const clave = claveObligatorio.parse(req.params.clave)
      const datos = cuerpoLatido.parse(req.body)
      // El último tramo viaja con este pedido: así no depende de que el latido
      // anterior haya llegado antes que el botón "terminé".
      const r = await procesarLatido(datos).catch((e) => {
        // Un 429 acá solo significa que el latido regular acaba de entrar.
        if (e instanceof ErrorHttp && e.status === 429) return null
        throw e
      })
      const [sesiones] = await db.query<RowDataPacket[]>(
        `SELECT s.id, s.usuario_id, s.segundos_aceptados, cl.obligatoria_clave, cl.obligatoria_version, cl.duracion_s
         FROM academia_sesiones s JOIN academia_clases cl ON cl.id = s.clase_id WHERE s.token_hash = ?`,
        [hash(datos.token)],
      )
      const s = sesiones[0]
      // La sesión tiene que ser de esta persona y de ESTE video.
      if (!s || String(s.usuario_id) !== u.id || s.obligatoria_clave !== clave) throw noEncontrado()

      // Se verifica contra lo que el SERVIDOR aceptó en esta sesión, no
      // contra lo que diga el navegador, y contra la duración del catálogo.
      const segundos = r?.segundosSesion ?? num(s.segundos_aceptados)
      const duracion = num(s.duracion_s)
      if (!obligatorioCumplido(segundos, duracion)) {
        throw new ErrorHttp(422, 'Todavía no se reprodujo el video entero', {
          faltanS: Math.max(0, duracion - 3 - segundos),
        })
      }
      await db.query(
        `INSERT IGNORE INTO academia_obligatorios_vistos (usuario_id, clave, version, sesion_id, segundos)
         VALUES (?, ?, ?, ?, ?)`,
        [u.id, clave, num(s.obligatoria_version), num(s.id), segundos],
      )
      res.json({ ok: true })
    }),
  )

  // ── Prácticas ────────────────────────────────────────────────────────────

  const enunciadoDe = (n: number) => enunciados.find((e) => e.numero === n)

  function practicaPublica(f: RowDataPacket | undefined) {
    if (!f) return null
    return {
      estado: f.estado as EstadoPractica,
      trabajoRef: f.trabajo_ref ?? null,
      explicacion: f.explicacion ?? '',
      devolucion: f.devolucion ?? null,
      revisadoAt: f.revisado_at ?? null,
      entregadoAt: f.entregado_at ?? null,
      actualizadoAt: f.actualizado_at ?? null,
    }
  }

  router.get(
    '/practicas',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const [filas] = await db.query<RowDataPacket[]>('SELECT * FROM academia_practicas WHERE usuario_id = ?', [u.id])
      const porNumero = new Map(filas.map((f) => [num(f.ejercicio), f]))
      res.json({
        minExplicacion,
        practicas: enunciados.map((e) => ({ enunciado: e, entrega: practicaPublica(porNumero.get(e.numero)) })),
      })
    }),
  )

  router.put(
    '/practicas/:n',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const n = idNumerico.parse(req.params.n)
      if (!enunciadoDe(n)) throw noEncontrado()
      const datos = cuerpoBorrador.parse(req.body)
      const fila = await enTransaccion(db, async (c) => {
        const [previas] = await c.query<RowDataPacket[]>(
          'SELECT * FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ? FOR UPDATE',
          [u.id, n],
        )
        const previa = previas[0]
        const regla = puedeEditar((previa?.estado as EstadoPractica) ?? null)
        if (!regla.ok) throw new ErrorHttp(regla.status, regla.error)
        // Lo que no vino en el cuerpo no se toca.
        const trabajoRef = datos.trabajoRef !== undefined ? datos.trabajoRef || null : previa?.trabajo_ref ?? null
        const explicacion = datos.explicacion !== undefined ? datos.explicacion ?? '' : previa?.explicacion ?? null
        // La fila nace acá, cuando la persona arranca. En 'rehacer' se queda
        // en 'rehacer' (con su devolución a la vista) hasta que vuelva a entregar.
        await c.query(
          `INSERT INTO academia_practicas (usuario_id, ejercicio, trabajo_ref, explicacion, estado)
           VALUES (?, ?, ?, ?, 'pendiente') AS n
           ON DUPLICATE KEY UPDATE trabajo_ref = n.trabajo_ref, explicacion = n.explicacion`,
          [u.id, n, trabajoRef, explicacion],
        )
        const [f] = await c.query<RowDataPacket[]>(
          'SELECT * FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ?',
          [u.id, n],
        )
        return f[0]
      })
      res.json({ entrega: practicaPublica(fila) })
    }),
  )

  router.post(
    '/practicas/:n/entregar',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const n = idNumerico.parse(req.params.n)
      const enunciado = enunciadoDe(n)
      if (!enunciado) throw noEncontrado()
      const datos = cuerpoEntrega.parse(req.body)
      const fila = await enTransaccion(db, async (c) => {
        const [previas] = await c.query<RowDataPacket[]>(
          'SELECT estado FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ? FOR UPDATE',
          [u.id, n],
        )
        const regla = validarEntrega(
          (previas[0]?.estado as EstadoPractica) ?? null,
          { trabajoRef: datos.trabajoRef ?? null, explicacion: datos.explicacion },
          { requiereTrabajo: enunciado.requiereTrabajo, minExplicacion },
        )
        if (!regla.ok) throw new ErrorHttp(regla.status, regla.error)
        // Rehacer PISA la entrega anterior. La devolución anterior queda a la
        // vista del corrector hasta que corrija de nuevo.
        await c.query(
          `INSERT INTO academia_practicas (usuario_id, ejercicio, trabajo_ref, explicacion, estado, entregado_at)
           VALUES (?, ?, ?, ?, 'entregado', ?) AS n
           ON DUPLICATE KEY UPDATE trabajo_ref = n.trabajo_ref, explicacion = n.explicacion,
             estado = 'entregado', entregado_at = n.entregado_at`,
          [u.id, n, datos.trabajoRef || null, datos.explicacion.trim(), new Date(ahora())],
        )
        const [f] = await c.query<RowDataPacket[]>(
          'SELECT * FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ?',
          [u.id, n],
        )
        return f[0]
      })
      res.json({ entrega: practicaPublica(fila) })
    }),
  )

  async function alcanceOFin(u: UsuarioAcademia) {
    const equipos = await equiposDe(u)
    const alcance = alcanceDe(u, equipos)
    // 404 y no 403: a quien no tiene tablero ni se le confirma que existe.
    if (!alcance) throw noEncontrado()
    return { alcance, equipos }
  }

  router.get(
    '/practicas/corregir',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const { alcance } = await alcanceOFin(u)
      const personas = (await personasDe(alcance, u, true)).filter((p) => p.usuarioId !== u.id)
      if (personas.length === 0) {
        res.json({ entregas: [] })
        return
      }
      const nombres = new Map(personas.map((p) => [p.usuarioId, p.nombre]))
      const [filas] = await db.query<RowDataPacket[]>(
        `SELECT * FROM academia_practicas WHERE usuario_id IN (?)
         ORDER BY estado = 'entregado' DESC, entregado_at ASC, actualizado_at DESC`,
        [[...nombres.keys()]],
      )
      res.json({
        entregas: filas.map((f) => ({
          usuarioId: String(f.usuario_id),
          nombre: nombres.get(String(f.usuario_id)) || `Sin nombre (${f.usuario_id})`,
          ejercicio: num(f.ejercicio),
          titulo: enunciadoDe(num(f.ejercicio))?.titulo ?? `Ejercicio ${f.ejercicio}`,
          ...practicaPublica(f),
        })),
      })
    }),
  )

  router.post(
    '/practicas/corregir',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const { alcance, equipos } = await alcanceOFin(u)
      const datos = cuerpoCorreccion.parse(req.body)

      // El alumno tiene que estar en el alcance de quien corrige. Se busca en
      // la misma fuente que usa el tablero, así no hay dos verdades.
      const personas = await personasDe(alcance, u, true)
      const alumno = personas.find((p) => p.usuarioId === datos.usuarioId)
      if (!alumno || !puedeCorregir(u, equipos, alumno)) throw noEncontrado()

      const fila = await enTransaccion(db, async (c) => {
        const [previas] = await c.query<RowDataPacket[]>(
          'SELECT estado FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ? FOR UPDATE',
          [datos.usuarioId, datos.ejercicio],
        )
        const regla = validarCorreccion((previas[0]?.estado as EstadoPractica) ?? null, {
          resultado: datos.resultado,
          devolucion: datos.devolucion ?? null,
        })
        if (!regla.ok) throw new ErrorHttp(regla.status, regla.error)
        await c.query<ResultSetHeader>(
          `UPDATE academia_practicas
           SET estado = ?, devolucion = ?, revisado_por = ?, revisado_at = ?
           WHERE usuario_id = ? AND ejercicio = ?`,
          [datos.resultado, datos.devolucion?.trim() || null, u.id, new Date(ahora()), datos.usuarioId, datos.ejercicio],
        )
        const [f] = await c.query<RowDataPacket[]>(
          'SELECT * FROM academia_practicas WHERE usuario_id = ? AND ejercicio = ?',
          [datos.usuarioId, datos.ejercicio],
        )
        return f[0]
      })
      res.json({ entrega: practicaPublica(fila) })
    }),
  )

  // ── Tablero ──────────────────────────────────────────────────────────────

  router.get(
    '/tablero',
    envolver(async (req, res) => {
      const u = await usuarioDe(req)
      const { alcance } = await alcanceOFin(u)
      const incluirNoSeguidos = req.query.todos === '1'
      // El filtro por equipo se hace ACÁ, en el servidor, armando la lista de
      // personas. La vista recibe solo lo que puede ver.
      const personas = await personasDe(alcance, u, incluirNoSeguidos)
      const ids = personas.map((p) => p.usuarioId)

      let progreso: ProgresoTablero[] = []
      let practicas: { usuarioId: string; estado: EstadoPractica }[] = []
      if (ids.length > 0) {
        const [filasProg] = await db.query<RowDataPacket[]>(
          `SELECT p.*, cl.proveedor, cl.duracion_s
           FROM academia_progreso p JOIN academia_clases cl ON cl.id = p.clase_id
           WHERE p.usuario_id IN (?)`,
          [ids],
        )
        progreso = filasProg.map((f) => ({
          usuarioId: String(f.usuario_id),
          claseId: num(f.clase_id),
          marcada: !!f.marcada_at,
          aperturas: num(f.aperturas),
          segundosMirados: num(f.segundos_mirados),
          posicionMax: num(f.posicion_max),
          duracionS: duracionConfiable(f.duracion_s, f.duracion_detectada),
          duracionCatalogoS: num(f.duracion_s) > 0 ? num(f.duracion_s) : null,
          medible: esMedible(f.proveedor as Proveedor),
          ultimaAperturaMs: ms(f.ultima_apertura_at),
        }))
        const [filasPract] = await db.query<RowDataPacket[]>(
          'SELECT usuario_id, estado FROM academia_practicas WHERE usuario_id IN (?)',
          [ids],
        )
        practicas = filasPract.map((f) => ({ usuarioId: String(f.usuario_id), estado: f.estado as EstadoPractica }))
      }

      const filas = armarTablero(personas, progreso, practicas)
      res.set('Cache-Control', 'no-store')
      res.json({
        alcance: alcance.todos ? 'todos' : 'equipo',
        incluyeNoSeguidos: incluirNoSeguidos,
        totalPracticas: enunciados.length,
        // Para el botón "Corregir N prácticas" (sin contar las propias).
        practicasACorregir: practicas.filter((p) => p.estado === 'entregado' && p.usuarioId !== u.id).length,
        nadieAbrio: filas.every((f) => f.abiertas === 0),
        nadieEntrego: practicas.every((p) => p.estado === 'pendiente'),
        filas: filas.map((f) => ({
          ...f,
          miradoTexto: f.mirado > 0 ? horasDeFormacion(f.mirado) : null,
          marcadoTexto: f.segundosMarcados > 0 ? horasDeFormacion(f.segundosMarcados) : null,
        })),
      })
    }),
  )

  // ── Errores ──────────────────────────────────────────────────────────────

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErrorHttp) {
      res.status(err.status).json({ error: err.message, ...err.extra })
      return
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Datos inválidos', detalle: err.flatten() })
      return
    }
    if (err instanceof ErrorVideo) {
      res.status(422).json({ error: err.message })
      return
    }
    const tipo = (err as { type?: string }).type
    if (tipo === 'entity.parse.failed' || tipo === 'entity.too.large') {
      res.status(400).json({ error: 'Cuerpo inválido' })
      return
    }
    registrar('Error inesperado', err)
    // Nada del error interno (SQL, stack) sale hacia el navegador.
    res.status(500).json({ error: 'Error interno de la academia' })
  })

  return router
}

// ----------------------------------------------------------------------------
// Para llamar desde el sistema
// ----------------------------------------------------------------------------

/**
 * Llamar cuando se BORRA un trabajo que estaba enganchado a una práctica.
 * La entrega vuelve a 'pendiente' (ya no hay qué corregir) pero conserva la
 * devolución: lo que el corrector escribió sigue sirviendo.
 */
export async function trabajoDePracticaBorrado(db: Pool, trabajoRef: string): Promise<number> {
  const [r] = await db.query<ResultSetHeader>(
    `UPDATE academia_practicas SET trabajo_ref = NULL, estado = 'pendiente', entregado_at = NULL
     WHERE trabajo_ref = ?`,
    [trabajoRef],
  )
  return r.affectedRows
}
