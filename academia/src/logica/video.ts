// ============================================================================
// De dónde sale el video de cada clase y qué recibe el reproductor.
//
// El backend NUNCA descarga ni pide nada a estas direcciones: solo arma la
// URL de embed o de reproducción. Igual se valida cada referencia con una
// whitelist estricta por proveedor, porque lo que se devuelve termina en un
// <iframe src> o un <video src> del navegador: una referencia mal cargada (o
// maliciosa, si el catálogo algún día se edita desde una pantalla) no puede
// convertirse en un link a cualquier lado.
//
// Qué se puede medir con cada uno:
//   youtube  → sí (IFrame Player API: estado y currentTime). El video queda
//              accesible para quien tenga el link: usar "no listado".
//   bunny    → sí (player.js del embed: play/pause/timeupdate). URL firmada.
//   mux      → sí (HLS en <video> con hls.js). URL firmada.
//   directo  → sí (<video> HTML5). El archivo queda público en su URL.
//   drive    → NO. El embed de Drive no expone estado ni posición. Solo se
//              registra "abierta" y "marcada".
// ============================================================================

import { createHash, createSign } from 'node:crypto'

export type Proveedor = 'youtube' | 'bunny' | 'mux' | 'directo' | 'drive'

export const PROVEEDORES_MEDIBLES: ReadonlySet<Proveedor> = new Set(['youtube', 'bunny', 'mux', 'directo'])
export const esMedible = (p: Proveedor) => PROVEEDORES_MEDIBLES.has(p)

const RE_YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const RE_DRIVE_ID = /^[A-Za-z0-9_-]{20,100}$/
const RE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_MUX_ID = /^[A-Za-z0-9]{10,100}$/
const RE_BUNNY_LIBRERIA = /^\d{1,12}$/

/**
 * Lleva lo que se cargó en el catálogo (id o link pegado) al id limpio.
 * Devuelve null si no es válido para ese proveedor.
 */
export function normalizarRefVideo(proveedor: Proveedor, entrada: string): string | null {
  const v = (entrada ?? '').trim()
  if (!v) return null

  switch (proveedor) {
    case 'youtube': {
      if (RE_YOUTUBE_ID.test(v)) return v
      const u = parsearUrl(v)
      if (!u) return null
      const host = u.hostname.replace(/^www\.|^m\./, '')
      let id: string | null = null
      if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v')
        else {
          const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
          id = m?.[1] ?? null
        }
      }
      return id && RE_YOUTUBE_ID.test(id) ? id : null
    }
    case 'drive': {
      if (RE_DRIVE_ID.test(v)) return v
      const u = parsearUrl(v)
      if (!u || u.hostname !== 'drive.google.com') return null
      const m = u.pathname.match(/\/file\/d\/([^/]+)/)
      const id = m?.[1] ?? u.searchParams.get('id')
      return id && RE_DRIVE_ID.test(id) ? id : null
    }
    case 'bunny':
      return RE_GUID.test(v) ? v.toLowerCase() : null
    case 'mux':
      return RE_MUX_ID.test(v) ? v : null
    case 'directo': {
      const u = parsearUrl(v)
      // Solo https: un `javascript:` o un `http:` en un <video src> no tiene
      // por qué existir en un catálogo interno.
      return u && u.protocol === 'https:' ? u.toString() : null
    }
  }
}

function parsearUrl(v: string): URL | null {
  try {
    return new URL(v)
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// Firmas
// ----------------------------------------------------------------------------

/**
 * Token de Bunny Stream para el embed:
 *   SHA256_HEX(clave_de_seguridad + video_id + vencimiento_unix)
 * (Bunny → Stream → Librería → Security → Embed view token authentication)
 */
export function tokenBunny(claveSeguridad: string, videoId: string, venceUnix: number): string {
  return createHash('sha256').update(claveSeguridad + videoId + String(venceUnix)).digest('hex')
}

const base64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/**
 * JWT RS256 de Mux para una URL de reproducción firmada.
 * La clave privada que da Mux viene en base64 (es un PEM codificado).
 * Se firma con node:crypto para no sumar una dependencia por esto.
 */
export function tokenMux(opciones: {
  playbackId: string
  signingKeyId: string
  privateKeyBase64: string
  venceUnix: number
}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: opciones.signingKeyId }
  const payload = { sub: opciones.playbackId, aud: 'v', exp: opciones.venceUnix, kid: opciones.signingKeyId }
  const cuerpo = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const pem = Buffer.from(opciones.privateKeyBase64, 'base64').toString('utf8')
  const firma = createSign('RSA-SHA256').update(cuerpo).sign(pem)
  return `${cuerpo}.${base64url(firma)}`
}

// ----------------------------------------------------------------------------
// Lo que recibe el reproductor
// ----------------------------------------------------------------------------

export interface ConfigVideo {
  bunny?: {
    libraryId: string
    /** Clave de "Embed view token authentication". Sin ella, el embed va sin firmar. */
    tokenKey?: string
  }
  mux?: {
    signingKeyId: string
    privateKeyBase64: string
  }
  /** Si se define, los videos `directo` solo pueden salir de estos hosts. */
  hostsDirectos?: string[]
  /** Cuánto vive una URL firmada. Default 4 h: alcanza para una clase larga con pausas. */
  vidaUrlFirmadaS?: number
}

export type FuenteVideo =
  | { proveedor: 'youtube'; medible: true; youtubeId: string }
  | { proveedor: 'bunny'; medible: true; embedUrl: string }
  | { proveedor: 'mux'; medible: true; src: string; esHls: true }
  | { proveedor: 'directo'; medible: true; src: string; esHls: boolean }
  | { proveedor: 'drive'; medible: false; embedUrl: string }

export class ErrorVideo extends Error {}

export function construirFuente(
  proveedor: Proveedor,
  ref: string,
  config: ConfigVideo,
  ahoraMs: number,
): FuenteVideo {
  const id = normalizarRefVideo(proveedor, ref)
  if (!id) throw new ErrorVideo('La clase tiene el video mal cargado')
  const vence = Math.floor(ahoraMs / 1000) + (config.vidaUrlFirmadaS ?? 4 * 3600)

  switch (proveedor) {
    case 'youtube':
      return { proveedor, medible: true, youtubeId: id }

    case 'drive':
      return { proveedor, medible: false, embedUrl: `https://drive.google.com/file/d/${id}/preview` }

    case 'bunny': {
      const lib = config.bunny?.libraryId ?? ''
      if (!RE_BUNNY_LIBRERIA.test(lib)) throw new ErrorVideo('Falta configurar la librería de Bunny')
      const url = new URL(`https://iframe.mediadelivery.net/embed/${lib}/${id}`)
      if (config.bunny?.tokenKey) {
        url.searchParams.set('token', tokenBunny(config.bunny.tokenKey, id, vence))
        url.searchParams.set('expires', String(vence))
      }
      url.searchParams.set('autoplay', 'false')
      url.searchParams.set('preload', 'true')
      url.searchParams.set('responsive', 'true')
      return { proveedor, medible: true, embedUrl: url.toString() }
    }

    case 'mux': {
      const url = new URL(`https://stream.mux.com/${id}.m3u8`)
      if (config.mux) {
        url.searchParams.set(
          'token',
          tokenMux({
            playbackId: id,
            signingKeyId: config.mux.signingKeyId,
            privateKeyBase64: config.mux.privateKeyBase64,
            venceUnix: vence,
          }),
        )
      }
      return { proveedor, medible: true, src: url.toString(), esHls: true }
    }

    case 'directo': {
      const u = new URL(id)
      const hosts = config.hostsDirectos?.filter(Boolean) ?? []
      if (hosts.length > 0 && !hosts.includes(u.hostname)) {
        throw new ErrorVideo('El video de esta clase sale de un dominio no permitido')
      }
      return { proveedor, medible: true, src: u.toString(), esHls: /\.m3u8$/i.test(u.pathname) }
    }
  }
}
