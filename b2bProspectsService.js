const crypto = require('crypto');
const db = require('./database');
const xlsx = require('xlsx');

// -------------------------------------------------------------
// NORMALIZACIÓN DETERMINISTA SEGÚN SKILLSCRAP.MD
// -------------------------------------------------------------

function cleanTitle(str) {
    if (!str) return '';
    return str
        .replace(/\b(Mart\.|Corr\.|Lic\.|Dr\.|Dra\.|Arq\.|Ing\.|CPI|CUCICBA|Martillero|Corredor|Público|Inmobiliario)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function toTitleCase(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function normalizeNames(rawFullName, rawFirstName = '', rawLastName = '') {
    let first = cleanTitle(rawFirstName);
    let last = cleanTitle(rawLastName);

    if (!first && !last && rawFullName) {
        const cleaned = cleanTitle(rawFullName);
        const parts = cleaned.split(' ').filter(Boolean);
        if (parts.length === 1) {
            first = parts[0];
            last = '';
        } else if (parts.length === 2) {
            first = parts[0];
            last = parts[1];
        } else if (parts.length >= 3) {
            first = parts.slice(0, parts.length - 1).join(' ');
            last = parts[parts.length - 1];
        }
    }

    return {
        firstName: toTitleCase(first || 'Estimado/a'),
        lastName: toTitleCase(last || '')
    };
}

function normalizeEmail(rawEmail) {
    if (!rawEmail) return { email: null, domain: null };
    const clean = String(rawEmail).trim().toLowerCase();
    if (!clean.includes('@') || !clean.includes('.')) return { email: null, domain: null };
    const parts = clean.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { email: null, domain: null };
    return {
        email: clean,
        domain: parts[1].trim()
    };
}

/**
 * Normalización Telefónica Argentina a E.164 (+549...)
 * Aplica las 6 reglas de skillscrap.md
 */
function normalizePhoneArg(rawPhone) {
    if (!rawPhone) return { raw: null, e164: null };
    const raw = String(rawPhone).trim();
    let digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 6) return { raw, e164: null };

    // Si empieza con 0054 -> quitar 00
    if (digits.startsWith('0054')) digits = digits.substring(2);

    // Si empieza con 0 (prefijo nacional) -> quitar 0
    if (digits.startsWith('0')) digits = digits.substring(1);

    // Si ya empieza con 549
    if (digits.startsWith('549')) {
        digits = digits.substring(3);
    } else if (digits.startsWith('54')) {
        digits = digits.substring(2);
    }

    // Quitar '15' de celular si está después de la característica
    // Casos comunes: 11 15 xxxx xxxx (10 dígitos en total con 15)
    if (digits.startsWith('11') && digits.length === 10 && digits.startsWith('1115')) {
        digits = '11' + digits.substring(4);
    } else if (digits.length === 11 && digits.substring(2, 4) === '15') {
        digits = digits.substring(0, 2) + digits.substring(4);
    } else if (digits.length === 12 && digits.substring(3, 5) === '15') {
        digits = digits.substring(0, 3) + digits.substring(5);
    } else if (digits.length === 12 && digits.substring(4, 6) === '15') {
        digits = digits.substring(0, 4) + digits.substring(6);
    }

    // Longitud esperada de un móvil argentino: 10 dígitos (código de área + número)
    if (digits.length === 8) {
        // Asume AMBA / CABA (11)
        digits = '11' + digits;
    }

    if (digits.length === 10) {
        return {
            raw,
            e164: `+549${digits}`
        };
    }

    // Si no es un celular de 10 dígitos (ej. fijos o números corporativos), guardar raw pero e164 = null
    return {
        raw,
        e164: null
    };
}

function classifyB2BRole(rawRole, rawTitle = '', bio = '') {
    const combined = `${rawRole || ''} ${rawTitle || ''} ${bio || ''}`.toLowerCase();
    const isLeader = [
        'broker', 'martillero', 'team leader', 'leader', 'director', 
        'titular', 'dueño', 'owner', 'responsable', 'socio gerente', 
        'presidente', 'cpi', 'organizador'
    ].some(kw => combined.includes(kw));

    if (isLeader) {
        return {
            detectedRole: 'LIDER_BROKER_POTENCIAL',
            assignedBotFlow: 'FLOW_3_LIDERES'
        };
    }
    return {
        detectedRole: 'ASESOR_POTENCIAL',
        assignedBotFlow: 'FLOW_2_ASESORES'
    };
}

// -------------------------------------------------------------
// SERVICIO DE BASE DE DATOS Y GESTIÓN DE PROSPECTOS B2B
// -------------------------------------------------------------

class B2BProspectsService {
    constructor() {
        this.activeScraperJobs = new Map();
    }

    async getPool() {
        if (!db.pool) await db.initDB();
        return db.pool;
    }

    /**
     * Upsert de prospecto B2B con validación de duplicados por email o phone_e164
     */
    async upsertProspect(data, codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const id = data.id || crypto.randomUUID();

        const { firstName, lastName } = normalizeNames(data.full_name, data.first_name, data.last_name);
        const { email, domain } = normalizeEmail(data.email);
        const { raw: phoneRaw, e164: phoneE164 } = normalizePhoneArg(data.phone || data.phone_raw);
        const { detectedRole, assignedBotFlow } = classifyB2BRole(data.role || data.detected_role, data.title, data.bio);

        let existingId = null;
        if (email) {
            const [byEmail] = await pool.query(
                'SELECT id FROM b2b_prospects WHERE email = ? AND codigo_empresa = ? LIMIT 1',
                [email, codigoEmpresa]
            );
            if (byEmail && byEmail.length > 0) existingId = byEmail[0].id;
        }
        if (!existingId && phoneE164) {
            const [byPhone] = await pool.query(
                'SELECT id FROM b2b_prospects WHERE phone_e164 = ? AND codigo_empresa = ? LIMIT 1',
                [phoneE164, codigoEmpresa]
            );
            if (byPhone && byPhone.length > 0) existingId = byPhone[0].id;
        }
        // Solo matchear por source_url si es una URL específica de perfil individual de agente, no un padrón general
        if (!existingId && data.source_url && (data.source_url.includes('/agente/') || data.source_url.includes('/perfil/'))) {
            const [byUrl] = await pool.query(
                'SELECT id FROM b2b_prospects WHERE source_url = ? AND codigo_empresa = ? LIMIT 1',
                [data.source_url, codigoEmpresa]
            );
            if (byUrl && byUrl.length > 0) existingId = byUrl[0].id;
        }
        const officeCandidate = data.office_name || data.company_or_board || null;
        if (!existingId && firstName && lastName && officeCandidate) {
            const [byName] = await pool.query(
                'SELECT id FROM b2b_prospects WHERE first_name = ? AND last_name = ? AND office_name = ? AND codigo_empresa = ? LIMIT 1',
                [firstName, lastName, officeCandidate, codigoEmpresa]
            );
            if (byName && byName.length > 0) existingId = byName[0].id;
        }

        const sourceLayer = data.source_layer || 'CAPA_1_REMAX';
        const sourceUrl = data.source_url || null;
        const companyOrBoard = data.company_or_board || data.office_name || 'RE/MAX';
        const officeName = data.office_name || data.company_or_board || null;
        const brokerOwnerName = data.broker_owner_name || null;
        const city = data.city || null;
        const province = data.province || null;

        const segmentoOrigen = data.segmento_origen || (
            sourceLayer === 'CAPA_1_REMAX' ? 'FRANQUICIA_INMOBILIARIA' :
            sourceLayer === 'CAPA_2_PADRONES_CORREDORES' ? 'CORREDORES_MATRICULADOS' :
            sourceLayer === 'CAPA_3_PREVISIONALISTAS' ? 'ABOGADOS_PREVISIONALISTAS' :
            sourceLayer === 'CAPA_5_PAS' ? 'PRODUCTOR_SEGUROS_PAS' : 'GENERAL'
        );

        const plantillaSugerida = data.plantilla_sugerida || (
            segmentoOrigen === 'FRANQUICIA_INMOBILIARIA' ? 'PLANTILLA_FRANQUICIAS' :
            segmentoOrigen === 'CORREDORES_MATRICULADOS' ? 'PLANTILLA_CORREDORES_MATRICULADOS' :
            segmentoOrigen === 'ABOGADOS_PREVISIONALISTAS' ? 'PLANTILLA_PREVISIONAL' :
            segmentoOrigen === 'PRODUCTOR_SEGUROS_PAS' ? 'PLANTILLA_PRODUCTORES_SEGUROS' : 'PLANTILLA_GENERAL'
        );

        // Ensure metadata_extra also contains the origin and template
        let metaObj = {};
        if (data.metadata_extra) {
            metaObj = typeof data.metadata_extra === 'string' ? JSON.parse(data.metadata_extra) : { ...data.metadata_extra };
        }
        metaObj.origen_segmento = metaObj.origen_segmento || segmentoOrigen;
        metaObj.plantilla_sugerida = metaObj.plantilla_sugerida || plantillaSugerida;
        const metaStr = JSON.stringify(metaObj);

        if (existingId) {
            await pool.query(`
                UPDATE b2b_prospects SET
                    first_name = COALESCE(?, first_name),
                    last_name = COALESCE(?, last_name),
                    email = COALESCE(?, email),
                    email_domain = COALESCE(?, email_domain),
                    phone_raw = COALESCE(?, phone_raw),
                    phone_e164 = COALESCE(?, phone_e164),
                    detected_role = ?,
                    assigned_bot_flow = ?,
                    company_or_board = COALESCE(?, company_or_board),
                    office_name = COALESCE(?, office_name),
                    broker_owner_name = COALESCE(?, broker_owner_name),
                    city = COALESCE(?, city),
                    province = COALESCE(?, province),
                    source_layer = ?,
                    segmento_origen = COALESCE(?, segmento_origen),
                    plantilla_sugerida = COALESCE(?, plantilla_sugerida),
                    source_url = COALESCE(?, source_url),
                    metadata_extra = COALESCE(?, metadata_extra)
                WHERE id = ? AND codigo_empresa = ?
            `, [
                firstName, lastName, email, domain, phoneRaw, phoneE164,
                detectedRole, assignedBotFlow, companyOrBoard, officeName, brokerOwnerName,
                city, province, sourceLayer, segmentoOrigen, plantillaSugerida, sourceUrl, metaStr, existingId, codigoEmpresa
            ]);
            return { id: existingId, action: 'UPDATED' };
        }

        await pool.query(`
            INSERT INTO b2b_prospects (
                id, codigo_empresa, first_name, last_name, email, email_domain,
                phone_raw, phone_e164, detected_role, assigned_bot_flow,
                company_or_board, office_name, broker_owner_name, city, province,
                source_layer, segmento_origen, plantilla_sugerida, source_url, campaign_status, metadata_extra
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NUEVO', ?)
        `, [
            id, codigoEmpresa, firstName, lastName, email, domain,
            phoneRaw, phoneE164, detectedRole, assignedBotFlow,
            companyOrBoard, officeName, brokerOwnerName, city, province,
            sourceLayer, segmentoOrigen, plantillaSugerida, sourceUrl, metaStr
        ]);

        return { id, action: 'INSERTED' };
    }

    /**
     * Obtener listado de prospectos con filtros avanzados y paginación
     */
    async getProspects(codigoEmpresa = 'KRZMJI', queryParams = {}) {
        const pool = await this.getPool();
        const {
            layer,
            role,
            province,
            city,
            office,
            status,
            segmento,
            plantilla,
            search,
            limit = 50,
            offset = 0
        } = queryParams;

        let query = 'SELECT * FROM b2b_prospects WHERE codigo_empresa = ?';
        const params = [codigoEmpresa];

        if (layer && layer !== 'ALL') {
            query += ' AND source_layer = ?';
            params.push(layer);
        }
        if (segmento && segmento !== 'ALL') {
            query += ' AND segmento_origen = ?';
            params.push(segmento);
        }
        if (plantilla && plantilla !== 'ALL') {
            query += ' AND plantilla_sugerida = ?';
            params.push(plantilla);
        }
        if (role && role !== 'ALL') {
            query += ' AND detected_role = ?';
            params.push(role);
        }
        if (province && province !== 'ALL') {
            query += ' AND province = ?';
            params.push(province);
        }
        if (city && city !== 'ALL') {
            query += ' AND city = ?';
            params.push(city);
        }
        if (office && office !== 'ALL') {
            query += ' AND (office_name LIKE ? OR company_or_board LIKE ?)';
            params.push(`%${office}%`, `%${office}%`);
        }
        if (status && status !== 'ALL') {
            query += ' AND campaign_status = ?';
            params.push(status);
        }
        if (search && search.trim()) {
            const s = `%${search.trim()}%`;
            query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone_raw LIKE ? OR phone_e164 LIKE ? OR office_name LIKE ? OR city LIKE ?)';
            params.push(s, s, s, s, s, s, s);
        }

        query += ' ORDER BY extracted_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit, 10), parseInt(offset, 10));

        const [rows] = await pool.query(query, params);

        // Contar total con los mismos filtros
        let countQuery = 'SELECT COUNT(*) as total FROM b2b_prospects WHERE codigo_empresa = ?';
        const countParams = [codigoEmpresa];
        if (layer && layer !== 'ALL') { countQuery += ' AND source_layer = ?'; countParams.push(layer); }
        if (segmento && segmento !== 'ALL') { countQuery += ' AND segmento_origen = ?'; countParams.push(segmento); }
        if (plantilla && plantilla !== 'ALL') { countQuery += ' AND plantilla_sugerida = ?'; countParams.push(plantilla); }
        if (role && role !== 'ALL') { countQuery += ' AND detected_role = ?'; countParams.push(role); }
        if (province && province !== 'ALL') { countQuery += ' AND province = ?'; countParams.push(province); }
        if (city && city !== 'ALL') { countQuery += ' AND city = ?'; countParams.push(city); }
        if (office && office !== 'ALL') { countQuery += ' AND (office_name LIKE ? OR company_or_board LIKE ?)'; countParams.push(`%${office}%`, `%${office}%`); }
        if (status && status !== 'ALL') { countQuery += ' AND campaign_status = ?'; countParams.push(status); }
        if (search && search.trim()) {
            const s = `%${search.trim()}%`;
            countQuery += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone_raw LIKE ? OR phone_e164 LIKE ? OR office_name LIKE ? OR city LIKE ?)';
            countParams.push(s, s, s, s, s, s, s);
        }

        const [countRes] = await pool.query(countQuery, countParams);
        const total = countRes[0]?.total || 0;

        return { prospects: rows, total, limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
    }

    /**
     * Resumen de KPIs Superiores para el Dashboard B2B
     */
    async getKPIs(codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as with_email,
                SUM(CASE WHEN phone_e164 IS NOT NULL AND phone_e164 != '' THEN 1 ELSE 0 END) as with_whatsapp,
                SUM(CASE WHEN detected_role = 'LIDER_BROKER_POTENCIAL' THEN 1 ELSE 0 END) as leaders_count,
                SUM(CASE WHEN detected_role = 'ASESOR_POTENCIAL' THEN 1 ELSE 0 END) as advisors_count,
                SUM(CASE WHEN campaign_status = 'OPT_OUT_BAJA' THEN 1 ELSE 0 END) as opt_out_count,
                SUM(CASE WHEN campaign_status = 'LOTE_GMAIL_EXPORTADO' THEN 1 ELSE 0 END) as gmail_exported_count,
                SUM(CASE WHEN campaign_status = 'CONVERTIDO_ASESOR' THEN 1 ELSE 0 END) as converted_count
            FROM b2b_prospects
            WHERE codigo_empresa = ?
        `, [codigoEmpresa]);

        return rows[0] || {
            total: 0,
            with_email: 0,
            with_whatsapp: 0,
            leaders_count: 0,
            advisors_count: 0,
            opt_out_count: 0,
            gmail_exported_count: 0,
            converted_count: 0
        };
    }

    /**
     * Generador de Lotes Seguros para Gmail con Throttling Anti-Spam
     * - Limita a un máximo de 40 contactos por día para remax.com.ar
     * - Mezcla oficinas y ciudades distintas
     * - Marca campaign_status = 'LOTE_GMAIL_EXPORTADO'
     * - Genera el CSV con columnas para Mail Merge
     */
    async generateGmailBatch(options = {}) {
        const pool = await this.getPool();
        const {
            codigoEmpresa = 'KRZMJI',
            maxPerDomain = 40,
            totalBatchSize = 50,
            targetRole = null, // 'ASESOR_POTENCIAL' o 'LIDER_BROKER_POTENCIAL' o null
            targetSegment = null, // 'FRANQUICIA_INMOBILIARIA', 'CORREDORES_MATRICULADOS', 'PRODUCTOR_SEGUROS_PAS' o null
            webinarDate = 'Lunes 3 de Noviembre',
            webinarTime = '10:00',
            webinarTitle = 'Reunión Informativa Red de Asesores Independientes',
            bookingLink = 'https://colaboratium.com.ar/reservar',
            optOutBaseUrl = 'https://colaboratium.com.ar/baja',
            syncToAgenda = true
        } = options;

        // 1. Obtener prospectos disponibles para envío (que tengan email y no estén en baja o ya exportados recientemente)
        let query = `
            SELECT * FROM b2b_prospects
            WHERE codigo_empresa = ?
              AND email IS NOT NULL AND email != ''
              AND campaign_status IN ('NUEVO', 'RESPONDIO_INTERESADO')
              AND (opt_out_at IS NULL)
        `;
        const params = [codigoEmpresa];

        if (targetRole && targetRole !== 'ALL') {
            query += ' AND detected_role = ?';
            params.push(targetRole);
        }

        if (targetSegment && targetSegment !== 'ALL') {
            query += ' AND segmento_origen = ?';
            params.push(targetSegment);
        }

        // Orden aleatorio/rotativo para mezclar oficinas
        query += ' ORDER BY email_domain, city, RAND() LIMIT 200';
        const [candidates] = await pool.query(query, params);

        // 2. Aplicar throttling por dominio y por oficina
        const domainCounts = {};
        const officeCounts = {};
        const selected = [];

        for (const p of candidates) {
            if (selected.length >= totalBatchSize) break;

            const domain = p.email_domain || 'general';
            const office = p.office_name || 'general';

            // Throttling especial para remax.com.ar o configurable
            const domainLimit = (domain === 'remax.com.ar') ? maxPerDomain : 50;
            if ((domainCounts[domain] || 0) >= domainLimit) continue;

            // Evitar saturar la misma oficina en el mismo día (máx 3 mails por oficina física por tanda)
            if ((officeCounts[office] || 0) >= 3) continue;

            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
            officeCounts[office] = (officeCounts[office] || 0) + 1;
            selected.push(p);
        }

        if (selected.length === 0) {
            return {
                success: false,
                message: 'No se encontraron prospectos nuevos con email disponibles que cumplan con los filtros de throttling.',
                count: 0,
                csv: ''
            };
        }

        // 3. Actualizar estado a LOTE_GMAIL_EXPORTADO
        const selectedIds = selected.map(p => p.id);
        await pool.query(`
            UPDATE b2b_prospects
            SET campaign_status = 'LOTE_GMAIL_EXPORTADO',
                last_contacted_at = CURRENT_TIMESTAMP
            WHERE id IN (?)
        `, [selectedIds]);

        // 4. Opcional: Sincronizar en la Agenda CRM existente (contactos)
        if (syncToAgenda) {
            for (const p of selected) {
                try {
                    const phoneVal = p.phone_e164 || p.phone_raw || `S/T-${p.id.substring(0, 8)}`;
                    await pool.query(`
                        INSERT INTO contactos (
                            telefono, codigo_empresa, nombre, email, direccion, grupo, rol_asignado,
                            estado_resolucion, resumen_necesidad, metadata_extra
                        ) VALUES (?, ?, ?, ?, ?, 'PROSPECTO ASESORES', 'Prospecto Asesores', 'PENDIENTE', ?, ?)
                        ON DUPLICATE KEY UPDATE
                            email = COALESCE(VALUES(email), email),
                            nombre = VALUES(nombre),
                            resumen_necesidad = VALUES(resumen_necesidad)
                    `, [
                        phoneVal,
                        codigoEmpresa,
                        `${p.first_name} ${p.last_name}`.trim(),
                        p.email,
                        [p.office_name, p.city, p.province].filter(Boolean).join(', '),
                        `B2B ${p.detected_role === 'LIDER_BROKER_POTENCIAL' ? 'Líder / Broker' : 'Asesor'} · ${p.company_or_board || p.office_name}`,
                        JSON.stringify({
                            b2b_prospect_id: p.id,
                            source_layer: p.source_layer,
                            detected_role: p.detected_role,
                            office: p.office_name,
                            city: p.city
                        })
                    ]);
                } catch(e) {}
            }
        }

        // 5. Generar CSV listo para Mail Merge de Gmail
        const headers = [
            'First Name',
            'Last Name',
            'Email',
            'Office',
            'City',
            'Role_Type',
            'Segmento_Origen',
            'Plantilla_Sugerida',
            'Webinar_Date',
            'Webinar_Time',
            'Webinar_Title',
            'Booking_Link',
            'OptOut_Link'
        ];

        const escapeCSV = (field) => {
            if (field === null || field === undefined) return '""';
            const str = String(field).replace(/"/g, '""');
            return `"${str}"`;
        };

        const rows = [headers.join(',')];
        for (const p of selected) {
            const roleTypeDesc = p.detected_role === 'LIDER_BROKER_POTENCIAL' ? 'Broker / Martillero' : 'Asesor';
            const optOutUrl = `${optOutBaseUrl}?email=${encodeURIComponent(p.email)}&token=${p.id}`;
            const row = [
                escapeCSV(p.first_name),
                escapeCSV(p.last_name),
                escapeCSV(p.email),
                escapeCSV(p.office_name || p.company_or_board || 'Red Inmobiliaria'),
                escapeCSV(p.city || 'Argentina'),
                escapeCSV(roleTypeDesc),
                escapeCSV(p.segmento_origen || 'FRANQUICIA_INMOBILIARIA'),
                escapeCSV(p.plantilla_sugerida || 'PLANTILLA_FRANQUICIAS'),
                escapeCSV(webinarDate),
                escapeCSV(webinarTime),
                escapeCSV(webinarTitle),
                escapeCSV(bookingLink),
                escapeCSV(optOutUrl)
            ];
            rows.push(row.join(','));
        }

        const csvString = rows.join('\r\n');

        return {
            success: true,
            count: selected.length,
            selectedIds,
            csv: csvString,
            domainCounts,
            officeCounts
        };
    }

    /**
     * Convertir Prospecto B2B en Asesor Activo (Módulo 8)
     */
    async convertToActiveAdvisor(prospectId, codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const [rows] = await pool.query('SELECT * FROM b2b_prospects WHERE id = ? AND codigo_empresa = ?', [prospectId, codigoEmpresa]);
        if (!rows || rows.length === 0) return { success: false, message: 'Prospecto no encontrado' };

        const p = rows[0];
        const fullName = `${p.first_name} ${p.last_name}`.trim();
        const phone = p.phone_e164 || p.phone_raw || `54911${Math.floor(10000000 + Math.random() * 90000000)}`;

        // 1. Marcar como CONVERTIDO_ASESOR en b2b_prospects
        await pool.query('UPDATE b2b_prospects SET campaign_status = "CONVERTIDO_ASESOR" WHERE id = ?', [prospectId]);

        // 2. Dar de alta en contactos con rol Asesores y grupo ASESORES
        const [cRes] = await pool.query(`
            INSERT INTO contactos (
                telefono, codigo_empresa, nombre, email, direccion, grupo, rol_asignado,
                estado_resolucion, resumen_necesidad, metadata_extra
            ) VALUES (?, ?, ?, ?, ?, 'ASESORES', 'Asesores', 'RESUELTO', 'Asesor Comercial Convertido desde B2B', ?)
            ON DUPLICATE KEY UPDATE
                nombre = VALUES(nombre),
                email = COALESCE(VALUES(email), email),
                grupo = 'ASESORES',
                rol_asignado = 'Asesores',
                estado_resolucion = 'RESUELTO'
        `, [
            phone,
            codigoEmpresa,
            fullName,
            p.email,
            [p.office_name, p.city, p.province].filter(Boolean).join(', '),
            JSON.stringify({
                convertido_desde_b2b_id: p.id,
                origen: p.source_layer,
                oficina_origen: p.office_name,
                fecha_conversion: new Date().toISOString()
            })
        ]);

        return {
            success: true,
            message: `Prospecto ${fullName} convertido con éxito en Asesor Activo`,
            prospectId,
            contactId: cRes.insertId || null
        };
    }

    /**
     * Procesar baja / Opt-Out (Ley 25.326 Art. 27)
     */
    async recordOptOut(email, prospectId = null, codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const cleanEmail = (email || '').trim().toLowerCase();
        if (!cleanEmail) return false;

        await pool.query(`
            UPDATE b2b_prospects
            SET campaign_status = 'OPT_OUT_BAJA',
                opt_out_at = CURRENT_TIMESTAMP
            WHERE (email = ? OR id = ?) AND codigo_empresa = ?
        `, [cleanEmail, prospectId || '', codigoEmpresa]);

        // Registrar en desuscripciones de email para bloquear permanentemente
        await db.registrarDesuscripcion(codigoEmpresa, cleanEmail, 'Baja solicitada vía enlace Opt-Out Ley 25.326');
        return true;
    }

    /**
     * Importador de CSV / JSON manual con normalización y clasificación
     */
    async importManualData(items = [], sourceLayer = 'CAPA_1_REMAX', codigoEmpresa = 'KRZMJI') {
        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        for (const item of items) {
            try {
                const res = await this.upsertProspect({
                    ...item,
                    source_layer: sourceLayer
                }, codigoEmpresa);
                if (res.action === 'INSERTED') inserted++;
                else if (res.action === 'UPDATED') updated++;
            } catch (err) {
                console.error('[B2B Import] Error en fila:', err.message);
                skipped++;
            }
        }

        return { inserted, updated, skipped, total: items.length };
    }

    /**
     * Precargar datos reales de RE/MAX y Colegios desde el Excel de Prospección
     * Esto puebla instantáneamente el módulo con oficinas, corredores y brokers ya relevados.
     */
    async seedFromLocalExcel(excelPath = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx', codigoEmpresa = 'KRZMJI') {
        try {
            const wb = xlsx.readFile(excelPath);
            const ws = wb.Sheets['Base'];
            if (!ws) return { success: false, message: 'Hoja Base no encontrada' };

            const rows = xlsx.utils.sheet_to_json(ws).filter(r => r.ID && typeof r.ID === 'number');
            let count = 0;

            for (const r of rows) {
                const org = r['Organización'] || '';
                const tipo = r['Tipo'] || '';
                const segmento = r['Segmento'] || '';
                
                let layer = 'CAPA_1_REMAX';
                if (tipo.toLowerCase().includes('re/max') || org.toLowerCase().includes('re/max')) {
                    layer = 'CAPA_1_REMAX';
                } else if (tipo.toLowerCase().includes('century') || org.toLowerCase().includes('century')) {
                    layer = 'CAPA_1_REMAX'; // Redes de agencias
                } else if (segmento.toLowerCase().includes('inmobiliarios') || tipo.toLowerCase().includes('colegio') || tipo.toLowerCase().includes('estudio')) {
                    layer = 'CAPA_2_PADRONES_CORREDORES';
                } else if (segmento.toLowerCase().includes('previsionales')) {
                    layer = 'CAPA_3_PREVISIONALISTAS';
                } else if (segmento.toLowerCase().includes('seguros')) {
                    layer = 'CAPA_5_PAS';
                }

                const contactPerson = r['Contacto público (cargo y nombre)'] || '';
                const names = normalizeNames(contactPerson, '', '');
                const roleCombined = `${tipo} ${contactPerson} ${r['Prioridad'] || ''}`;

                await this.upsertProspect({
                    first_name: names.firstName !== 'Estimado/a' ? names.firstName : org.split(' ')[0],
                    last_name: names.lastName || org.split(' ').slice(1).join(' '),
                    email: r['Email institucional'],
                    phone: r['Teléfono'],
                    role: roleCombined,
                    company_or_board: org,
                    office_name: org,
                    broker_owner_name: contactPerson || null,
                    city: r['Ciudad / barrio'],
                    province: r['Provincia'],
                    source_layer: layer,
                    source_url: r['Sitio web'] || r['URL fuente'],
                    metadata_extra: {
                        calidad_mail: r['Calidad del mail'],
                        nota_abordaje: r['Nota de abordaje'],
                        prioridad: r['Prioridad'],
                        id_origen: r.ID
                    }
                }, codigoEmpresa);
                count++;
            }

            return { success: true, count };
        } catch (e) {
            console.error('Error seeding B2B from excel:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Importar Lotes de Agentes y Brokers RE/MAX desde el Excel oficial
     * (Colaboratium_REMAX_agentes_lotes1-2.xlsx)
     */
    async importRemaxLotesExcel(excelPath = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_REMAX_agentes_lotes1-2.xlsx', codigoEmpresa = 'KRZMJI') {
        try {
            console.log(`📥 [B2B Import] Leyendo Excel de Lotes RE/MAX: ${excelPath}...`);
            const wb = xlsx.readFile(excelPath);
            const sheetName = wb.Sheets['Agentes REMAX'] ? 'Agentes REMAX' : wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            if (!ws) return { success: false, message: `Hoja ${sheetName} no encontrada` };

            const rows = xlsx.utils.sheet_to_json(ws);
            let inserted = 0;
            let updated = 0;
            let skipped = 0;
            let withEmail = 0;
            let withPhone = 0;
            let leadersCount = 0;
            let advisorsCount = 0;

            for (const r of rows) {
                const fullName = r['Nombre completo'] || `${r['Nombre'] || ''} ${r['Apellido'] || ''}`.trim();
                if (!fullName) {
                    skipped++;
                    continue;
                }

                const rawRole = r['Rol'] || 'agente';
                const isBroker = rawRole.toLowerCase().includes('broker') || rawRole.toLowerCase().includes('martillero') || rawRole.toLowerCase().includes('lider');
                const detectedRole = isBroker ? 'LIDER_BROKER_POTENCIAL' : 'ASESOR_POTENCIAL';
                const assignedBotFlow = isBroker ? 'FLOW_3_LIDERES' : 'FLOW_2_ASESORES';

                if (isBroker) leadersCount++;
                else advisorsCount++;

                const email = r['Email'] || null;
                const phone = r['Celular'] || r['WhatsApp'] || null;

                if (email && email.includes('@')) withEmail++;
                if (phone) withPhone++;

                const office = r['Oficina'] || 'RE/MAX Argentina';
                const city = r['Ciudad'] || null;
                const province = r['Provincia'] || null;
                const sourceUrl = r['URL del perfil (fuente)'] || null;

                const meta = {
                    matricula: r['Matrícula'] || null,
                    propiedades: r['Propiedades'] || null,
                    tipo_mail: r['Tipo de mail'] || null,
                    fecha_relevamiento: r['Fecha relevamiento'] || null,
                    estado_origen: r['Estado'] || 'Pendiente',
                    lote: 'LOTES_1_Y_2'
                };

                const res = await this.upsertProspect({
                    full_name: fullName,
                    first_name: r['Nombre'],
                    last_name: r['Apellido'],
                    email: email,
                    phone: phone,
                    role: rawRole,
                    detected_role: detectedRole,
                    assigned_bot_flow: assignedBotFlow,
                    company_or_board: 'RE/MAX Argentina',
                    office_name: office,
                    city: city,
                    province: province,
                    source_layer: 'CAPA_1_REMAX',
                    source_url: sourceUrl,
                    metadata_extra: meta
                }, codigoEmpresa);

                if (res.action === 'INSERTED') inserted++;
                else if (res.action === 'UPDATED') updated++;
            }

            console.log(`✅ [B2B Import] Lotes 1 y 2 importados: ${inserted} nuevos, ${updated} actualizados de ${rows.length} perfiles.`);
            return {
                success: true,
                totalInExcel: rows.length,
                inserted,
                updated,
                skipped,
                withEmail,
                withPhone,
                leadersCount,
                advisorsCount
            };
        } catch (e) {
            console.error('Error importing REMAX lotes excel:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * Incorporación Masiva o Individual a la Agenda CRM con Capas del 1 al 5
     * Identifica el origen (Capa 1 a 5), asigna la plantilla y etiquetas correspondientes,
     * inserta/actualiza en la tabla `contactos` y marca en `b2b_prospects`.
     */
    async incorporateToCRM(options = {}) {
        const pool = await this.getPool();
        const {
            prospectIds = [],
            targetCapa = 'AUTO', // 'AUTO' | 'CAPA_1_REMAX' | 'CAPA_2_PADRONES_CORREDORES' | 'CAPA_3_PREVISIONALISTAS' | 'CAPA_4_DESARROLLADORES' | 'CAPA_5_PAS'
            filters = null,
            codigoEmpresa = 'KRZMJI'
        } = options;

        // Metadatos oficiales de las Capas 1 al 5
        const LAYERS_CONFIG = {
            'CAPA_1_REMAX': {
                num: 1,
                nombre: 'Capa 1: Franquicias Inmobiliarias (RE/MAX, C21)',
                tag: 'CAPA_1_FRANQUICIAS',
                segmento: 'FRANQUICIA_INMOBILIARIA',
                templateEmail: 'Prospección Fría: Agentes Inmobiliarios RE/MAX (Flujo 2 - Capa 1)',
                templateWhatsapp: 'Prospección WhatsApp: Agentes Franquicias (Capa 1)',
                templateLeaderEmail: 'Prospección Fría: Broker / Martillero RE/MAX (Flujo 3)'
            },
            'CAPA_2_PADRONES_CORREDORES': {
                num: 2,
                nombre: 'Capa 2: Corredores Matriculados Independientes',
                tag: 'CAPA_2_CORREDORES',
                segmento: 'CORREDORES_MATRICULADOS',
                templateEmail: 'Prospección Fría: Corredores Matriculados (Capa 2)',
                templateWhatsapp: 'Prospección WhatsApp: Corredores Matriculados (Capa 2)',
                templateLeaderEmail: 'Prospección Fría: Corredores Matriculados (Capa 2)'
            },
            'CAPA_3_PREVISIONALISTAS': {
                num: 3,
                nombre: 'Capa 3: Abogados y Gestores Previsionales',
                tag: 'CAPA_3_PREVISIONAL',
                segmento: 'ABOGADOS_PREVISIONALISTAS',
                templateEmail: 'Prospección Fría: Abogados y Gestores Previsionales (Capa 3)',
                templateWhatsapp: 'Prospección WhatsApp: Previsionales (Capa 3)',
                templateLeaderEmail: 'Prospección Fría: Abogados y Gestores Previsionales (Capa 3)'
            },
            'CAPA_4_DESARROLLADORES': {
                num: 4,
                nombre: 'Capa 4: Desarrolladores Urbanos y Fideicomisos',
                tag: 'CAPA_4_DESARROLLADORES',
                segmento: 'DESARROLLADORES_URBANOS',
                templateEmail: 'Prospección Fría: Desarrolladores Urbanos y Fideicomisos (Capa 4)',
                templateWhatsapp: 'Prospección WhatsApp: Desarrolladores Urbanos (Capa 4)',
                templateLeaderEmail: 'Prospección Fría: Desarrolladores Urbanos y Fideicomisos (Capa 4)'
            },
            'CAPA_5_PAS': {
                num: 5,
                nombre: 'Capa 5: Productores Asesores de Seguros (PAS)',
                tag: 'CAPA_5_SEGUROS_PAS',
                segmento: 'PRODUCTOR_SEGUROS_PAS',
                templateEmail: 'Prospección Fría: Productores Asesores de Seguros PAS (Capa 5)',
                templateWhatsapp: 'Prospección WhatsApp: Productores Seguros PAS (Capa 5)',
                templateLeaderEmail: 'Prospección Fría: Productores Asesores de Seguros PAS (Capa 5)'
            }
        };

        // 1. Obtener los prospectos a incorporar
        let targets = [];
        if (Array.isArray(prospectIds) && prospectIds.length > 0) {
            const [rows] = await pool.query(
                'SELECT * FROM b2b_prospects WHERE codigo_empresa = ? AND id IN (?)',
                [codigoEmpresa, prospectIds]
            );
            targets = rows;
        } else if (filters) {
            const result = await this.getProspects(codigoEmpresa, { ...filters, limit: 1000, offset: 0 });
            targets = result.prospects || [];
        }

        if (targets.length === 0) {
            return {
                success: false,
                message: 'No se encontraron prospectos para incorporar.',
                count: 0
            };
        }

        let insertedCount = 0;
        let updatedCount = 0;
        const processedIds = [];
        const layerCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        for (const p of targets) {
            try {
                let effectiveLayerKey = (targetCapa && targetCapa !== 'AUTO') ? targetCapa : (p.source_layer || 'CAPA_1_REMAX');
                if (!LAYERS_CONFIG[effectiveLayerKey]) {
                    effectiveLayerKey = 'CAPA_1_REMAX';
                }
                const layerCfg = LAYERS_CONFIG[effectiveLayerKey];
                layerCounts[layerCfg.num] = (layerCounts[layerCfg.num] || 0) + 1;

                const isLeader = p.detected_role === 'LIDER_BROKER_POTENCIAL';
                const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Prospecto B2B';
                
                let phone = p.phone_e164;
                if (!phone && p.phone_raw) {
                    const norm = normalizePhoneArg(p.phone_raw);
                    phone = norm.e164;
                }
                if (!phone) {
                    phone = `B2B-${p.id.replace(/-/g, '').substring(0, 10)}`;
                }

                // Nunca promover prospectos B2B fríos directamente a LIDERES / Asesores sin login o solicitud de participación
                const grupo = isLeader ? 'PROSPECTO LIDERES' : 'PROSPECTO ASESORES';
                const rolAsignado = isLeader ? 'Prospecto Lideres' : 'Prospecto Asesores';

                const suggestedEmailTemplate = isLeader ? (layerCfg.templateLeaderEmail || layerCfg.templateEmail) : layerCfg.templateEmail;
                const suggestedWhatsappTemplate = layerCfg.templateWhatsapp;

                const metaExtra = {
                    b2b_prospect_id: p.id,
                    origen_b2b: true,
                    origen_capa: effectiveLayerKey,
                    capa_numero: layerCfg.num,
                    capa_codigo: effectiveLayerKey,
                    capa_nombre: layerCfg.nombre,
                    capa_tag: layerCfg.tag,
                    segmento_origen: layerCfg.segmento,
                    plantilla_email_sugerida: suggestedEmailTemplate,
                    plantilla_whatsapp_sugerida: suggestedWhatsappTemplate,
                    canal_recomendado: p.phone_e164 ? 'WHATSAPP' : (p.email ? 'EMAIL' : 'WHATSAPP'),
                    detected_role: p.detected_role,
                    office_name: p.office_name,
                    city: p.city,
                    province: p.province,
                    sync_timestamp: new Date().toISOString()
                };

                const resumen = `[${layerCfg.tag}] ${p.office_name || ''} ${p.city ? '(' + p.city + ')' : ''} · Plantilla: ${suggestedEmailTemplate}`;

                const [res] = await pool.query(`
                    INSERT INTO contactos (
                        telefono, codigo_empresa, nombre, email, direccion, grupo, rol_asignado,
                        estado_resolucion, resumen_necesidad, metadata_extra
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)
                    ON DUPLICATE KEY UPDATE
                        nombre = VALUES(nombre),
                        email = COALESCE(VALUES(email), email),
                        grupo = VALUES(grupo),
                        rol_asignado = VALUES(rol_asignado),
                        resumen_necesidad = VALUES(resumen_necesidad),
                        metadata_extra = VALUES(metadata_extra)
                `, [
                    phone,
                    codigoEmpresa,
                    fullName,
                    p.email || null,
                    [p.office_name, p.city, p.province].filter(Boolean).join(', ') || null,
                    grupo,
                    rolAsignado,
                    resumen,
                    JSON.stringify(metaExtra)
                ]);

                if (res.affectedRows === 1) insertedCount++;
                else updatedCount++;

                processedIds.push(p.id);
            } catch (err) {
                console.error(`Error incorporating prospect ${p.id} to CRM:`, err.message);
            }
        }

        // Actualizar estado en b2b_prospects
        if (processedIds.length > 0) {
            await pool.query(`
                UPDATE b2b_prospects
                SET campaign_status = 'CONVERTIDO_CRM',
                    last_contacted_at = CURRENT_TIMESTAMP
                WHERE id IN (?)
            `, [processedIds]);
        }

        return {
            success: true,
            count: processedIds.length,
            inserted: insertedCount,
            updated: updatedCount,
            layerCounts,
            message: `¡Se incorporaron ${processedIds.length} contactos a la agenda CRM con sus Capas 1 a 5 y plantillas correspondientes!`
        };
    }

    /**
     * Resumen de distribución por Capas 1 a 5 con métricas de cobertura
     */
    async getLayersSummary(codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const [rows] = await pool.query(`
            SELECT 
                source_layer, 
                detected_role, 
                COUNT(*) as total,
                SUM(CASE WHEN phone_e164 IS NOT NULL AND phone_e164 != '' THEN 1 ELSE 0 END) as with_whatsapp,
                SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as with_email,
                SUM(CASE WHEN campaign_status = 'CONVERTIDO_CRM' THEN 1 ELSE 0 END) as in_crm
            FROM b2b_prospects
            WHERE codigo_empresa = ?
            GROUP BY source_layer, detected_role
        `, [codigoEmpresa]);
        return rows;
    }
}

const b2bService = new B2BProspectsService();
b2bService.normalizeNames = normalizeNames;
b2bService.normalizeEmail = normalizeEmail;
b2bService.normalizePhoneArg = normalizePhoneArg;
b2bService.classifyB2BRole = classifyB2BRole;

module.exports = b2bService;
