// Proveedores de video (backend/src/logica/video.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto'
import { construirFuente, esMedible, normalizarRefVideo, tokenBunny, tokenMux } from '../src/logica/video'

test('YouTube: acepta id y los formatos de link habituales', () => {
  const id = 'dQw4w9WgXcQ'
  for (const v of [
    id,
    `https://www.youtube.com/watch?v=${id}&t=10`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
    `https://youtube.com/shorts/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
  ]) {
    assert.equal(normalizarRefVideo('youtube', v), id, v)
  }
  assert.equal(normalizarRefVideo('youtube', 'https://evil.example.com/watch?v=dQw4w9WgXcQ'), null)
  assert.equal(normalizarRefVideo('youtube', 'corto'), null)
})

test('Drive: id o link de compartir', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
  assert.equal(normalizarRefVideo('drive', `https://drive.google.com/file/d/${id}/view?usp=sharing`), id)
  assert.equal(normalizarRefVideo('drive', `https://drive.google.com/open?id=${id}`), id)
  assert.equal(normalizarRefVideo('drive', `https://otro.com/file/d/${id}/view`), null)
})

test('Bunny exige GUID; Mux, playback id alfanumérico', () => {
  assert.ok(normalizarRefVideo('bunny', '3F2504E0-4F89-11D3-9A0C-0305E82C3301'))
  assert.equal(normalizarRefVideo('bunny', '../../etc/passwd'), null)
  assert.ok(normalizarRefVideo('mux', 'a1B2c3D4e5F6g7H8'))
  assert.equal(normalizarRefVideo('mux', 'abc/../x'), null)
})

test('directo: solo https', () => {
  assert.ok(normalizarRefVideo('directo', 'https://cdn.example.com/clase.mp4'))
  assert.equal(normalizarRefVideo('directo', 'http://cdn.example.com/clase.mp4'), null)
  assert.equal(normalizarRefVideo('directo', 'javascript:alert(1)'), null)
})

test('directo: respeta la lista de hosts permitidos', () => {
  assert.throws(() =>
    construirFuente('directo', 'https://otro.example.com/a.mp4', { hostsDirectos: ['cdn.example.com'] }, 0),
  )
  const f = construirFuente('directo', 'https://cdn.example.com/a.m3u8', { hostsDirectos: ['cdn.example.com'] }, 0)
  assert.equal(f.proveedor === 'directo' && f.esHls, true)
})

test('Drive no es medible; el resto sí', () => {
  assert.equal(esMedible('drive'), false)
  for (const p of ['youtube', 'bunny', 'mux', 'directo'] as const) assert.equal(esMedible(p), true)
  const f = construirFuente('drive', '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', {}, 0)
  assert.equal(f.medible, false)
})

test('Bunny: token = sha256(clave + video + vencimiento) y va en la URL', () => {
  const guid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  const esperado = createHash('sha256').update('clave' + guid + '1000').digest('hex')
  assert.equal(tokenBunny('clave', guid, 1000), esperado)
  const f = construirFuente('bunny', guid, { bunny: { libraryId: '123', tokenKey: 'clave' }, vidaUrlFirmadaS: 1000 }, 0)
  assert.ok(f.proveedor === 'bunny' && f.embedUrl.includes(`token=${esperado}`) && f.embedUrl.includes('expires=1000'))
})

test('Bunny sin librería configurada falla con mensaje claro', () => {
  assert.throws(() => construirFuente('bunny', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', {}, 0), /librería/)
})

test('Mux: JWT RS256 verificable con la clave pública', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const jwt = tokenMux({ playbackId: 'abc123def456', signingKeyId: 'kid1', privateKeyBase64: Buffer.from(pem).toString('base64'), venceUnix: 999 })
  const [h, p, firma] = jwt.split('.')
  const payload = JSON.parse(Buffer.from(p!, 'base64url').toString())
  assert.deepEqual(payload, { sub: 'abc123def456', aud: 'v', exp: 999, kid: 'kid1' })
  assert.equal(JSON.parse(Buffer.from(h!, 'base64url').toString()).alg, 'RS256')
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(firma!, 'base64url'))
  assert.equal(ok, true)
})
