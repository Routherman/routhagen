/**
 * Catálogo inicial de cursos oficiales Colaboratium para el módulo Academia.
 * Se siembra de forma idempotente únicamente cuando `academia_cursos` está vacío,
 * o mediante `seedCursosColaboratium(pool)` sin pisar ediciones posteriores del admin.
 */

const BASE_VIDEO_URL = 'https://routhagent.vercel.app/media/colaboratium-intro.mp4';
const BASE_VIDEO_DURACION_S = 15;

const CURSOS_COLABORATIUM = [
    {
        slug: 'certificacion-asesores-colaboratium',
        nombre: 'Certificación Oficial de Asesores Comerciales Colaboratium',
        descripcion:
            'Ruta obligatoria para Asesores Comerciales adheridos a Global Loan S.A. (BCRA Nº 40.015): modelo P2P no custodial, scoring IA (5%-15%), compliance y penalidades, captación con Meta Ads + UTM, Score 360° y cuestionario oficial de 10 preguntas.',
        estado: 'publicado',
        orden: 1,
        modulos: [
            {
                nombre: 'Módulo 1 · Identidad, Modelo P2P y Seguridad No Custodial',
                orden: 1,
                clases: [
                    {
                        nombre: '1.1 Global Loan S.A. y Registro Oficial BCRA Nº 40.015',
                        descripcion:
                            'Naturaleza legal de Colaboratium como plataforma tecnológica P2P (no banco, financiera ni fondo). Verificación oficial BCRA Nº 40.015, oficinas comerciales en Av. del Libertador 264 Piso 1 Contrafrente (Vicente López) y domicilio legal en Maipú 568 Piso 8° (CABA).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'asesor_bcra_40015'
                    },
                    {
                        nombre: '1.2 Operatoria No Custodial, Costo Cero y Bancos BIND / Coinag',
                        descripcion:
                            'Explicación de la operatoria 100% bancarizada desde el CVU propio del inversor. Costo 0% de comisiones para el inversor (los cargos de plataforma los abona exclusivamente el tomador del crédito).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: 'asesor_no_custodial'
                    },
                    {
                        nombre: '1.3 Mercado 2026, Tasas Variables (~75%–105% TNA) y Agente IA (5%–15%)',
                        descripcion:
                            'Comparativa objetiva frente a plazo fijo/billeteras (16%–24% TNA), bancos (60%–90% TNA) y fintechs (90%–150% TNA). Cómo el Agente IA evalúa Renaper, BCRA, Veraz, Nosis, UIF/Worldsys, cónyuge, empleo registrado y ARCA/AFIP para aprobar solo 5%–15% y atomizar en 20+ microcréditos (Conservador, Intermedio y Avanzado).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 3,
                        obligatoria_clave: null
                    }
                ]
            },
            {
                nombre: 'Módulo 2 · Compliance Obligatorio, Marca y Penalidades',
                orden: 2,
                clases: [
                    {
                        nombre: '2.1 Comunicación Prohibida vs Permitida (Anexo III) y Paleta Oficial',
                        descripcion:
                            'Prohibición estricta de prometer tasas fijas o ganancia garantizada, usar términos como banco/plazo fijo/depósito o recibir efectivo, cripto o transferencias en cuentas personales. Uso obligatorio de paleta (#201E1E, #A28444, #FEFEFE) y Disclaimer Legal completo.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'asesor_compliance_marca'
                    },
                    {
                        nombre: '2.2 Sanciones Contractuales y Reglas de Mensajería Comercial',
                        descripcion:
                            'Por qué no deben enviarse porcentajes de comisiones por escrito en mensajes fríos de prospección. Sanciones de la Carta Oferta: bloqueo inmediato de consola, baja con causa, pérdida de reinversiones futuras y multa contractual de USD 2.000.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: null
                    }
                ]
            },
            {
                nombre: 'Módulo 3 · Captación en Redes, Cierre en 3 Pasos y Score 360°',
                orden: 3,
                clases: [
                    {
                        nombre: '3.1 Campañas Meta Ads ($5.000 ARS/día) y Enlaces UTM de Consola',
                        descripcion:
                            'Configuración de Portfolio Comercial, Fanpage verificada e Instagram profesional. Pauta diaria $5.000 ARS en Reels/Stories 9:16 y Feed 1080x1080 (segmentación 27–65 años Argentina) dirigiendo siempre al enlace UTM de consola.colaboratium.com.ar.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: null
                    },
                    {
                        nombre: '3.2 Protocolo de Cierre en 3 Pasos y Manejo de Objeciones',
                        descripcion:
                            '1) Saludo + link BCRA Nº 40.015 + consulta de plazo (3–6 vs 12 meses); 2) Los 4 pilares de seguridad (CVU propio, 0% costo inversor, filtro IA 5%–15%, atomización 20+ créditos); 3) Enlace UTM de registro + llamada de 5–10 minutos o reunión en Vicente López.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: null
                    },
                    {
                        nombre: '3.3 Sistema Score 360° y Disponibilidad Horaria Declarada',
                        descripcion:
                            'Escala de 0 a 1000 puntos (base 500). Regla de Disponibilidad Declarada para cómputo justo de SLA. Eventos positivos (+15 <5 min, +20 webinar, +50 liquidación, +35 reinversión, +10 CRM completo) vs penalizaciones (-10 >1h, -40 >24h, -50 ausentismo) y rangos Diamante, Oro, Plata, Bronce y En Revisión.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 3,
                        obligatoria_clave: 'asesor_score_360'
                    }
                ]
            },
            {
                nombre: 'Módulo 4 · Evaluación Oficial y Prácticas en Routh Agent',
                orden: 4,
                clases: [
                    {
                        nombre: '4.1 Repaso del Cuestionario Digital de Certificación (10 Preguntas)',
                        descripcion:
                            'Preparación integral para las 10 preguntas de certificación previas a la habilitación de credenciales: BCRA Nº 40.015, tasas variables, filtro IA 5%–15%, no custodia, enlaces UTM, prohibición de captación en cuentas personales, reinversiones en origen, rol del líder, disclaimer y multas.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'asesor_examen_10'
                    },
                    {
                        nombre: '4.2 Entrega de Prácticas Operativas en Routh Agent',
                        descripcion:
                            'Guía paso a paso para completar tus ejercicios prácticos en la pestaña Prácticas (Ticket operativo de simulación, Objeciones competencia, Atribución CRM, Roleplay Compliance y Anuncio Meta Ads + UTM).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: null
                    }
                ]
            }
        ]
    },
    {
        slug: 'programa-lideres-equipos-colaboratium',
        nombre: 'Programa Ejecutivo de Líderes de Equipos Comerciales',
        descripcion:
            'Formación de Líderes de Red Colaboratium: estructura comercial (+10% adicional sobre la bolsa de comisiones del equipo), auditoría normativa BCRA Nº 40.015, gestión de Score de Liderazgo, coaching de inactivos y corrección de prácticas en Academia.',
        estado: 'publicado',
        orden: 2,
        modulos: [
            {
                nombre: 'Módulo 1 · Dirección Comercial, Economía del Líder y Auditoría',
                orden: 1,
                clases: [
                    {
                        nombre: '1.1 Rol del Líder Colaboratium y 10% de Bolsa de Comisiones',
                        descripcion:
                            'Responsabilidad integral sobre la red comercial, beneficio del 10% adicional sobre la bolsa de comisiones generada por el equipo y deber de velar por la comunicación transparente de cada asesor.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'lider_rol_10pct'
                    },
                    {
                        nombre: '1.2 Auditoría de Compliance BCRA Nº 40.015 en Tu Red',
                        descripcion:
                            'Cómo auditar placas publicitarias (paleta #201E1E / #A28444 / #FEFEFE + Disclaimer), links UTM activos, conversaciones de WhatsApp y prevención de desvíos contractuales sancionables (bloqueo / USD 2.000).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: 'lider_auditoria_bcra'
                    }
                ]
            },
            {
                nombre: 'Módulo 2 · Score de Liderazgo y Monitoreo en Tablero de Equipo',
                orden: 2,
                clases: [
                    {
                        nombre: '2.1 Reglas de Score para Líderes (+10 <15m, +30 1ra Colocación, +100 Meta)',
                        descripcion:
                            'Acciones que suman puntos al Líder (+10 soporte <15 min, +30 primera colocación de un asesor, +100 meta mensual, +25 dictado de webinar/coaching) y deducciones (-20 consulta >4h, -15 asesores inactivos >14 días sin gestión, -50 cambio de líder por desatención).',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'lider_score_gestion'
                    },
                    {
                        nombre: '2.2 Lectura Real del Tablero de Academia y Seguimiento de Inactivos',
                        descripcion:
                            'Cómo distinguir en Academia entre clases solo marcadas vs reproducción real y completadas (90% alcance / 80% reproducido) para detectar asesores estancados y acompañarlos en sesiones de coaching.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: null
                    }
                ]
            },
            {
                nombre: 'Módulo 3 · Corrección de Prácticas y Habilitación de Red',
                orden: 3,
                clases: [
                    {
                        nombre: '3.1 Rúbrica para Corregir Prácticas (Aprobado vs Rehacer)',
                        descripcion:
                            'Uso del panel de corrección para evaluar entregas de tus asesores: verificación de Tickets/CRM reales vinculados, calidad de las explicaciones y redacción de devoluciones constructivas (>=20 caracteres) al solicitar "Rehacer".',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 1,
                        obligatoria_clave: 'lider_correccion_practicas'
                    },
                    {
                        nombre: '3.2 Certificación Final de Líder y Lanzamiento de Equipo',
                        descripcion:
                            'Checklist de cierre para aprobar el Cuestionario de 10 Preguntas, configurar disponibilidad declarada de soporte y activar la asignación de asesores en el Organigrama.',
                        proveedor: 'directo',
                        video_ref: BASE_VIDEO_URL,
                        duracion_s: BASE_VIDEO_DURACION_S,
                        orden: 2,
                        obligatoria_clave: null
                    }
                ]
            }
        ]
    }
];

async function seedCursosColaboratium(pool) {
    if (!pool) return { seeded: false, reason: 'no_pool' };

    let cursosCreados = 0;
    let modulosCreados = 0;
    let clasesCreadas = 0;

    for (const curso of CURSOS_COLABORATIUM) {
        const [existCurso] = await pool.query(
            'SELECT id FROM academia_cursos WHERE slug = ? LIMIT 1',
            [curso.slug]
        );

        let cursoId;
        if (existCurso.length > 0) {
            cursoId = existCurso[0].id;
        } else {
            const [resCurso] = await pool.query(
                `INSERT INTO academia_cursos (slug, nombre, descripcion, estado, orden)
                 VALUES (?, ?, ?, ?, ?)`,
                [curso.slug, curso.nombre, curso.descripcion, curso.estado, curso.orden]
            );
            cursoId = resCurso.insertId;
            cursosCreados += 1;
        }

        for (const mod of curso.modulos) {
            const [existMod] = await pool.query(
                'SELECT id FROM academia_modulos WHERE curso_id = ? AND nombre = ? LIMIT 1',
                [cursoId, mod.nombre]
            );

            let moduloId;
            if (existMod.length > 0) {
                moduloId = existMod[0].id;
            } else {
                const [resMod] = await pool.query(
                    'INSERT INTO academia_modulos (curso_id, nombre, orden) VALUES (?, ?, ?)',
                    [cursoId, mod.nombre, mod.orden]
                );
                moduloId = resMod.insertId;
                modulosCreados += 1;
            }

            for (const cl of mod.clases) {
                const [existClase] = await pool.query(
                    'SELECT id FROM academia_clases WHERE modulo_id = ? AND nombre = ? LIMIT 1',
                    [moduloId, cl.nombre]
                );
                if (existClase.length === 0) {
                    await pool.query(
                        `INSERT INTO academia_clases
                         (modulo_id, nombre, descripcion, proveedor, video_ref, duracion_s, orden, obligatoria_clave)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            moduloId,
                            cl.nombre,
                            cl.descripcion,
                            cl.proveedor,
                            cl.video_ref,
                            cl.duracion_s,
                            cl.orden,
                            cl.obligatoria_clave
                        ]
                    );
                    clasesCreadas += 1;
                }
            }
        }
    }

    return {
        seeded: true,
        cursosCreados,
        modulosCreados,
        clasesCreadas
    };
}

module.exports = {
    CURSOS_COLABORATIUM,
    seedCursosColaboratium
};

