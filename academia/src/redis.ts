// ============================================================================
// Redis, opcional.
//
// Se usa para dos cosas que no son la fuente de verdad:
//   · Frenar ráfagas de latidos ANTES de tocar MySQL (un cliente normal manda
//     3 por minuto; más de 12 en un minuto por sesión es un script).
//   · Cachear el catálogo publicado 60 s, que es lo que se lee en cada visita.
//
// El tiempo mirado NO se acumula en Redis para bajarlo después: cada latido
// es un upsert de una fila, barato para MySQL, y acumular afuera significa
// perder minutos reales si Redis se reinicia y duplicar la lógica de topes.
//
// Si Redis no está o falla, todo sigue andando solo con MySQL: cada llamada
// atrapa su error y se comporta como si no hubiera Redis.
//
// Acepta ioredis o node-redis (v4+) sin depender de ninguno: se habla con
// comandos crudos.
// ============================================================================

export interface AlmacenRapido {
  get(clave: string): Promise<string | null>
  setConVencimiento(clave: string, valor: string, segundos: number): Promise<void>
  incrConVencimiento(clave: string, segundos: number): Promise<number>
  del(clave: string): Promise<void>
}

type ClienteIoredis = { call: (...args: (string | number)[]) => Promise<unknown> }
type ClienteNodeRedis = { sendCommand: (args: string[]) => Promise<unknown> }

/** Envuelve un cliente de ioredis o de node-redis. */
export function adaptarRedis(cliente: unknown): AlmacenRapido | null {
  if (!cliente || typeof cliente !== 'object') return null
  let crudo: (args: string[]) => Promise<unknown>
  // ioredis primero: también tiene `sendCommand`, pero con otra firma.
  if (typeof (cliente as ClienteIoredis).call === 'function') {
    const c = cliente as ClienteIoredis
    crudo = (args) => c.call(...args)
  } else if (typeof (cliente as ClienteNodeRedis).sendCommand === 'function') {
    const c = cliente as ClienteNodeRedis
    crudo = (args) => c.sendCommand(args)
  } else {
    return null
  }

  return {
    async get(clave) {
      const v = await crudo(['GET', clave])
      return v == null ? null : String(v)
    },
    async setConVencimiento(clave, valor, segundos) {
      await crudo(['SET', clave, valor, 'EX', String(segundos)])
    },
    async incrConVencimiento(clave, segundos) {
      const n = Number(await crudo(['INCR', clave]))
      // Solo al crear la clave: si no, la ventana se correría con cada latido.
      if (n === 1) await crudo(['EXPIRE', clave, String(segundos)])
      return n
    },
    async del(clave) {
      await crudo(['DEL', clave])
    },
  }
}

/** Un almacén que nunca falla hacia afuera. */
export function almacenSeguro(a: AlmacenRapido | null, alFallar?: (e: unknown) => void) {
  const intentar = async <T>(fn: () => Promise<T>, siFalla: T): Promise<T> => {
    if (!a) return siFalla
    try {
      return await fn()
    } catch (e) {
      alFallar?.(e)
      return siFalla
    }
  }
  return {
    disponible: !!a,
    get: (k: string) => intentar(() => a!.get(k), null),
    set: (k: string, v: string, s: number) => intentar(() => a!.setConVencimiento(k, v, s), undefined),
    /** null = no se pudo contar (sin Redis): el llamador decide sin el límite. */
    incr: (k: string, s: number) => intentar<number | null>(() => a!.incrConVencimiento(k, s), null),
    del: (k: string) => intentar(() => a!.del(k), undefined),
  }
}

export type AlmacenSeguro = ReturnType<typeof almacenSeguro>
