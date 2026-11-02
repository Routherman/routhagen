const xlsx = require('xlsx');
const path = require('path');
const db = require('./database');

const EXCEL_PATH = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx';
const CODIGO_EMPRESA = 'KRZMJI';
const isDryRun = process.argv.includes('--dry-run');

function parsePhone(raw, id) {
    if (!raw || !String(raw).trim()) {
        return { clean: `S/T-${id}`, isPlaceholder: true, raw: null };
    }
    const str = String(raw).trim();
    
    // Buscar si hay WhatsApp explícito
    let target = '';
    const waBeforeMatch = str.match(/WhatsApp\s*[:\+]?\s*([0-9\s\(\)\-\.]+)/i);
    const waAfterMatch = str.match(/([0-9\s\(\)\-\.]{7,})\s*\((?:WhatsApp|cel)\)/i);
    
    if (waBeforeMatch && waBeforeMatch[1]) {
        target = waBeforeMatch[1];
    } else if (waAfterMatch && waAfterMatch[1]) {
        target = waAfterMatch[1];
    } else {
        target = str.split(/[\/;]/)[0];
    }

    let digits = target.replace(/\D/g, '');
    if (!digits || digits.length < 6) {
        const allDigits = str.replace(/\D/g, '');
        if (allDigits.length >= 8) {
            digits = allDigits.substring(0, 13);
        } else {
            return { clean: `S/T-${id}`, isPlaceholder: true, raw: str };
        }
    }

    if (digits.startsWith('0054')) digits = digits.substring(2);
    if (digits.startsWith('0800') || digits.startsWith('0810')) {
        return { clean: digits, isPlaceholder: false, raw: str };
    }
    if (digits.startsWith('0')) digits = digits.substring(1);

    if (digits.startsWith('549')) {
        return { clean: digits, isPlaceholder: false, raw: str };
    }
    if (digits.startsWith('54')) {
        return { clean: '549' + digits.substring(2), isPlaceholder: false, raw: str };
    }
    if (digits.length === 10) {
        return { clean: '549' + digits, isPlaceholder: false, raw: str };
    }
    if (digits.length === 8) {
        return { clean: '54911' + digits, isPlaceholder: false, raw: str };
    }
    return { clean: '549' + digits, isPlaceholder: false, raw: str };
}

async function runImport() {
    console.log(`\n=============================================================`);
    console.log(`🚀 INICIANDO IMPORTACIÓN DE BASE DE PROSPECCIÓN ASESORES`);
    console.log(`Empresa: ${CODIGO_EMPRESA} | Archivo: ${EXCEL_PATH}`);
    console.log(`Modo: ${isDryRun ? '🔍 DRY RUN (Simulación sin guardar)' : '💾 PRODUCCIÓN (Guardando en DB)'}`);
    console.log(`=============================================================\n`);

    const wb = xlsx.readFile(EXCEL_PATH);
    const ws = wb.Sheets['Base'];
    if (!ws) {
        console.error('❌ Error: No se encontró la hoja "Base" en el archivo Excel.');
        process.exit(1);
    }

    const rawRows = xlsx.utils.sheet_to_json(ws);
    // Filtrar sólo filas con ID numérico válido (1..310)
    const rows = rawRows.filter(r => r.ID && typeof r.ID === 'number');
    console.log(`📋 Filas de contactos detectadas en hoja "Base": ${rows.length}`);

    await db.initDB();
    const pool = db.pool;

    // Obtener contactos existentes en KRZMJI para detectar preexistencias
    const [existingContacts] = await pool.query(
        "SELECT id, telefono, email, nombre, JSON_UNQUOTE(JSON_EXTRACT(metadata_extra, '$.id_origen')) as id_origen FROM contactos WHERE codigo_empresa = ?",
        [CODIGO_EMPRESA]
    );

    const existingByIdOrigen = new Map();
    const existingByPhone = new Map();
    const existingByEmail = new Map();

    existingContacts.forEach(c => {
        if (c.id_origen) existingByIdOrigen.set(String(c.id_origen), c);
        if (c.telefono) existingByPhone.set(c.telefono, c);
        if (c.email) existingByEmail.set(c.email.trim().toLowerCase(), c);
    });

    const usedPhonesInBatch = new Set();
    let countInserted = 0;
    let countUpdated = 0;
    let countWithPhone = 0;
    let countWithEmail = 0;
    let countBoth = 0;
    let countNeither = 0;
    let countCollisionsResolved = 0;

    for (const r of rows) {
        const idOrigen = r.ID;
        const nombre = (r['Organización'] || '').trim().substring(0, 150);
        const segmento = (r['Segmento'] || '').trim();
        const subSegmento = (r['Sub-segmento / zona'] || '').trim();
        const tipo = (r['Tipo'] || '').trim();
        const ciudadBarrio = (r['Ciudad / barrio'] || '').trim();
        const provincia = (r['Provincia'] || '').trim();
        const direccionRaw = (r['Dirección'] || '').trim();
        const emailRaw = (r['Email institucional'] || '').trim().toLowerCase();
        const calidadMail = (r['Calidad del mail'] || '').trim();
        const telefonoRaw = (r['Teléfono'] || '').trim();
        const sitioWeb = (r['Sitio web'] || '').trim();
        const urlFuente = (r['URL fuente'] || '').trim();
        const prioridad = (r['Prioridad'] || '').trim();
        const estadoOriginal = (r['Estado'] || '').trim();
        const contactoPublico = (r['Contacto público (cargo y nombre)'] || '').trim();
        const notaAbordaje = (r['Nota de abordaje'] || '').trim();

        // Construir dirección completa
        const direccionPartes = [direccionRaw, ciudadBarrio, provincia].filter(Boolean);
        const direccionCompleta = direccionPartes.length > 0 ? direccionPartes.join(', ') : null;

        // Validar email
        const email = (emailRaw && emailRaw.includes('@')) ? emailRaw : null;

        // Parsear teléfono
        const phoneParsed = parsePhone(telefonoRaw, idOrigen);
        let cleanPhone = phoneParsed.clean;

        // Resolver posible colisión de teléfono dentro del mismo batch o con otro contacto
        if (!phoneParsed.isPlaceholder) {
            if (usedPhonesInBatch.has(cleanPhone)) {
                cleanPhone = `${cleanPhone}_${idOrigen}`;
                countCollisionsResolved++;
            }
        }
        usedPhonesInBatch.add(cleanPhone);

        // Redes sociales
        let instagram = null;
        let linkedin = null;
        let facebook = null;
        if (sitioWeb.includes('instagram.com/')) instagram = sitioWeb;
        if (sitioWeb.includes('linkedin.com/')) linkedin = sitioWeb;
        if (sitioWeb.includes('facebook.com/')) facebook = sitioWeb;

        // Métricas de disponibilidad de datos
        const hasRealPhone = !phoneParsed.isPlaceholder;
        const hasRealEmail = Boolean(email);
        if (hasRealPhone && hasRealEmail) countBoth++;
        else if (hasRealPhone) countWithPhone++;
        else if (hasRealEmail) countWithEmail++;
        else countNeither++;

        // Metadata extra enriquecida
        const metadataExtra = {
            id_origen: idOrigen,
            segmento: segmento || null,
            sub_segmento_zona: subSegmento || null,
            tipo: tipo || null,
            sitio_web: sitioWeb || null,
            url_fuente: urlFuente || null,
            prioridad: prioridad || null,
            calidad_mail: calidadMail || null,
            estado_original: estadoOriginal || null,
            contacto_publico: contactoPublico || null,
            nota_abordaje: notaAbordaje || null,
            telefono_original: telefonoRaw || null,
            origen_base: "Colaboratium_Base_Prospeccion_Asesores.xlsx (Hoja Base)"
        };

        const resumenPartes = [];
        if (segmento) resumenPartes.push(segmento);
        if (tipo) resumenPartes.push(tipo);
        if (prioridad) resumenPartes.push(`Prioridad ${prioridad}`);
        const resumenNecesidad = resumenPartes.join(' · ') || 'Prospecto Asesores';

        const notaPendiente = notaAbordaje || (contactoPublico ? `Contacto: ${contactoPublico}` : null);

        // Verificar si ya existe en la DB
        let existing = existingByIdOrigen.get(String(idOrigen));
        if (!existing && email && existingByEmail.has(email)) {
            existing = existingByEmail.get(email);
        }
        if (!existing && !phoneParsed.isPlaceholder && existingByPhone.has(cleanPhone)) {
            existing = existingByPhone.get(cleanPhone);
        }

        if (existing) {
            countUpdated++;
            if (!isDryRun) {
                await pool.query(`
                    UPDATE contactos SET
                        nombre = ?,
                        email = COALESCE(?, email),
                        direccion = COALESCE(?, direccion),
                        grupo = 'PROSPECTO ASESORES',
                        rol_asignado = 'Prospecto Asesores',
                        estado_resolucion = 'PENDIENTE',
                        nota_pendiente = COALESCE(?, nota_pendiente),
                        resumen_necesidad = ?,
                        instagram = COALESCE(?, instagram),
                        linkedin = COALESCE(?, linkedin),
                        facebook = COALESCE(?, facebook),
                        metadata_extra = ?
                    WHERE id = ? AND codigo_empresa = ?
                `, [
                    nombre,
                    email,
                    direccionCompleta,
                    notaPendiente,
                    resumenNecesidad,
                    instagram,
                    linkedin,
                    facebook,
                    JSON.stringify(metadataExtra),
                    existing.id,
                    CODIGO_EMPRESA
                ]);
            }
        } else {
            countInserted++;
            if (!isDryRun) {
                await pool.query(`
                    INSERT INTO contactos (
                        telefono,
                        codigo_empresa,
                        nombre,
                        email,
                        direccion,
                        grupo,
                        rol_asignado,
                        estado_bot,
                        estado_resolucion,
                        nota_pendiente,
                        resumen_necesidad,
                        instagram,
                        linkedin,
                        facebook,
                        metadata_extra
                    ) VALUES (?, ?, ?, ?, ?, 'PROSPECTO ASESORES', 'Prospecto Asesores', 'ACTIVO', 'PENDIENTE', ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        nombre = VALUES(nombre),
                        email = VALUES(email),
                        direccion = VALUES(direccion),
                        grupo = 'PROSPECTO ASESORES',
                        rol_asignado = 'Prospecto Asesores',
                        estado_resolucion = 'PENDIENTE',
                        nota_pendiente = VALUES(nota_pendiente),
                        resumen_necesidad = VALUES(resumen_necesidad),
                        metadata_extra = VALUES(metadata_extra)
                `, [
                    cleanPhone,
                    CODIGO_EMPRESA,
                    nombre,
                    email,
                    direccionCompleta,
                    notaPendiente,
                    resumenNecesidad,
                    instagram,
                    linkedin,
                    facebook,
                    JSON.stringify(metadataExtra)
                ]);
            }
        }
    }

    console.log(`\n=============================================================`);
    console.log(`✅ RESULTADOS DE LA ${isDryRun ? 'SIMULACIÓN (DRY RUN)' : 'IMPORTACIÓN'}:`);
    console.log(`=============================================================`);
    console.log(`📊 Total de filas procesadas: ${rows.length}`);
    console.log(`➕ Nuevos contactos a insertar: ${countInserted}`);
    console.log(`🔄 Contactos existentes a actualizar: ${countUpdated}`);
    console.log(`\n📞 Desglose de canales disponibles:`);
    console.log(`   - Con Teléfono y Email: ${countBoth}`);
    console.log(`   - Con solo Teléfono:    ${countWithPhone}`);
    console.log(`   - Con solo Email:       ${countWithEmail}`);
    console.log(`   - Sin Teléfono ni Email (RE/MAX pendientes de relevar): ${countNeither}`);
    console.log(`   - Colisiones de teléfono resueltas limpiamente: ${countCollisionsResolved}`);
    console.log(`=============================================================\n`);

    process.exit(0);
}

runImport().catch(err => {
    console.error('❌ Error durante la importación:', err);
    process.exit(1);
});
