const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const { verifyToken } = require('@clerk/backend');
const { z } = require('zod');
const {
    academiaRouter,
    trabajoDePracticaBorrado,
    normalizarRefVideo,
    adaptarRedis
} = require('./cjs/index');
const { ENUNCIADOS_COLABORATIUM } = require('./enunciadosColaboratium');
const { seedCursosColaboratium } = require('./seedCursosColaboratium');

let academiaPool = null;
let redisClient = null;
let coreRouterRef = null;

function getAcademiaPool() {
    if (academiaPool) return academiaPool;
    academiaPool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'routhagent',
        timezone: 'Z',
        waitForConnections: true,
        connectionLimit: 6,
        queueLimit: 0,
        multipleStatements: true
    });
    return academiaPool;
}

function getOptionalRedis() {
    if (redisClient) return redisClient;
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    if (!url || process.env.ACADEMIA_DISABLE_REDIS === '1') return null;

    const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => (times > 1 ? null : 500)
    });
    client.on('error', () => {
        // Silencioso: router.ts usa MySQL como respaldo automático ante fallos de Redis.
    });
    client.connect().catch(() => {});

    const rawStore = adaptarRedis(client);
    if (!rawStore) return null;

    redisClient = {
        get: (k) => (client.status === 'ready' ? rawStore.get(k) : Promise.resolve(null)),
        setConVencimiento: (k, v, s) => (client.status === 'ready' ? rawStore.setConVencimiento(k, v, s) : Promise.resolve()),
        incrConVencimiento: (k, s) => (client.status === 'ready' ? rawStore.incrConVencimiento(k, s) : Promise.resolve(1)),
        del: (k) => (client.status === 'ready' ? rawStore.del(k) : Promise.resolve())
    };
    return redisClient;
}

async function initAcademiaSchema(pool) {
    const sqlPath = path.join(__dirname, 'sql', '001_academia.sql');
    const rawSql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(rawSql);
}

function parsePrivileges(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function mapRouthRoleToAcademia(rolNombre = '', privilegiosRaw = null) {
    const role = String(rolNombre || '').toLowerCase().trim();
    const privs = parsePrivileges(privilegiosRaw);

    if (
        ['master', 'main', 'admin', 'gerencia', 'director', 'team'].includes(role) ||
        privs.can_manage_users === true
    ) {
        return 'admin';
    }
    if (role.includes('lider')) {
        return 'lider';
    }
    return 'vendedor';
}

function buildDisplayName(userRow) {
    const full = `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim();
    return full || userRow.email || userRow.clerk_id;
}

function resolveUserTeamId(userRow, rol, assignedLeaderClerkId) {
    if (rol === 'lider') {
        return `lider_${userRow.clerk_id}`.slice(0, 64);
    }
    if (assignedLeaderClerkId) {
        return `lider_${assignedLeaderClerkId}`.slice(0, 64);
    }
    return userRow.codigo_empresa ? String(userRow.codigo_empresa).slice(0, 64) : null;
}

async function fetchAssignedLeaderClerkMap(mainPool) {
    const [users] = await mainPool.query('SELECT id, clerk_id, rol_id FROM users WHERE clerk_id IS NOT NULL AND clerk_id <> ""');
    const userById = new Map(users.map((u) => [Number(u.id), u.clerk_id]));

    const [contactsWithLeader] = await mainPool.query(`
        SELECT email, usuario_asignado_id, lider_id
        FROM contactos
        WHERE lider_id IS NOT NULL
    `);

    const emailToLeaderClerk = new Map();
    const clerkToLeaderClerk = new Map();
    for (const c of contactsWithLeader) {
        const leaderClerkId = userById.get(Number(c.lider_id));
        if (!leaderClerkId) continue;
        if (c.email) emailToLeaderClerk.set(String(c.email).toLowerCase().trim(), leaderClerkId);
        if (c.usuario_asignado_id) clerkToLeaderClerk.set(String(c.usuario_asignado_id), leaderClerkId);
    }
    return { emailToLeaderClerk, clerkToLeaderClerk };
}

async function resolveTeamContextForUsers(mainPool) {
    const [users] = await mainPool.query(`
        SELECT u.id, u.clerk_id, u.email, u.first_name, u.last_name, u.codigo_empresa, u.rol_id,
               r.nombre AS rol_nombre, r.privilegios AS rol_privilegios
        FROM users u
        LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.clerk_id IS NOT NULL AND u.clerk_id <> ''
    `);

    const [empresas] = await mainPool.query('SELECT codigo, nombre FROM empresas');
    const { emailToLeaderClerk, clerkToLeaderClerk } = await fetchAssignedLeaderClerkMap(mainPool);

    const equipos = [];
    for (const e of empresas) {
        const codigo = String(e.codigo || '').trim();
        if (!codigo) continue;
        equipos.push({
            id: codigo.slice(0, 64),
            nombre: String(e.nombre || codigo).slice(0, 120),
            liderUsuarioId: null
        });
    }

    const leaderTeamSet = new Set();
    for (const u of users) {
        if (mapRouthRoleToAcademia(u.rol_nombre, u.rol_privilegios) === 'lider') {
            const teamId = `lider_${u.clerk_id}`.slice(0, 64);
            leaderTeamSet.add(u.clerk_id);
            equipos.push({
                id: teamId,
                nombre: `Equipo ${buildDisplayName(u)}`.slice(0, 120),
                liderUsuarioId: String(u.clerk_id).slice(0, 64)
            });
        }
    }

    const personas = users.map((u) => {
        const rol = mapRouthRoleToAcademia(u.rol_nombre, u.rol_privilegios);
        const emailLower = String(u.email || '').toLowerCase().trim();
        const rawLeaderClerk =
            clerkToLeaderClerk.get(u.clerk_id) ||
            (emailLower ? emailToLeaderClerk.get(emailLower) : null) ||
            null;
        const validLeaderClerk = rawLeaderClerk && leaderTeamSet.has(rawLeaderClerk) ? rawLeaderClerk : null;
        const equipoId = resolveUserTeamId(u, rol, validLeaderClerk);

        return {
            usuarioId: String(u.clerk_id).slice(0, 64),
            nombre: buildDisplayName(u).slice(0, 200),
            rol,
            equipoId
        };
    });

    return { equipos, personas };
}

async function syncAcademiaPersonasYEquipos(pool, mainPool) {
    const { equipos, personas } = await resolveTeamContextForUsers(mainPool);

    for (const eq of equipos) {
        await pool.query(
            `INSERT INTO academia_equipos (id, nombre, lider_usuario_id) VALUES (?, ?, ?) AS n
             ON DUPLICATE KEY UPDATE nombre = n.nombre, lider_usuario_id = COALESCE(n.lider_usuario_id, academia_equipos.lider_usuario_id)`,
            [eq.id, eq.nombre, eq.liderUsuarioId]
        );
    }

    for (const p of personas) {
        await pool.query(
            `INSERT INTO academia_personas (usuario_id, nombre, equipo_id) VALUES (?, ?, ?) AS n
             ON DUPLICATE KEY UPDATE nombre = n.nombre, equipo_id = n.equipo_id`,
            [p.usuarioId, p.nombre, p.equipoId]
        );
    }

    return { equiposCount: equipos.length, personasCount: personas.length };
}

async function extractVerifiedClerkId(req) {
    const authHeader = req.get('authorization') || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token || !process.env.CLERK_SECRET_KEY) return null;

    try {
        const claims = await verifyToken(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
            clockSkewInMs: 60000
        });
        return claims && claims.sub ? String(claims.sub) : null;
    } catch (err) {
        console.warn('[academia-auth] Token de Clerk rechazado:', err?.message || err);
        return null;
    }
}

async function resolveAuthenticatedAcademiaUser(mainPool, req) {
    const clerkId = await extractVerifiedClerkId(req);
    if (!clerkId) return null;

    const [rows] = await mainPool.query(`
        SELECT u.id, u.clerk_id, u.email, u.first_name, u.last_name, u.codigo_empresa, u.rol_id,
               r.nombre AS rol_nombre, r.privilegios AS rol_privilegios
        FROM users u
        LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.clerk_id = ?
        LIMIT 1
    `, [clerkId]);

    const user = rows[0];
    if (!user) return null;

    const rol = mapRouthRoleToAcademia(user.rol_nombre, user.rol_privilegios);
    const nombre = buildDisplayName(user);
    let assignedLeaderClerk = null;
    if (rol === 'vendedor') {
        const [leaderRows] = await mainPool.query(`
            SELECT lu.clerk_id AS leader_clerk_id
            FROM contactos c
            JOIN users lu ON lu.id = c.lider_id
            LEFT JOIN roles lr ON lr.id = lu.rol_id
            WHERE (c.usuario_asignado_id = ? OR LOWER(c.email) = ?)
              AND LOWER(COALESCE(lr.nombre, '')) LIKE '%lider%'
            LIMIT 1
        `, [user.clerk_id, String(user.email || '').toLowerCase().trim()]);
        assignedLeaderClerk = leaderRows[0]?.leader_clerk_id || null;
    }

    const equipoId = resolveUserTeamId(user, rol, assignedLeaderClerk);
    const baseUser = {
        id: String(user.clerk_id),
        rol,
        nombre,
        equipoId
    };

    if (rol === 'lider') {
        baseUser.liderDe = [...new Set([`lider_${user.clerk_id}`, user.codigo_empresa].filter(Boolean).map(String))];
    }
    return baseUser;
}

const adminCursoSchema = z.object({
    slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/),
    nombre: z.string().trim().min(2).max(200),
    descripcion: z.string().trim().max(2000).nullish(),
    portadaUrl: z.string().trim().url().max(500).nullish(),
    estado: z.enum(['borrador', 'publicado']).default('publicado'),
    orden: z.coerce.number().int().min(0).max(10000).default(1)
});

const adminEstadoCursoSchema = z.object({
    estado: z.enum(['borrador', 'publicado'])
});

const adminModuloSchema = z.object({
    cursoId: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(2).max(200),
    orden: z.coerce.number().int().min(0).max(10000).default(1)
});

const adminClaseSchema = z.object({
    moduloId: z.coerce.number().int().positive(),
    nombre: z.string().trim().min(2).max(200),
    descripcion: z.string().trim().max(2000).nullish(),
    proveedor: z.enum(['youtube', 'bunny', 'mux', 'directo', 'drive']),
    videoRef: z.string().trim().min(1).max(500),
    duracionS: z.coerce.number().int().positive().max(86400).nullish(),
    orden: z.coerce.number().int().min(0).max(10000).default(1),
    obligatoriaClave: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i).nullish()
});

function createAdminCatalogRouter({ pool, mainPool, obtenerUsuario, invalidarCatalogo }) {
    const adminRouter = express.Router();
    adminRouter.use(express.json({ limit: '32kb' }));

    async function requireAdmin(req, res, next) {
        try {
            const u = await obtenerUsuario(req);
            if (!u) return res.status(401).json({ error: 'Iniciá sesión' });
            if (u.rol !== 'admin') return res.status(404).json({ error: 'No encontrado' });
            req.academiaAdmin = u;
            next();
        } catch (err) {
            next(err);
        }
    }

    adminRouter.get('/catalogo', requireAdmin, async (_req, res, next) => {
        try {
            const [cursos] = await pool.query(
                'SELECT id, slug, nombre, descripcion, portada_url AS portadaUrl, estado, orden FROM academia_cursos ORDER BY orden, id'
            );
            const [modulos] = await pool.query(
                'SELECT id, curso_id AS cursoId, nombre, orden FROM academia_modulos ORDER BY orden, id'
            );
            const [clases] = await pool.query(
                'SELECT id, modulo_id AS moduloId, nombre, descripcion, proveedor, video_ref AS videoRef, duracion_s AS duracionS, orden, obligatoria_clave AS obligatoriaClave FROM academia_clases ORDER BY orden, id'
            );
            res.json({ cursos, modulos, clases });
        } catch (err) {
            next(err);
        }
    });

    adminRouter.post('/cursos', requireAdmin, async (req, res, next) => {
        try {
            const d = adminCursoSchema.parse(req.body);
            const [r] = await pool.query(
                `INSERT INTO academia_cursos (slug, nombre, descripcion, portada_url, estado, orden)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [d.slug, d.nombre, d.descripcion ?? null, d.portadaUrl ?? null, d.estado, d.orden]
            );
            await invalidarCatalogo();
            res.status(201).json({ id: r.insertId, ...d });
        } catch (err) {
            if (err?.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Ya existe un curso con ese slug.' });
            }
            next(err);
        }
    });

    adminRouter.patch('/cursos/:id', requireAdmin, async (req, res, next) => {
        try {
            const id = z.coerce.number().int().positive().parse(req.params.id);
            const { estado } = adminEstadoCursoSchema.parse(req.body);
            const [r] = await pool.query(
                'UPDATE academia_cursos SET estado = ? WHERE id = ?',
                [estado, id]
            );
            if (!r.affectedRows) return res.status(404).json({ error: 'Curso no encontrado' });
            await invalidarCatalogo();
            res.json({ id, estado });
        } catch (err) {
            next(err);
        }
    });

    adminRouter.post('/modulos', requireAdmin, async (req, res, next) => {
        try {
            const d = adminModuloSchema.parse(req.body);
            const [r] = await pool.query(
                'INSERT INTO academia_modulos (curso_id, nombre, orden) VALUES (?, ?, ?)',
                [d.cursoId, d.nombre, d.orden]
            );
            await invalidarCatalogo();
            res.status(201).json({ id: r.insertId, ...d });
        } catch (err) {
            next(err);
        }
    });

    adminRouter.post('/clases', requireAdmin, async (req, res, next) => {
        try {
            const d = adminClaseSchema.parse(req.body);
            const refNormalizada = normalizarRefVideo(d.proveedor, d.videoRef);
            if (!refNormalizada) {
                return res.status(422).json({
                    error: `La referencia de video no es válida para el proveedor '${d.proveedor}'. Revisá el enlace o ID.`
                });
            }
            if (d.obligatoriaClave && (!d.duracionS || d.duracionS <= 0)) {
                return res.status(422).json({
                    error: 'Una clase obligatoria requiere indicar su duración en segundos.'
                });
            }
            const [r] = await pool.query(
                `INSERT INTO academia_clases (modulo_id, nombre, descripcion, proveedor, video_ref, duracion_s, orden, obligatoria_clave)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    d.moduloId,
                    d.nombre,
                    d.descripcion ?? null,
                    d.proveedor,
                    refNormalizada,
                    d.duracionS ?? null,
                    d.orden,
                    d.obligatoriaClave ?? null
                ]
            );
            await invalidarCatalogo();
            res.status(201).json({ id: r.insertId, ...d, videoRef: refNormalizada });
        } catch (err) {
            if (err?.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Ya existe una clase obligatoria con esa clave.' });
            }
            next(err);
        }
    });

    adminRouter.patch('/clases/:id', requireAdmin, async (req, res, next) => {
        try {
            const id = z.coerce.number().int().positive().parse(req.params.id);
            const d = adminClaseSchema.partial().parse(req.body);
            const [rows] = await pool.query(
                'SELECT id, modulo_id AS moduloId, nombre, descripcion, proveedor, video_ref AS videoRef, duracion_s AS duracionS, orden, obligatoria_clave AS obligatoriaClave FROM academia_clases WHERE id = ? LIMIT 1',
                [id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Clase no encontrada' });
            const actual = rows[0];

            const proveedor = d.proveedor ?? actual.proveedor;
            const rawRef = d.videoRef ?? actual.videoRef;
            const refNormalizada = normalizarRefVideo(proveedor, rawRef);
            if (!refNormalizada) {
                return res.status(422).json({
                    error: `La referencia de video no es válida para el proveedor '${proveedor}'. Revisá el enlace o ID.`
                });
            }

            const duracionS = d.duracionS !== undefined ? d.duracionS : actual.duracionS;
            const obligatoriaClave = d.obligatoriaClave !== undefined ? (d.obligatoriaClave || null) : actual.obligatoriaClave;
            if (obligatoriaClave && (!duracionS || duracionS <= 0)) {
                return res.status(422).json({
                    error: 'Una clase obligatoria requiere indicar su duración en segundos.'
                });
            }
            if (obligatoriaClave && proveedor === 'drive') {
                return res.status(422).json({
                    error: 'Las clases obligatorias no pueden usar Google Drive porque no mide reproducción.'
                });
            }

            const nombre = d.nombre ?? actual.nombre;
            const descripcion = d.descripcion !== undefined ? (d.descripcion || null) : actual.descripcion;
            const orden = d.orden ?? actual.orden;

            await pool.query(
                `UPDATE academia_clases
                 SET nombre = ?, descripcion = ?, proveedor = ?, video_ref = ?, duracion_s = ?, orden = ?, obligatoria_clave = ?
                 WHERE id = ?`,
                [nombre, descripcion, proveedor, refNormalizada, duracionS ?? null, orden, obligatoriaClave, id]
            );
            await invalidarCatalogo();
            res.json({ id, moduloId: actual.moduloId, nombre, descripcion, proveedor, videoRef: refNormalizada, duracionS: duracionS ?? null, orden, obligatoriaClave });
        } catch (err) {
            if (err?.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Ya existe una clase obligatoria con esa clave.' });
            }
            next(err);
        }
    });

    adminRouter.delete('/clases/:id', requireAdmin, async (req, res, next) => {
        try {
            const id = z.coerce.number().int().positive().parse(req.params.id);
            const [r] = await pool.query('DELETE FROM academia_clases WHERE id = ?', [id]);
            if (!r.affectedRows) return res.status(404).json({ error: 'Clase no encontrada' });
            await invalidarCatalogo();
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    adminRouter.post('/sincronizar-equipo', requireAdmin, async (_req, res, next) => {
        try {
            const stats = await syncAcademiaPersonasYEquipos(pool, mainPool);
            res.json({ ok: true, ...stats });
        } catch (err) {
            next(err);
        }
    });

    adminRouter.use((err, _req, res, _next) => {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: 'Datos inválidos', detalle: err.flatten() });
        }
        console.error('[academia-admin] Error:', err);
        res.status(500).json({ error: 'Error administrando el catálogo de la academia' });
    });

    return adminRouter;
}

function buildVideoConfigFromEnv() {
    const config = {};
    if (process.env.BUNNY_LIBRARY_ID && process.env.BUNNY_SECURITY_KEY) {
        config.bunny = {
            libreriaId: process.env.BUNNY_LIBRARY_ID,
            claveSeguridad: process.env.BUNNY_SECURITY_KEY
        };
    }
    if (process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_PRIVATE_KEY) {
        config.mux = {
            keyId: process.env.MUX_SIGNING_KEY_ID,
            privateKeyPem: process.env.MUX_SIGNING_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }
    return config;
}

function createAcademiaRouterMiddleware(getMainPool) {
    const pool = getAcademiaPool();
    const obtenerUsuario = async (req) => {
        const mainPool = typeof getMainPool === 'function' ? getMainPool() : getMainPool;
        if (!mainPool) return null;
        return resolveAuthenticatedAcademiaUser(mainPool, req);
    };

    const coreRouter = academiaRouter({
        db: pool,
        redis: getOptionalRedis(),
        obtenerUsuario,
        enunciados: ENUNCIADOS_COLABORATIUM,
        video: buildVideoConfigFromEnv(),
        registrar: (msg, err) => console.error(`[academia] ${msg}`, err || '')
    });
    coreRouterRef = coreRouter;

    const adminRouter = createAdminCatalogRouter({
        pool,
        mainPool: { query: (...args) => (typeof getMainPool === 'function' ? getMainPool() : getMainPool).query(...args) },
        obtenerUsuario,
        invalidarCatalogo: () => coreRouter.invalidarCatalogo()
    });

    const wrapper = express.Router();
    wrapper.use('/admin', adminRouter);
    wrapper.use('/', coreRouter);
    return wrapper;
}

async function initAcademiaBootstrap(mainPool) {
    const pool = getAcademiaPool();
    await initAcademiaSchema(pool);
    const [[cursoRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM academia_cursos');
    if (Number(cursoRow?.cnt || 0) === 0) {
        const seedRes = await seedCursosColaboratium(pool);
        console.log(`📚 [Academia] Catálogo inicial sembrado (${seedRes.cursosCreados} cursos, ${seedRes.modulosCreados} módulos, ${seedRes.clasesCreadas} clases).`);
    }
    const stats = await syncAcademiaPersonasYEquipos(pool, mainPool);
    console.log(`🎓 [Academia] Esquema MySQL listo (timezone='Z') y sincronizado (${stats.equiposCount} equipos, ${stats.personasCount} personas).`);
    return stats;
}

module.exports = {
    getAcademiaPool,
    initAcademiaSchema,
    syncAcademiaPersonasYEquipos,
    mapRouthRoleToAcademia,
    createAcademiaRouterMiddleware,
    initAcademiaBootstrap,
    trabajoDePracticaBorrado: (trabajoRef) => trabajoDePracticaBorrado(getAcademiaPool(), trabajoRef),
    invalidarCatalogo: () => (coreRouterRef ? coreRouterRef.invalidarCatalogo() : Promise.resolve())
};
