/**
 * PIPELINE SECUENCIAL DE PROSPECCIÓN B2B (CORRIDAS 1 AL 3)
 * 
 * Corrida 1: Franquicias adicionales (Century 21 Argentina)
 *   -> Segmento: FRANQUICIA_INMOBILIARIA
 *   -> Plantilla: PLANTILLA_FRANQUICIAS
 * 
 * Corrida 2: Padrones Oficiales Colegiados (CCi Santa Fe - Colegio de Corredores)
 *   -> Segmento: CORREDORES_MATRICULADOS
 *   -> Plantilla: PLANTILLA_CORREDORES_MATRICULADOS
 * 
 * Corrida 3: Productores Asesores de Seguros (PAS - SSN)
 *   -> Segmento: PRODUCTOR_SEGUROS_PAS
 *   -> Plantilla: PLANTILLA_PRODUCTORES_SEGUROS
 */

const axios = require('axios');
const path = require('path');
const xlsx = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./database');
const b2bService = require('./b2bProspectsService');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 1. CORRIDA 1: CENTURY 21 ARGENTINA
// ============================================================================
async function runCorrida1Century21(pool, codigoEmpresa = 'KRZMJI') {
    console.log('\n======================================================');
    console.log('🚀 INICIANDO CORRIDA 1: FRANQUICIAS ADICIONALES (CENTURY 21 ARGENTINA)');
    console.log('======================================================');

    const [jobRes] = await pool.query(`
        INSERT INTO scraper_jobs (codigo_empresa, job_name, layer, status, started_at)
        VALUES (?, 'Corrida 1 - Franquicias Century 21', 'CAPA_1_REMAX', 'RUNNING', NOW())
    `, [codigoEmpresa]);
    const jobId = jobRes.insertId;

    let totalFound = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    try {
        console.log('📡 Descargando directorio oficial de oficinas de Century 21...');
        const res = await axios.get('https://century21.com.ar/directorio-de-oficinas', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 25000
        });

        const html = res.data;
        const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
        let orgs = [];

        for (const s of scripts) {
            const content = s[1];
            if (content.includes('org_id') && content.includes('orgs')) {
                const pushMatch = content.match(/self\.__next_f\.push\(\[1,"([\s\S]+)"\]\)/);
                if (pushMatch) {
                    try {
                        const unescaped = JSON.parse(`"${pushMatch[1]}"`);
                        const orgsIdx = unescaped.indexOf('"orgs":[');
                        if (orgsIdx !== -1) {
                            const startArr = orgsIdx + 7;
                            let depth = 0;
                            let endArr = -1;
                            for (let i = startArr; i < unescaped.length; i++) {
                                if (unescaped[i] === '[') depth++;
                                else if (unescaped[i] === ']') {
                                    depth--;
                                    if (depth === 0) {
                                        endArr = i + 1;
                                        break;
                                    }
                                }
                            }
                            if (endArr !== -1) {
                                const orgsJson = unescaped.substring(startArr, endArr);
                                orgs = JSON.parse(orgsJson);
                                break;
                            }
                        }
                    } catch (e) {
                        // ignore parse errors and continue
                    }
                }
            }
        }

        totalFound = orgs.length;
        console.log(`✅ ${totalFound} oficinas oficiales de Century 21 detectadas.`);

        for (let i = 0; i < orgs.length; i++) {
            const o = orgs[i];
            const cleanOfficeName = (o.name || 'Century 21').trim();
            const fullName = `Broker Responsable C21 (${cleanOfficeName})`;
            const phone = o.cellphone || o.phone || null;
            const email = o.email_contact || null;
            const city = o.addr_district || o.addr_neighborhood || null;
            const province = o.addr_region || 'Buenos Aires';
            const officeUrl = o.slug ? `https://century21.com.ar/oficina/${o.slug}` : 'https://century21.com.ar/directorio-de-oficinas';

            const metadataExtra = {
                origen_segmento: 'FRANQUICIA_INMOBILIARIA',
                red_o_institucion: 'Century 21 Argentina',
                plantilla_sugerida: 'PLANTILLA_FRANQUICIAS',
                tipo_campana: 'FRANQUICIA_PROPIEDADES_ESTANCADAS',
                licencia_c21_id: o.licence_id || o.old_id_afiliado || null,
                matricula_profesional: o.registration_number || null,
                cuit: o.rfc || null,
                direccion: o.name_street_number || null,
                codigo_postal: o.addr_zip_code || null,
                sitio_web: o.website_url || null,
                horarios: o.opening_hours || null
            };

            const prospectData = {
                codigo_empresa: codigoEmpresa,
                full_name: fullName,
                email: email,
                phone: phone,
                phone_raw: phone,
                role: 'Broker / Responsable de Oficina',
                detected_role: 'LIDER_BROKER_POTENCIAL',
                assigned_bot_flow: 'FLOW_3_LIDERES',
                company_or_board: 'Century 21 Argentina',
                office_name: `Century 21 ${cleanOfficeName}`,
                city: city,
                province: province,
                source_layer: 'CAPA_1_REMAX',
                segmento_origen: 'FRANQUICIA_INMOBILIARIA',
                plantilla_sugerida: 'PLANTILLA_FRANQUICIAS',
                source_url: officeUrl,
                metadata_extra: metadataExtra
            };

            const result = await b2bService.upsertProspect(prospectData, codigoEmpresa);
            if (result.action === 'INSERTED') totalInserted++;
            else if (result.action === 'UPDATED') totalUpdated++;

            if ((i + 1) % 20 === 0 || i === orgs.length - 1) {
                console.log(`[C21 ${i + 1}/${orgs.length}] Procesado: ${cleanOfficeName} | Insertados: ${totalInserted} | Actualizados: ${totalUpdated}`);
            }
        }

        await pool.query(`
            UPDATE scraper_jobs 
            SET status = 'COMPLETED', total_found = ?, total_inserted = ?, finished_at = NOW()
            WHERE id = ?
        `, [totalFound, totalInserted, jobId]);

        console.log(`🎉 Corrida 1 Finalizada: ${totalFound} oficinas C21 procesadas (${totalInserted} nuevas, ${totalUpdated} actualizadas).\n`);
    } catch (err) {
        console.error('❌ Error en Corrida 1 (Century 21):', err.message);
        await pool.query(`
            UPDATE scraper_jobs 
            SET status = 'FAILED', error_message = ?, finished_at = NOW()
            WHERE id = ?
        `, [err.message, jobId]);
    }
}

// ============================================================================
// 2. CORRIDA 2: PADRONES OFICIALES COLEGIADOS (CCI SANTA FE)
// ============================================================================
async function runCorrida2PadronesColegiados(pool, codigoEmpresa = 'KRZMJI') {
    console.log('\n======================================================');
    console.log('🚀 INICIANDO CORRIDA 2: PADRONES OFICIALES COLEGIADOS (CCI SANTA FE)');
    console.log('======================================================');

    const [jobRes] = await pool.query(`
        INSERT INTO scraper_jobs (codigo_empresa, job_name, layer, status, started_at)
        VALUES (?, 'Corrida 2 - Padrones Colegiados (CCi Santa Fe)', 'CAPA_2_PADRONES_CORREDORES', 'RUNNING', NOW())
    `, [codigoEmpresa]);
    const jobId = jobRes.insertId;

    let totalFound = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    const totalPages = 67; // 67 páginas oficiales de padrón CCi Santa Fe
    console.log(`📡 Iniciando extracción de ${totalPages} páginas del padrón de Corredores Inmobiliarios...`);

    for (let page = 1; page <= totalPages; page++) {
        const pageUrl = page === 1 ? 'https://ccisantafe.org.ar/padron/' : `https://ccisantafe.org.ar/padron/?paged=${page}`;
        try {
            const res = await axios.get(pageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 20000
            });

            const html = res.data;
            const cardsRegex = /<div class="ps-card">([\s\S]*?)<\/div>\s*(?:<div class="ps-card">|<\/div>\s*<div class="ps-pagination">)/gi;
            // Split cards manually by `<div class="ps-card">`
            const rawParts = html.split('<div class="ps-card">');
            rawParts.shift(); // remove header part before first card

            for (const part of rawParts) {
                const cardHtml = part.split('</div>\n            </div>')[0] || part;
                
                // Name inside <strong>
                const strongMatch = cardHtml.match(/<strong>([^<]+)<\/strong>/i);
                if (!strongMatch) continue;
                const rawName = strongMatch[1].trim();

                // Matrícula
                const matMatch = cardHtml.match(/Matr[íi]cula:\s*([0-9A-Za-z-]+)/i);
                const matricula = matMatch ? matMatch[1].trim() : null;

                // Fantasía inside <em>
                const emMatch = cardHtml.match(/<em>([^<]+)<\/em>/i);
                const fantasia = emMatch ? emMatch[1].trim() : null;

                // Direccion 📍
                const dirMatch = cardHtml.match(/📍\s*([^<]+)/i);
                const direccion = dirMatch ? dirMatch[1].trim() : null;

                // Tel 📞
                const telMatch = cardHtml.match(/📞\s*([^<]+)/i);
                const rawPhone = telMatch ? telMatch[1].trim() : null;

                // Email 📧
                const emailMatch = cardHtml.match(/📧\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                const email = emailMatch ? emailMatch[1].trim().toLowerCase() : null;

                // Localidad 🌐
                const locMatch = cardHtml.match(/🌐\s*([^<]+)/i);
                const localidad = locMatch ? locMatch[1].trim() : 'Santa Fe';

                // Estado
                const estado = cardHtml.includes('HABILITADO') ? 'HABILITADO' : 'SUSPENDIDO';

                totalFound++;

                // Split name (formato: "APELLIDO, Nombres")
                let firstName = '';
                let lastName = '';
                if (rawName.includes(',')) {
                    const nameParts = rawName.split(',');
                    lastName = nameParts[0].trim();
                    firstName = nameParts.slice(1).join(' ').trim();
                } else {
                    const parts = rawName.split(' ');
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' ');
                }

                const metadataExtra = {
                    origen_segmento: 'CORREDORES_MATRICULADOS',
                    colegio: 'Colegio de Corredores Inmobiliarios de Santa Fe (CCi)',
                    plantilla_sugerida: 'PLANTILLA_CORREDORES_MATRICULADOS',
                    tipo_campana: 'FINANCIAMIENTO_OPERACIONES_INMOBILIARIAS',
                    matricula: matricula,
                    estado_matricula: estado,
                    nombre_fantasia: fantasia,
                    direccion: direccion,
                    localidad: localidad
                };

                const prospectData = {
                    codigo_empresa: codigoEmpresa,
                    first_name: firstName,
                    last_name: lastName,
                    full_name: `${firstName} ${lastName}`,
                    email: email,
                    phone: rawPhone,
                    phone_raw: rawPhone,
                    role: 'Corredor Inmobiliario Matriculado',
                    detected_role: 'LIDER_BROKER_POTENCIAL',
                    assigned_bot_flow: 'FLOW_3_LIDERES',
                    company_or_board: 'Colegio de Corredores Inmobiliarios de Santa Fe (CCi)',
                    office_name: fantasia || `Inmobiliaria ${lastName}`,
                    city: localidad,
                    province: 'Santa Fe',
                    source_layer: 'CAPA_2_PADRONES_CORREDORES',
                    segmento_origen: 'CORREDORES_MATRICULADOS',
                    plantilla_sugerida: 'PLANTILLA_CORREDORES_MATRICULADOS',
                    source_url: pageUrl,
                    metadata_extra: metadataExtra
                };

                const result = await b2bService.upsertProspect(prospectData, codigoEmpresa);
                if (result.action === 'INSERTED') totalInserted++;
                else if (result.action === 'UPDATED') totalUpdated++;
            }

            console.log(`[CCi Página ${page}/${totalPages}] Acumulado: ${totalFound} corredores (${totalInserted} nuevos, ${totalUpdated} actualizados)`);
            
            // Polite delay between pages (800ms)
            await sleep(800);
        } catch (pageErr) {
            console.error(`⚠️ Error en página ${page} de CCi:`, pageErr.message);
        }
    }

    await pool.query(`
        UPDATE scraper_jobs 
        SET status = 'COMPLETED', total_found = ?, total_inserted = ?, finished_at = NOW()
        WHERE id = ?
    `, [totalFound, totalInserted, jobId]);

    console.log(`🎉 Corrida 2 Finalizada: ${totalFound} corredores matriculados procesados (${totalInserted} nuevos, ${totalUpdated} actualizados).\n`);
}

// ============================================================================
// 3. CORRIDA 3: PRODUCTORES ASESORES DE SEGUROS (PAS - SSN)
// ============================================================================
async function runCorrida3ProductoresSeguros(pool, codigoEmpresa = 'KRZMJI') {
    console.log('\n======================================================');
    console.log('🚀 INICIANDO CORRIDA 3: PRODUCTORES ASESORES DE SEGUROS (PAS - SSN)');
    console.log('======================================================');

    const [jobRes] = await pool.query(`
        INSERT INTO scraper_jobs (codigo_empresa, job_name, layer, status, started_at)
        VALUES (?, 'Corrida 3 - Productores de Seguros (SSN)', 'CAPA_5_PAS', 'RUNNING', NOW())
    `, [codigoEmpresa]);
    const jobId = jobRes.insertId;

    let totalFound = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    try {
        console.log('📡 Descargando padrón oficial de Productores Asesores de Seguros de datosabiertos.ssn.gob.ar...');
        const ssnUrl = 'https://datosabiertos.ssn.gob.ar/dataset/be4927ba-6b6d-4cee-b33e-5319b33b15b8/resource/07de24f8-4191-497e-a0da-da83cf5eb5d9/download/productores-asesores.csv';
        const res = await axios.get(ssnUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 45000,
            responseType: 'text'
        });

        const lines = res.data.split('\n');
        console.log(`✅ Archivo CSV de la SSN recibido: ${lines.length} registros totales.`);

        // Tomamos una muestra estructurada de PAS activos de todo el país
        // (los primeros 1.000 a 1.500 para esta corrida controlada, o todo el lote)
        const maxRecordsToProcess = Math.min(lines.length - 1, 2000);
        console.log(`Procesando lote de ${maxRecordsToProcess} PAS matriculados...`);

        for (let i = 1; i <= maxRecordsToProcess; i++) {
            const line = lines[i]?.trim();
            if (!line) continue;

            const cols = line.split(',');
            // Header: productor_matricula,productor_tipo_id,productor_id,productor_apellido_nombre,ramo,provincia_id,provincia_nombre
            const matricula = cols[0]?.trim();
            const cuit = cols[2]?.trim();
            const rawNombre = cols[3]?.trim();
            const ramo = cols[4]?.trim() || 'Patrimoniales y Vida';
            const provincia = cols[6]?.trim() || 'Buenos Aires';

            if (!rawNombre || rawNombre.length < 3) continue;

            totalFound++;

            // Normalizar Nombre y Apellido
            const parts = rawNombre.split(' ').filter(Boolean);
            let lastName = parts[0] || '';
            let firstName = parts.slice(1).join(' ') || '';

            const metadataExtra = {
                origen_segmento: 'PRODUCTOR_SEGUROS_PAS',
                organismo: 'Superintendencia de Seguros de la Nación (SSN)',
                plantilla_sugerida: 'PLANTILLA_PRODUCTORES_SEGUROS',
                tipo_campana: 'COLOCACION_PRESTAMOS_GARANTIA_Y_JUBILADOS',
                matricula_pas: matricula,
                cuit: cuit,
                ramo_habilitado: ramo,
                provincia_oficial: provincia
            };

            const prospectData = {
                codigo_empresa: codigoEmpresa,
                first_name: firstName,
                last_name: lastName,
                full_name: `${firstName} ${lastName}`,
                email: null, // Los datos abiertos de SSN proveen CUIT y matrícula; se enriquecen con canales institucionales
                phone: null,
                phone_raw: null,
                role: `Productor Asesor de Seguros (PAS) - ${ramo}`,
                detected_role: 'ASESOR_POTENCIAL',
                assigned_bot_flow: 'FLOW_2_ASESORES',
                company_or_board: 'Superintendencia de Seguros de la Nación (SSN)',
                office_name: `Productor Asesor de Seguros (Mat. ${matricula})`,
                city: provincia.includes('Ciudad') ? 'CABA' : null,
                province: provincia,
                source_layer: 'CAPA_5_PAS',
                segmento_origen: 'PRODUCTOR_SEGUROS_PAS',
                plantilla_sugerida: 'PLANTILLA_PRODUCTORES_SEGUROS',
                source_url: 'https://datosabiertos.ssn.gob.ar/dataset/productores-asesores-de-seguros',
                metadata_extra: metadataExtra
            };

            const result = await b2bService.upsertProspect(prospectData, codigoEmpresa);
            if (result.action === 'INSERTED') totalInserted++;
            else if (result.action === 'UPDATED') totalUpdated++;

            if (totalFound % 200 === 0) {
                console.log(`[PAS SSN ${totalFound}/${maxRecordsToProcess}] Insertados: ${totalInserted} | Actualizados: ${totalUpdated}`);
            }
        }

        await pool.query(`
            UPDATE scraper_jobs 
            SET status = 'COMPLETED', total_found = ?, total_inserted = ?, finished_at = NOW()
            WHERE id = ?
        `, [totalFound, totalInserted, jobId]);

        console.log(`🎉 Corrida 3 Finalizada: ${totalFound} PAS procesados (${totalInserted} nuevos, ${totalUpdated} actualizados).\n`);
    } catch (err) {
        console.error('❌ Error en Corrida 3 (PAS SSN):', err.message);
        await pool.query(`
            UPDATE scraper_jobs 
            SET status = 'FAILED', error_message = ?, finished_at = NOW()
            WHERE id = ?
        `, [err.message, jobId]);
    }
}

// ============================================================================
// ORQUESTADOR MAESTRO (EJECUTA ESTRICTAMENTE 1 -> 2 -> 3)
// ============================================================================
async function runAllInOrder() {
    console.log('🏁 INICIANDO PIPELINE MAESTRO DE 3 CORRIDAS SECUENCIALES...');
    const startTime = Date.now();
    
    await db.initDB();
    const pool = db.pool;

    // 1. CORRIDA 1: CENTURY 21
    await runCorrida1Century21(pool);

    // 2. CORRIDA 2: PADRONES COLEGIADOS (CCI SANTA FE)
    await runCorrida2PadronesColegiados(pool);

    // 3. CORRIDA 3: PRODUCTORES ASESORES DE SEGUROS (PAS SSN)
    await runCorrida3ProductoresSeguros(pool);

    // REPORTE CONSOLIDADO
    console.log('======================================================');
    console.log('📊 REPORTE CONSOLIDADO DE BASE B2B DE ASESORES');
    console.log('======================================================');

    const [breakdown] = await pool.query(`
        SELECT 
            segmento_origen,
            plantilla_sugerida,
            COUNT(*) as total_contactos,
            SUM(CASE WHEN phone_e164 IS NOT NULL AND phone_e164 != '' THEN 1 ELSE 0 END) as con_whatsapp_e164,
            SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as con_email
        FROM b2b_prospects
        GROUP BY segmento_origen, plantilla_sugerida
        ORDER BY total_contactos DESC
    `);
    console.table(breakdown);

    const [totalRows] = await pool.query('SELECT COUNT(*) as grand_total FROM b2b_prospects');
    const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✨ GRAN TOTAL EN BASE B2B: ${totalRows[0].grand_total} asesores y brokers relevados.`);
    console.log(`⏱️ Tiempo total de ejecución: ${elapsedMinutes} minutos.`);
    
    process.exit(0);
}

runAllInOrder().catch(err => {
    console.error('💥 Error crítico en pipeline maestro:', err);
    process.exit(1);
});
