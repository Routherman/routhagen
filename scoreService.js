const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Retorna el rango y metadatos visuales según el puntaje (0 a 1000)
 */
function calcularRango(score) {
    const s = Math.max(0, Math.min(1000, Number(score) || 500));
    if (s >= 850) {
        return {
            nombre: 'DIAMANTE',
            icono: '💎',
            etiqueta: 'Élite Diamante',
            colorHex: '#8b5cf6',
            colorBg: 'rgba(139, 92, 246, 0.15)',
            borderHex: '#7c3aed',
            badgeClass: 'bg-purple-100 text-purple-900 border-purple-300'
        };
    }
    if (s >= 700) {
        return {
            nombre: 'ORO',
            icono: '🥇',
            etiqueta: 'Top Performer Oro',
            colorHex: '#f59e0b',
            colorBg: 'rgba(245, 158, 11, 0.15)',
            borderHex: '#d97706',
            badgeClass: 'bg-amber-100 text-amber-900 border-amber-300'
        };
    }
    if (s >= 500) {
        return {
            nombre: 'PLATA',
            icono: '🥈',
            etiqueta: 'Estándar Plata',
            colorHex: '#3b82f6',
            colorBg: 'rgba(59, 130, 246, 0.15)',
            borderHex: '#2563eb',
            badgeClass: 'bg-blue-100 text-blue-900 border-blue-300'
        };
    }
    if (s >= 350) {
        return {
            nombre: 'BRONCE',
            icono: '🥉',
            etiqueta: 'Alerta Bronce',
            colorHex: '#f97316',
            colorBg: 'rgba(249, 115, 22, 0.15)',
            borderHex: '#ea580c',
            badgeClass: 'bg-orange-100 text-orange-900 border-orange-300'
        };
    }
    return {
        nombre: 'EN REVISIÓN',
        icono: '⚠️',
        etiqueta: 'En Revisión Crítica',
        colorHex: '#ef4444',
        colorBg: 'rgba(239, 68, 68, 0.15)',
        borderHex: '#dc2626',
        badgeClass: 'bg-red-100 text-red-900 border-red-300'
    };
}

/**
 * Inicializa las tablas necesarias para el sistema de puntuación
 */
async function initScoreTables(pool) {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS score_usuarios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                identificador VARCHAR(150) NOT NULL,
                contacto_id INT NULL,
                usuario_id VARCHAR(100) NULL,
                nombre VARCHAR(150) NOT NULL,
                email VARCHAR(150) NULL,
                telefono VARCHAR(50) NULL,
                rol VARCHAR(50) NOT NULL,
                score_actual INT DEFAULT 500,
                rango VARCHAR(30) DEFAULT 'PLATA',
                leads_atendidos INT DEFAULT 0,
                tiempo_promedio_min DECIMAL(8,2) DEFAULT 0,
                volumen_cartera DECIMAL(14,2) DEFAULT 0,
                reclamos_abiertos INT DEFAULT 0,
                tasa_resolucion_pct DECIMAL(5,2) DEFAULT 100.00,
                horario_inicio VARCHAR(10) DEFAULT '09:00',
                horario_fin VARCHAR(10) DEFAULT '18:00',
                dias_laborales VARCHAR(100) DEFAULT 'Lunes a Viernes',
                disponibilidad_activa TINYINT(1) DEFAULT 1,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_empresa_identificador (codigo_empresa, identificador)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Migración retrocompatible en caso de tabla existente
        try {
            await pool.query("ALTER TABLE score_usuarios ADD COLUMN horario_inicio VARCHAR(10) DEFAULT '09:00'");
        } catch (e) {}
        try {
            await pool.query("ALTER TABLE score_usuarios ADD COLUMN horario_fin VARCHAR(10) DEFAULT '18:00'");
        } catch (e) {}
        try {
            await pool.query("ALTER TABLE score_usuarios ADD COLUMN dias_laborales VARCHAR(100) DEFAULT 'Lunes a Viernes'");
        } catch (e) {}
        try {
            await pool.query("ALTER TABLE score_usuarios ADD COLUMN disponibilidad_activa TINYINT(1) DEFAULT 1");
        } catch (e) {}

        await pool.query(`
            CREATE TABLE IF NOT EXISTS score_historial_eventos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                identificador VARCHAR(150) NOT NULL,
                tipo_evento VARCHAR(100) NOT NULL,
                puntos INT NOT NULL,
                score_resultante INT NOT NULL,
                referencia_tipo VARCHAR(50) NULL,
                referencia_id VARCHAR(100) NULL,
                descripcion VARCHAR(255) NOT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✅ [SCORE SYSTEM]: Tablas score_usuarios y score_historial_eventos listas.');
    } catch (err) {
        console.error('❌ Error inicializando tablas de score:', err.message);
    }
}

/**
 * Reclasifica a prospectos a los contactos en LIDERES/ASESORES que nunca se loguearon
 * ni pidieron participar, y limpia sus puntajes fantasma en score_usuarios.
 */
async function reclassifyInactiveProspectsAndPruneScores(pool, codigoEmpresa = 'KRZMJI', { dryRun = false } = {}) {
    if (!pool) return { reclassifiedToProspectLideres: 0, reclassifiedToProspectAsesores: 0, removedScores: 0, removedHistory: 0 };

    const activeParticipationCondition = `
        (
            (c.email IS NOT NULL AND c.email != '' AND EXISTS (
                SELECT 1 FROM users u
                WHERE LOWER(u.email) COLLATE utf8mb4_unicode_ci = LOWER(c.email) COLLATE utf8mb4_unicode_ci
                  AND u.codigo_empresa = c.codigo_empresa
            ))
            OR EXISTS (SELECT 1 FROM mensajes m WHERE m.contacto_id = c.id AND m.direccion = 'ENTRANTE')
            OR EXISTS (SELECT 1 FROM tickets t WHERE t.contacto_id = c.id)
            OR (
                (
                    COALESCE(c.metadata_extra, '') LIKE '%webinar%'
                    OR COALESCE(c.metadata_extra, '') LIKE '%inscrip%'
                    OR COALESCE(c.metadata_extra, '') LIKE '%confirmado_en%'
                    OR COALESCE(c.metadata_extra, '') LIKE '%solicitud%'
                )
                AND LOWER(COALESCE(c.email, '')) NOT LIKE 'cpanel@%'
                AND LOWER(COALESCE(c.email, '')) NOT LIKE '%mailer-daemon%'
                AND LOWER(COALESCE(c.email, '')) NOT LIKE '%noreply%'
                AND LOWER(COALESCE(c.email, '')) NOT LIKE '%no-reply%'
            )
        )
    `;

    // 1. Contactos hoy marcados en LIDERES / ASESORES sin login ni solicitud de participación ni B2B activo
    const [toProspectLideres] = await pool.query(`
        SELECT c.id FROM contactos c
        WHERE c.codigo_empresa = ?
          AND (
            UPPER(COALESCE(c.grupo, '')) IN ('LIDERES', 'LIDER', 'LÍDERES', 'LÍDER')
            OR (
              UPPER(COALESCE(c.grupo, '')) NOT IN ('TEAM', 'SOPORTE', 'CREDITOS', 'CRÉDITOS', 'MAIN', 'MASTER')
              AND UPPER(COALESCE(c.rol_asignado, '')) IN ('LIDERES', 'LIDER', 'LÍDERES', 'LÍDER')
            )
          )
          AND (
            COALESCE(c.metadata_extra, '') LIKE '%origen_b2b%'
            OR LOWER(COALESCE(c.email, '')) LIKE 'cpanel@%'
            OR NOT ${activeParticipationCondition}
          )
          AND NOT (
            COALESCE(c.metadata_extra, '') LIKE '%origen_b2b%'
            AND ${activeParticipationCondition}
          )
    `, [codigoEmpresa]);

    const [toProspectAsesores] = await pool.query(`
        SELECT c.id FROM contactos c
        WHERE c.codigo_empresa = ?
          AND (
            UPPER(COALESCE(c.grupo, '')) IN ('ASESORES', 'ASESOR')
            OR (
              UPPER(COALESCE(c.grupo, '')) NOT IN ('TEAM', 'SOPORTE', 'CREDITOS', 'CRÉDITOS', 'MAIN', 'MASTER', 'LIDERES', 'LIDER', 'LÍDERES', 'LÍDER')
              AND UPPER(COALESCE(c.rol_asignado, '')) IN ('ASESORES', 'ASESOR')
            )
          )
          AND (
            COALESCE(c.metadata_extra, '') LIKE '%origen_b2b%'
            OR UPPER(COALESCE(c.grupo, '')) LIKE '%PROSPECTO%'
            OR LOWER(COALESCE(c.email, '')) LIKE 'cpanel@%'
            OR NOT ${activeParticipationCondition}
          )
          AND NOT (
            UPPER(COALESCE(c.grupo, '')) NOT LIKE '%PROSPECTO%'
            AND ${activeParticipationCondition}
          )
    `, [codigoEmpresa]);

    const liderIds = (toProspectLideres || []).map(r => r.id);
    const asesorIds = (toProspectAsesores || []).map(r => r.id);

    if (!dryRun) {
        if (liderIds.length > 0) {
            await pool.query(
                `UPDATE contactos
                 SET grupo = 'PROSPECTO LIDERES',
                     rol_asignado = 'Prospecto Lideres',
                     estado_resolucion = COALESCE(NULLIF(estado_resolucion, ''), 'PENDIENTE')
                 WHERE id IN (?) AND codigo_empresa = ?`,
                [liderIds, codigoEmpresa]
            );
        }
        if (asesorIds.length > 0) {
            await pool.query(
                `UPDATE contactos
                 SET grupo = 'PROSPECTO ASESORES',
                     rol_asignado = 'Prospecto Asesores',
                     estado_resolucion = COALESCE(NULLIF(estado_resolucion, ''), 'PENDIENTE')
                 WHERE id IN (?) AND codigo_empresa = ?`,
                [asesorIds, codigoEmpresa]
            );
        }
    }

    // 2. Detectar puntajes fantasma (prospectos, contactos fríos sin login ni participación, cpanel, roles no operativos)
    const [staleScores] = await pool.query(`
        SELECT s.id, s.identificador
        FROM score_usuarios s
        LEFT JOIN contactos c ON s.contacto_id = c.id
        WHERE s.codigo_empresa = ?
          AND (
            UPPER(COALESCE(s.rol, '')) LIKE '%PROSPECTO%'
            OR UPPER(COALESCE(s.rol, '')) IN ('CLIENTES', 'GENERAL', 'INVERSORES')
            OR LOWER(COALESCE(s.email, '')) LIKE 'cpanel@%'
            OR (
              s.contacto_id IS NOT NULL AND (
                c.id IS NULL
                OR UPPER(COALESCE(c.grupo, '')) LIKE '%PROSPECTO%'
                OR UPPER(COALESCE(c.rol_asignado, '')) LIKE '%PROSPECTO%'
                OR (
                  UPPER(COALESCE(c.grupo, '')) NOT IN ('TEAM', 'SOPORTE', 'CREDITOS', 'CRÉDITOS', 'MAIN', 'MASTER')
                  AND NOT ${activeParticipationCondition}
                )
              )
            )
          )
    `, [codigoEmpresa]);

    let removedHistory = 0;
    let removedScores = 0;
    const staleIdentificadores = [...new Set((staleScores || []).map(r => r.identificador).filter(Boolean))];
    const staleScoreIds = (staleScores || []).map(r => r.id);

    if (!dryRun && staleScoreIds.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < staleIdentificadores.length; i += chunkSize) {
            const batch = staleIdentificadores.slice(i, i + chunkSize);
            const [hDel] = await pool.query(
                "DELETE FROM score_historial_eventos WHERE codigo_empresa = ? AND identificador IN (?)",
                [codigoEmpresa, batch]
            );
            removedHistory += Number(hDel.affectedRows || 0);
        }
        for (let i = 0; i < staleScoreIds.length; i += chunkSize) {
            const batch = staleScoreIds.slice(i, i + chunkSize);
            const [sDel] = await pool.query(
                "DELETE FROM score_usuarios WHERE codigo_empresa = ? AND id IN (?)",
                [codigoEmpresa, batch]
            );
            removedScores += Number(sDel.affectedRows || 0);
        }
    } else if (dryRun) {
        removedScores = staleScoreIds.length;
    }

    return {
        reclassifiedToProspectLideres: liderIds.length,
        reclassifiedToProspectAsesores: asesorIds.length,
        removedScores,
        removedHistory
    };
}

/**
 * Popula scores iniciales solo para usuarios activos / participantes reales (nunca prospectos fríos)
 */
async function seedInitialScores(pool, codigoEmpresa = 'KRZMJI') {
    if (!pool) return;
    try {
        // Primero reclasificar prospectos fríos y limpiar scores fantasma heredados
        const cleanup = await reclassifyInactiveProspectsAndPruneScores(pool, codigoEmpresa);
        if (cleanup.reclassifiedToProspectLideres || cleanup.reclassifiedToProspectAsesores || cleanup.removedScores) {
            console.log(`🧹 [SCORE CLEANUP]: Reclasificados ${cleanup.reclassifiedToProspectLideres} Líderes y ${cleanup.reclassifiedToProspectAsesores} Asesores sin login/participación a Prospectos; purgados ${cleanup.removedScores} scores fantasma.`);
        }

        const [contacts] = await pool.query(`
            SELECT c.id, c.nombre, c.email, c.telefono, c.grupo, c.rol_asignado, c.creado_en
            FROM contactos c
            WHERE c.codigo_empresa = ?
              AND UPPER(COALESCE(c.grupo, '')) IN ('ASESORES', 'LIDERES', 'LÍDERES', 'TEAM', 'SOPORTE', 'CREDITOS', 'CRÉDITOS', 'MAIN', 'MASTER')
              AND UPPER(COALESCE(c.grupo, '')) NOT LIKE '%PROSPECTO%'
              AND UPPER(COALESCE(c.rol_asignado, '')) NOT LIKE '%PROSPECTO%'
              AND LOWER(COALESCE(c.email, '')) NOT LIKE 'cpanel@%'
              AND (
                UPPER(COALESCE(c.grupo, '')) IN ('TEAM', 'SOPORTE', 'CREDITOS', 'CRÉDITOS', 'MAIN', 'MASTER')
                OR (c.email IS NOT NULL AND c.email != '' AND EXISTS (
                    SELECT 1 FROM users u
                    WHERE LOWER(u.email) COLLATE utf8mb4_unicode_ci = LOWER(c.email) COLLATE utf8mb4_unicode_ci
                      AND u.codigo_empresa = c.codigo_empresa
                ))
                OR EXISTS (SELECT 1 FROM mensajes m WHERE m.contacto_id = c.id AND m.direccion = 'ENTRANTE')
                OR EXISTS (SELECT 1 FROM tickets t WHERE t.contacto_id = c.id)
                OR (
                    COALESCE(c.metadata_extra, '') NOT LIKE '%origen_b2b%'
                    AND (
                        COALESCE(c.metadata_extra, '') LIKE '%webinar%'
                        OR COALESCE(c.metadata_extra, '') LIKE '%inscrip%'
                        OR COALESCE(c.metadata_extra, '') LIKE '%confirmado_en%'
                    )
                )
              )
        `, [codigoEmpresa]);

        if (!contacts || contacts.length === 0) return;

        for (const c of contacts) {
            const identificador = `contacto_${c.id}`;
            const rol = (c.grupo || c.rol_asignado || 'ASESORES').toUpperCase();

            // Verificar si ya tiene score registrado
            const [existing] = await pool.query(
                "SELECT id, score_actual FROM score_usuarios WHERE codigo_empresa = ? AND identificador = ?",
                [codigoEmpresa, identificador]
            );

            if (!existing || existing.length === 0) {
                const baseScore = 500;
                const infoRango = calcularRango(baseScore);

                await pool.query(`
                    INSERT INTO score_usuarios (codigo_empresa, identificador, contacto_id, nombre, email, telefono, rol, score_actual, rango, leads_atendidos, tiempo_promedio_min, volumen_cartera, reclamos_abiertos)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
                `, [
                    codigoEmpresa,
                    identificador,
                    c.id,
                    c.nombre || 'Asesor Comercial',
                    c.email || null,
                    c.telefono || null,
                    rol,
                    baseScore,
                    infoRango.nombre
                ]);

                // Registrar evento base inicial en el libro diario de auditoría
                await pool.query(`
                    INSERT INTO score_historial_eventos (codigo_empresa, identificador, tipo_evento, puntos, score_resultante, referencia_tipo, descripcion)
                    VALUES (?, ?, 'SCORE_BASE', 500, 500, 'onboarding', 'Puntaje base de ingreso de participante activo')
                `, [
                    codigoEmpresa, identificador
                ]);
            }
        }
        console.log(`✅ [SCORE SYSTEM]: Scores activos verificados para ${contacts.length} integrantes/participantes reales de Colaboratium.`);
    } catch (err) {
        console.error('Error al poblar scores iniciales:', err.message);
    }
}

/**
 * Registra un evento de suma o resta en el score de un usuario
 */
async function registrarEventoScore(pool, {
    codigoEmpresa = 'KRZMJI',
    identificador,
    contactoId = null,
    usuarioId = null,
    nombre = null,
    rol = 'ASESORES',
    tipoEvento,
    puntos,
    referenciaTipo = null,
    referenciaId = null,
    descripcion
}) {
    if (!pool || !identificador) return null;

    try {
        const idKey = identificador.startsWith('contacto_') || identificador.startsWith('user_') ? identificador : (contactoId ? `contacto_${contactoId}` : `user_${usuarioId}`);

        // Obtener score actual
        const [rows] = await pool.query(
            "SELECT id, score_actual FROM score_usuarios WHERE codigo_empresa = ? AND identificador = ?",
            [codigoEmpresa, idKey]
        );

        let currentScore = 500;
        if (rows && rows.length > 0) {
            currentScore = rows[0].score_actual;
        }

        const nuevoScore = Math.max(0, Math.min(1000, currentScore + Number(puntos)));
        const nuevoRango = calcularRango(nuevoScore).nombre;

        // Upsert en score_usuarios
        await pool.query(`
            INSERT INTO score_usuarios (codigo_empresa, identificador, contacto_id, usuario_id, nombre, rol, score_actual, rango)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                score_actual = ?,
                rango = ?,
                actualizado_en = CURRENT_TIMESTAMP
        `, [
            codigoEmpresa, idKey, contactoId, usuarioId, nombre || 'Usuario', rol, nuevoScore, nuevoRango,
            nuevoScore, nuevoRango
        ]);

        // Registrar en historial
        const [evRes] = await pool.query(`
            INSERT INTO score_historial_eventos (codigo_empresa, identificador, tipo_evento, puntos, score_resultante, referencia_tipo, referencia_id, descripcion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            codigoEmpresa, idKey, tipoEvento, puntos, nuevoScore, referenciaTipo, referenciaId ? String(referenciaId) : null, descripcion
        ]);

        return {
            success: true,
            eventoId: evRes.insertId,
            scoreAnterior: currentScore,
            scoreNuevo: nuevoScore,
            puntosAplicados: puntos,
            rango: nuevoRango
        };
    } catch (err) {
        console.error('Error registrando evento de score:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Obtiene el ranking completo de scores por rol o general
 */
async function obtenerScoresRanking(pool, codigoEmpresa = 'KRZMJI', rol = null) {
    if (!pool) return [];
    try {
        let query = `
            SELECT s.*
            FROM score_usuarios s
            LEFT JOIN contactos c ON s.contacto_id = c.id
            WHERE s.codigo_empresa = ?
              AND UPPER(COALESCE(s.rol, '')) NOT LIKE '%PROSPECTO%'
              AND UPPER(COALESCE(s.rol, '')) NOT IN ('CLIENTES', 'GENERAL', 'INVERSORES')
              AND (s.contacto_id IS NULL OR (
                UPPER(COALESCE(c.grupo, '')) NOT LIKE '%PROSPECTO%'
                AND UPPER(COALESCE(c.rol_asignado, '')) NOT LIKE '%PROSPECTO%'
              ))
        `;
        const params = [codigoEmpresa];

        if (rol && rol !== 'ALL') {
            query += " AND UPPER(s.rol) = ?";
            params.push(rol.toUpperCase());
        }

        query += " ORDER BY s.score_actual DESC, s.leads_atendidos DESC, s.actualizado_en DESC";
        const [rows] = await pool.query(query, params);

        return (rows || []).map((row, index) => ({
            ...row,
            posicion: index + 1,
            rangoMeta: calcularRango(row.score_actual)
        }));
    } catch (err) {
        console.error('Error obteniendo ranking de scores:', err.message);
        return [];
    }
}

/**
 * Obtiene el score y detalle de un contacto o usuario específico
 */
async function obtenerScoreDetalle(pool, codigoEmpresa = 'KRZMJI', identificador) {
    if (!pool || !identificador) return null;
    try {
        const idKey = identificador.startsWith('contacto_') || identificador.startsWith('user_') ? identificador : `contacto_${identificador}`;

        const [uRows] = await pool.query(
            "SELECT * FROM score_usuarios WHERE codigo_empresa = ? AND identificador = ?",
            [codigoEmpresa, idKey]
        );

        if (!uRows || uRows.length === 0) {
            return {
                identificador: idKey,
                score_actual: 500,
                rango: 'PLATA',
                rangoMeta: calcularRango(500),
                historial: []
            };
        }

        const userScore = uRows[0];
        const [hRows] = await pool.query(
            "SELECT * FROM score_historial_eventos WHERE codigo_empresa = ? AND identificador = ? ORDER BY creado_en DESC LIMIT 20",
            [codigoEmpresa, idKey]
        );

        return {
            ...userScore,
            rangoMeta: calcularRango(userScore.score_actual),
            historial: hRows || []
        };
    } catch (err) {
        console.error('Error obteniendo detalle de score:', err.message);
        return null;
    }
}

/**
 * Diccionario oficial de Reglas de Puntuación Colaboratium 2026 (Disponibilidad Declarada)
 */
const REGLAS_SCORE_2026 = {
    // 01. Regla de oro temporal
    DISPONIBILIDAD: {
        descripcion: 'Los tiempos solo cuentan en el horario que cada persona informó como disponible. Si llega una consulta fuera de ese horario, el tiempo comienza a contar cuando vuelve a estar disponible.'
    },
    // 02. Asesores Comerciales
    ASESORES: {
        RESPUESTA_MENOR_5MIN: { puntos: 15, tipo: 'SUMA', desc: 'Respuesta inicial al Lead en < 5 minutos desde la asignación' },
        RESPUESTA_5_A_15MIN: { puntos: 8, tipo: 'SUMA', desc: 'Respuesta entre 5 y 15 minutos desde la asignación' },
        ASISTENCIA_WEBINAR_LEAD: { puntos: 20, tipo: 'SUMA', desc: 'Lead derivado que asiste y participa de Webinar / Meet' },
        INVERSION_CERRADA: { puntos: 50, tipo: 'SUMA', desc: 'Inversión cerrada y liquidada con éxito por el inversor' },
        REINVERSION_CONFIRMADA: { puntos: 35, tipo: 'SUMA', desc: 'Reinversión confirmada (renovación de capital / retención)' },
        FICHA_CRM_VALIDADA: { puntos: 10, tipo: 'SUMA', desc: 'Ficha CRM 100% validada (DNI, CBU/Alias, Perfil Inversor)' },
        LEAD_SIN_CONTACTO_1H: { puntos: -10, tipo: 'RESTA', desc: 'Lead asignado sin contactar tras más de 1 hora' },
        LEAD_SIN_CONTACTO_24H: { puntos: -40, tipo: 'RESTA', desc: 'Lead sin contactar tras 24 hs (Reasignación automática)' },
        RECLAMO_INVERSOR_ABIERTO: { puntos: -30, tipo: 'RESTA', desc: 'Ticket de reclamo abierto por un inversor de su cartera' },
        AUSENTISMO_REUNION: { puntos: -50, tipo: 'RESTA', desc: 'Ausentismo en reunión o webinar confirmado con candidatos' }
    },
    // 03. Líderes de Equipo
    LIDERES: {
        SOPORTE_ASESOR_MENOR_15MIN: { puntos: 10, tipo: 'SUMA', desc: 'Respuesta y soporte a consultas de sus asesores en < 15 minutos' },
        PRIMERA_COLOCACION_ASESOR: { puntos: 30, tipo: 'SUMA', desc: 'Asesor de su equipo que concreta su primera colocación' },
        META_MENSUAL_EQUIPO: { puntos: 100, tipo: 'SUMA', desc: 'Equipo que alcanza o supera la meta mensual estipulada' },
        DICTADO_WEBINAR_COACHING: { puntos: 25, tipo: 'SUMA', desc: 'Dictado de Webinar de Capacitación o Coaching grupal' },
        CONSULTA_INTERNA_SIN_RESPUESTA_4H: { puntos: -20, tipo: 'RESTA', desc: 'Asesor con consulta interna sin respuesta por más de 4 horas' },
        ASESORES_INACTIVOS_14D: { puntos: -15, tipo: 'RESTA', desc: 'Asesores inactivos (>14 días sin actividad) sin gestión documentada' },
        CAMBIO_LIDER_DESATENCION: { puntos: -50, tipo: 'RESTA', desc: 'Solicitud formal de cambio de líder por desatención' }
    },
    // 04. Roles Operativos del Team
    TEAM: {
        SOPORTE_FCR: { puntos: 20, tipo: 'SUMA', desc: '[SOPORTE] Resolución de ticket en primer contacto (FCR)' },
        SOPORTE_RESPUESTA_MENOR_3MIN: { puntos: 10, tipo: 'SUMA', desc: '[SOPORTE] Tiempo de primera respuesta < 3 minutos en Helpdesk' },
        SOPORTE_5_ESTRELLAS: { puntos: 15, tipo: 'SUMA', desc: '[SOPORTE] Calificación de 5 estrellas en encuesta de satisfacción' },
        SOPORTE_TICKET_VENCIDO_SLA: { puntos: -20, tipo: 'RESTA', desc: '[SOPORTE] Ticket vencido fuera del SLA estipulado (<2 hs)' },
        CREDITOS_ACREDITACION_MENOR_30MIN: { puntos: 15, tipo: 'SUMA', desc: '[CRÉDITOS] Conciliación y acreditación de fondos en < 30 minutos' },
        CREDITOS_SEMANA_CERO_DISCREPANCIAS: { puntos: 50, tipo: 'SUMA', desc: '[CRÉDITOS] Semana completa con 0 discrepancias bancarias' },
        CREDITOS_ERROR_LIQUIDACION: { puntos: -60, tipo: 'RESTA', desc: '[CRÉDITOS] Error en carga de CBU o liquidación que genere reclamo' },
        COMPLIANCE_KYC_MENOR_2H: { puntos: 10, tipo: 'SUMA', desc: '[COMPLIANCE] Validación y aprobación de legajo KYC en < 2 horas' },
        COMPLIANCE_APROBACION_NEGLIGENTE: { puntos: -50, tipo: 'RESTA', desc: '[COMPLIANCE] Aprobación negligente de legajo adulterado o inválido' }
    }
};

/**
 * Calcula los minutos efectivos transcurridos respetando la Disponibilidad Declarada:
 * Los tiempos solo cuentan en el horario que cada persona informó como disponible.
 * Si llega una consulta fuera de ese horario, el tiempo comienza a contar cuando vuelve a estar disponible.
 */
function calcularMinutosEfectivos(fechaAsignacion, fechaRespuesta = new Date(), horario = {}) {
    const inicioStr = horario.horario_inicio || '09:00';
    const finStr = horario.horario_fin || '18:00';
    const [startH, startM] = inicioStr.split(':').map(Number);
    const [endH, endM] = finStr.split(':').map(Number);

    const asigDate = new Date(fechaAsignacion);
    const respDate = new Date(fechaRespuesta);

    let effectiveStart = new Date(asigDate);
    const asigHour = asigDate.getHours() + asigDate.getMinutes() / 60;
    const startHour = startH + startM / 60;
    const endHour = endH + endM / 60;

    // Si llegó después del fin de jornada, pasa al inicio del día siguiente disponible
    if (asigHour >= endHour) {
        effectiveStart.setDate(effectiveStart.getDate() + 1);
        effectiveStart.setHours(startH, startM, 0, 0);
    } else if (asigHour < startHour) {
        effectiveStart.setHours(startH, startM, 0, 0);
    }

    // Si es fin de semana (sábado=6, domingo=0), trasladar al lunes al inicio de jornada
    if (effectiveStart.getDay() === 6) {
        effectiveStart.setDate(effectiveStart.getDate() + 2);
        effectiveStart.setHours(startH, startM, 0, 0);
    } else if (effectiveStart.getDay() === 0) {
        effectiveStart.setDate(effectiveStart.getDate() + 1);
        effectiveStart.setHours(startH, startM, 0, 0);
    }

    const diffMs = Math.max(0, respDate.getTime() - effectiveStart.getTime());
    return Math.round(diffMs / 60000);
}

/**
 * Actualiza el horario de disponibilidad declarada de un usuario o asesor
 */
async function actualizarDisponibilidad(pool, {
    codigoEmpresa = 'KRZMJI',
    identificador,
    horario_inicio = '09:00',
    horario_fin = '18:00',
    dias_laborales = 'Lunes a Viernes',
    disponibilidad_activa = 1
}) {
    if (!pool || !identificador) return { success: false, error: 'Identificador requerido' };
    const idKey = identificador.startsWith('contacto_') || identificador.startsWith('user_') ? identificador : `contacto_${identificador}`;
    await pool.query(`
        UPDATE score_usuarios 
        SET horario_inicio = ?, horario_fin = ?, dias_laborales = ?, disponibilidad_activa = ?, actualizado_en = CURRENT_TIMESTAMP
        WHERE codigo_empresa = ? AND identificador = ?
    `, [horario_inicio, horario_fin, dias_laborales, disponibilidad_activa ? 1 : 0, codigoEmpresa, idKey]);
    return { success: true, horario_inicio, horario_fin, dias_laborales, disponibilidad_activa };
}

/**
 * Genera o envía el documento PDF oficial del Reglamento y Sistema de Medición de Score
 * y lo envía por stream o lo guarda en el filesystem
 */
function generarPdfReglamentoScore(streamOrRes) {
    // Si existe el PDF oficial de 2 páginas con Disponibilidad Declarada en RAG o public, entregarlo directamente
    const ragPdf = path.join(__dirname, '..', 'RAG', 'Colaboratium Reglamento Score 2026 Disponibilidad Declarada.pdf');
    const publicPdf = path.join(__dirname, 'public', 'downloads', 'Reglamento_Sistema_de_Puntos_Colaboratium.pdf');
    const sourcePdf = (fs.existsSync(ragPdf) && fs.statSync(ragPdf).size > 50000) ? ragPdf : ((fs.existsSync(publicPdf) && fs.statSync(publicPdf).size > 50000) ? publicPdf : null);

    if (sourcePdf) {
        if (typeof streamOrRes.sendFile === 'function') {
            return streamOrRes.sendFile(sourcePdf);
        }
        if (typeof streamOrRes.pipe === 'function') {
            const readStream = fs.createReadStream(sourcePdf);
            return readStream.pipe(streamOrRes);
        }
    }

    const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
            Title: 'Reglamento Oficial - Sistema de Puntuación y Rendimiento 360°',
            Author: 'Colaboratium Dirección Central',
            Subject: 'Métricas, KPIs y Beneficios para Asesores, Líderes y Team Operativo',
            Keywords: 'Colaboratium, Score, Rendimiento, Asesores, Líderes, SLA, Disponibilidad Declarada'
        }
    });

    doc.pipe(streamOrRes);

    const primaryColor = '#1e1b4b'; // Deep Indigo
    const accentBlue = '#2563eb';
    const accentGold = '#b45309';
    const textColor = '#1e293b';
    const mutedColor = '#64748b';
    const lightBg = '#f8fafc';

    // -------------------------------------------------------------
    // ENCABEZADO ELEGANTE
    // -------------------------------------------------------------
    doc.rect(0, 0, doc.page.width, 100).fill('#0f172a');

    doc.fillColor('#38bdf8')
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('COLABORATIUM', 40, 26, { tracking: 2 });

    doc.fillColor('#94a3b8')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('BCRA Nº 40.015 • ECOSISTEMA FINANCIERO Y COMERCIAL', 40, 50);

    doc.fillColor('#ffffff')
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('SISTEMA INTEGRAL DE SCORE & GAMIFICACIÓN 360°', 40, 68);

    doc.fillColor('#38bdf8')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('VERSIÓN 2026 • OFICIAL', doc.page.width - 180, 40, { align: 'right', width: 140 });

    doc.fillColor('#64748b')
        .fontSize(8)
        .font('Helvetica')
        .text('Auditoría: colaboratium@gmail.com', doc.page.width - 220, 56, { align: 'right', width: 180 });

    doc.y = 118;

    // -------------------------------------------------------------
    // INTRODUCCIÓN
    // -------------------------------------------------------------
    doc.fillColor(primaryColor)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text('1. PROPÓSITO DEL SISTEMA DE MEDICIÓN');

    doc.moveDown(0.3);
    doc.fillColor(textColor)
        .fontSize(9)
        .font('Helvetica')
        .text(
            'El Sistema de Puntuación de Colaboratium es una herramienta transparente y meritocrática ' +
            'diseñada para premiar la celeridad, la excelencia en la atención al inversor, la proactividad del equipo ' +
            'y el cumplimiento de los Acuerdos de Nivel de Servicio (SLA). Cada usuario inicia con 500 Puntos base ' +
            'en una escala de 0 a 1000 Puntos, actualizándose en tiempo real según sus acciones operativas.',
            { align: 'justify', lineGap: 2 }
        );

    doc.moveDown(0.8);

    // -------------------------------------------------------------
    // SECCIÓN 2: ASESORES COMERCIALES
    // -------------------------------------------------------------
    doc.fillColor(accentBlue)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('2. REGLAMENTO DE PUNTUACIÓN PARA ASESORES COMERCIALES');

    doc.moveDown(0.3);

    // Tabla de Suma / Resta Asesores
    const tableTop = doc.y;
    doc.rect(40, tableTop, doc.page.width - 80, 20).fill('#e0f2fe');
    doc.fillColor('#0369a1').fontSize(8.5).font('Helvetica-Bold')
        .text('CRITERIO / EVENTO COMERCIAL', 50, tableTop + 6)
        .text('TIPO', 340, tableTop + 6)
        .text('IMPACTO', 450, tableTop + 6);

    const itemsAsesores = [
        ['Respuesta inicial al Lead en < 5 minutos desde la asignación', 'SUMA', '+15 Pts'],
        ['Respuesta entre 5 y 15 minutos desde la asignación', 'SUMA', '+8 Pts'],
        ['Lead derivado que asiste y participa de Webinar / Meet', 'SUMA', '+20 Pts'],
        ['Inversión cerrada y liquidada con éxito por el inversor', 'SUMA', '+50 Pts'],
        ['Reinversión confirmada (renovación de capital / retención)', 'SUMA', '+35 Pts'],
        ['Ficha CRM 100% validada (DNI, CBU/Alias, Perfil Inversor)', 'SUMA', '+10 Pts'],
        ['Lead asignado sin contactar tras más de 1 hora', 'RESTA', '-10 Pts'],
        ['Lead sin contactar tras 24 hs (Reasignación automática)', 'RESTA', '-40 Pts'],
        ['Ticket de reclamo abierto por un inversor de su cartera', 'RESTA', '-30 Pts'],
        ['Ausentismo en reunión o webinar confirmado con candidatos', 'RESTA', '-50 Pts']
    ];

    let currentY = tableTop + 20;
    itemsAsesores.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, currentY, doc.page.width - 80, 16).fill(bg);
        
        doc.fillColor('#1e293b').fontSize(8).font('Helvetica')
            .text(row[0], 50, currentY + 4, { width: 280 });

        const isPositive = row[1] === 'SUMA';
        doc.fillColor(isPositive ? '#059669' : '#dc2626').font('Helvetica-Bold')
            .text(row[1], 340, currentY + 4)
            .text(row[2], 450, currentY + 4);

        currentY += 16;
    });

    doc.y = currentY + 12;

    // -------------------------------------------------------------
    // SECCIÓN 3: LÍDERES DE EQUIPO
    // -------------------------------------------------------------
    doc.fillColor(accentGold)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('3. REGLAMENTO DE PUNTUACIÓN PARA LÍDERES DE EQUIPO');

    doc.moveDown(0.3);

    const itemsLideres = [
        ['Respuesta y soporte a consultas de sus asesores en < 15 minutos', 'SUMA', '+10 Pts'],
        ['Asesor de su equipo que concreta su primera colocación', 'SUMA', '+30 Pts'],
        ['Equipo que alcanza o supera la meta mensual estipulada', 'SUMA', '+100 Pts'],
        ['Dictado de Webinar de Capacitación o Coaching grupal', 'SUMA', '+25 Pts'],
        ['Asesor con consulta interna sin respuesta por más de 4 horas', 'RESTA', '-20 Pts'],
        ['Asesores inactivos (>14 días sin actividad) sin gestión documentada', 'RESTA', '-15 Pts'],
        ['Solicitud formal de cambio de líder por desatención', 'RESTA', '-50 Pts']
    ];

    const lTop = doc.y;
    doc.rect(40, lTop, doc.page.width - 80, 20).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(8.5).font('Helvetica-Bold')
        .text('CRITERIO DE GESTIÓN Y LIDERAZGO', 50, lTop + 6)
        .text('TIPO', 340, lTop + 6)
        .text('IMPACTO', 450, lTop + 6);

    currentY = lTop + 20;
    itemsLideres.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, currentY, doc.page.width - 80, 16).fill(bg);
        doc.fillColor('#1e293b').fontSize(8).font('Helvetica')
            .text(row[0], 50, currentY + 4, { width: 280 });
        const isPos = row[1] === 'SUMA';
        doc.fillColor(isPos ? '#059669' : '#dc2626').font('Helvetica-Bold')
            .text(row[1], 340, currentY + 4)
            .text(row[2], 450, currentY + 4);
        currentY += 16;
    });

    // -------------------------------------------------------------
    // PÁGINA 2: TEAM OPERATIVO Y SISTEMA DE RANGOS / TIERS
    // -------------------------------------------------------------
    doc.addPage();

    // Mini header página 2
    doc.rect(0, 0, doc.page.width, 40).fill('#0f172a');
    doc.fillColor('#38bdf8').fontSize(11).font('Helvetica-Bold')
        .text('COLABORATIUM • REGLAMENTO DE SCORE (PÁGINA 2 / 2)', 40, 15);
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica')
        .text('ROLES OPERATIVOS & TABLA DE BENEFICIOS', doc.page.width - 250, 15, { align: 'right', width: 210 });

    doc.y = 55;

    // -------------------------------------------------------------
    // SECCIÓN 4: TEAM OPERATIVO (SOPORTE, CRÉDITOS, COMPLIANCE)
    // -------------------------------------------------------------
    doc.fillColor(primaryColor)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('4. REGLAMENTO PARA ROLES OPERATIVOS DEL TEAM');

    doc.moveDown(0.3);

    const itemsTeam = [
        ['[SOPORTE] Resolución de ticket en primer contacto (FCR)', 'SUMA', '+20 Pts'],
        ['[SOPORTE] Tiempo de primera respuesta < 3 minutos en Helpdesk', 'SUMA', '+10 Pts'],
        ['[SOPORTE] Calificación de 5 estrellas en encuesta de satisfacción', 'SUMA', '+15 Pts'],
        ['[SOPORTE] Ticket vencido fuera del SLA estipulado (<2 hs)', 'RESTA', '-20 Pts'],
        ['[CRÉDITOS] Conciliación y acreditación de fondos en < 30 minutos', 'SUMA', '+15 Pts'],
        ['[CRÉDITOS] Semana completa con 0 discrepancias bancarias', 'SUMA', '+50 Pts'],
        ['[CRÉDITOS] Error en carga de CBU o liquidación que genere reclamo', 'RESTA', '-60 Pts'],
        ['[COMPLIANCE] Validación y aprobación de legajo KYC en < 2 horas', 'SUMA', '+10 Pts'],
        ['[COMPLIANCE] Aprobación negligente de legajo adulterado o inválido', 'RESTA', '-50 Pts']
    ];

    const teamTop = doc.y;
    doc.rect(40, teamTop, doc.page.width - 80, 20).fill('#f1f5f9');
    doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold')
        .text('SECTOR Y ACCIÓN OPERATIVA', 50, teamTop + 6)
        .text('TIPO', 340, teamTop + 6)
        .text('IMPACTO', 450, teamTop + 6);

    currentY = teamTop + 20;
    itemsTeam.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, currentY, doc.page.width - 80, 16).fill(bg);
        doc.fillColor('#1e293b').fontSize(8).font('Helvetica')
            .text(row[0], 50, currentY + 4, { width: 280 });
        const isPos = row[1] === 'SUMA';
        doc.fillColor(isPos ? '#059669' : '#dc2626').font('Helvetica-Bold')
            .text(row[1], 340, currentY + 4)
            .text(row[2], 450, currentY + 4);
        currentY += 16;
    });

    doc.y = currentY + 15;

    // -------------------------------------------------------------
    // SECCIÓN 5: TABLA DE RANGOS Y PRIVILEGIOS
    // -------------------------------------------------------------
    doc.fillColor(primaryColor)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('5. ESCALA DE RANGOS Y PRIVILEGIOS EN LA PLATAFORMA');

    doc.moveDown(0.3);

    const tiers = [
        {
            rango: 'DIAMANTE',
            pts: '850 - 1000 Pts',
            color: '#7c3aed',
            bgColor: '#f5f3ff',
            beneficios: 'Prioridad #1 en distribución de Leads Calientes de pauta paga. Badge Diamante en CRM y WhatsApp. Comisión preferencial y reuniones de estrategia con Dirección.'
        },
        {
            rango: 'ORO',
            pts: '700 - 849 Pts',
            color: '#d97706',
            bgColor: '#fffbeb',
            beneficios: 'Asignación preferencial de oportunidades. Mayor cupo de salas simultáneas en Google Meet. Distintivo Dorado en Helpdesk y CRM.'
        },
        {
            rango: 'PLATA',
            pts: '500 - 699 Pts',
            color: '#2563eb',
            bgColor: '#eff6ff',
            beneficios: 'Flujo estándar y continuo de asignación de prospectos. Rango base de ingreso y operación regular sin restricciones.'
        },
        {
            rango: 'BRONCE',
            pts: '350 - 499 Pts',
            color: '#ea580c',
            bgColor: '#fff7ed',
            beneficios: 'Asignación reducida de leads hasta regularizar pendientes. Notificación de coaching y acompañamiento obligatorio con su Líder.'
        },
        {
            rango: 'EN REVISIÓN',
            pts: '0 - 349 Pts',
            color: '#dc2626',
            bgColor: '#fef2f2',
            beneficios: 'Pausa preventiva automática en asignación de nuevos leads. Auditoría integral de cartera y reevaluación por Dirección.'
        }
    ];

    tiers.forEach((t) => {
        const cardY = doc.y;
        doc.rect(40, cardY, doc.page.width - 80, 42).fill(t.bgColor);
        doc.rect(40, cardY, 6, 42).fill(t.color);

        doc.fillColor(t.color).fontSize(10).font('Helvetica-Bold')
            .text(`${t.rango} (${t.pts})`, 54, cardY + 6);

        doc.fillColor(textColor).fontSize(7.8).font('Helvetica')
            .text(t.beneficios, 54, cardY + 20, { width: doc.page.width - 110, lineGap: 1.5 });

        doc.y = cardY + 48;
    });

    doc.moveDown(0.5);

    // -------------------------------------------------------------
    // PIE DE PÁGINA Y AUDITORÍA
    // -------------------------------------------------------------
    doc.rect(40, doc.y, doc.page.width - 80, 36).fill('#f1f5f9');
    doc.fillColor('#475569').fontSize(7.5).font('Helvetica')
        .text(
            'Auditoría y Transparencia: Todos los puntos asignados y deducidos se registran de forma inmutable ' +
            'en el libro mayor de auditoría de Colaboratium bajo supervisión de Dirección General. Cualquier discrepancia ' +
            'puede ser elevada formalmente mediante ticket al sector de Cumplimiento.',
            48, doc.y + 6, { width: doc.page.width - 96, align: 'center', lineGap: 1.5 }
        );

    doc.end();
}

/**
 * Genera el archivo físico del reglamento en la carpeta public/downloads
 */
function ensurePdfReglamentoFisico() {
    try {
        const publicDir = path.join(__dirname, 'public', 'downloads');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }
        const filePath = path.join(publicDir, 'Reglamento_Sistema_de_Puntos_Colaboratium.pdf');
        const ragPdf = path.join(__dirname, '..', 'RAG', 'Colaboratium Reglamento Score 2026 Disponibilidad Declarada.pdf');

        if (fs.existsSync(ragPdf) && fs.statSync(ragPdf).size > 50000) {
            fs.copyFileSync(ragPdf, filePath);
            console.log(`✅ [SCORE PDF]: Archivo oficial con Disponibilidad Declarada sincronizado (${fs.statSync(filePath).size} bytes) en: ${filePath}`);
            return;
        }

        const writeStream = fs.createWriteStream(filePath);
        generarPdfReglamentoScore(writeStream);
        console.log(`✅ [SCORE PDF]: Archivo físico generado en: ${filePath}`);
    } catch (err) {
        console.error('Error generando archivo físico PDF:', err.message);
    }
}

module.exports = {
    calcularRango,
    initScoreTables,
    reclassifyInactiveProspectsAndPruneScores,
    seedInitialScores,
    registrarEventoScore,
    obtenerScoresRanking,
    obtenerScoreDetalle,
    generarPdfReglamentoScore,
    ensurePdfReglamentoFisico,
    calcularMinutosEfectivos,
    actualizarDisponibilidad,
    REGLAS_SCORE_2026
};
