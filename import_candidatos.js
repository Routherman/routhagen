const fs = require('fs');
const path = require('path');
const db = require('./database');

// CSV Parser robusto con soporte de comillas
function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const result = [];
    const headers = parseCSVLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h.trim()] = (values[idx] || '').trim();
        });
        result.push(obj);
    }
    return result;
}

function parseCSVLine(line) {
    const values = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            values.push(cur.replace(/^"|"$/g, '').trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    values.push(cur.replace(/^"|"$/g, '').trim());
    return values;
}

// Normalización de teléfono a formato internacional de WhatsApp Argentina (549...)
function normalizePhoneAR(raw) {
    if (!raw || raw === '-') return null;
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;

    // Si ya empieza con 549
    if (digits.startsWith('549')) {
        return digits;
    }
    // Si empieza con 54011 -> 54911
    if (digits.startsWith('54011')) {
        return '54911' + digits.slice(5);
    }
    // Si empieza con 5415 -> 54911...
    if (digits.startsWith('5415')) {
        return '54911' + digits.slice(4);
    }
    // Si empieza con 54
    if (digits.startsWith('54')) {
        const rest = digits.slice(2);
        // Si el resto empieza con 9
        if (rest.startsWith('9')) return digits;
        // Si el resto empieza con 0
        if (rest.startsWith('0')) return '549' + rest.slice(1);
        return '549' + rest;
    }
    // Si empieza con 11 o código de área nacional
    if (digits.startsWith('11') || digits.length === 10) {
        return '549' + digits;
    }
    if (digits.startsWith('011')) {
        return '549' + digits.slice(1);
    }
    return '549' + digits;
}

// Formatear DNI con puntos: 38142302 -> 38.142.302
function formatDNI(raw) {
    if (!raw || raw === '-') return null;
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits || digits.length < 6) return raw;
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function run() {
    console.log('🚀 Iniciando importación de candidatos para Colaboratium (KRZMJI)...');
    await db.initDB();
    const codigoEmpresa = 'KRZMJI';

    // 1. Sembrar los 9 Rubros requeridos en la base de datos
    const requiredRubros = [
        'TEAM',
        'ASESORES',
        'LIDERES',
        'MAIN',
        'INVERSORES',
        'SOPORTE',
        'CREDITOS',
        'MASTER',
        'PROSPECTO ASESORES'
    ];

    console.log('📦 Verificando rubros del CRM...');
    for (const rubroName of requiredRubros) {
        const [existing] = await db.pool.query(
            'SELECT id FROM rubros WHERE codigo_empresa = ? AND UPPER(nombre) = UPPER(?) LIMIT 1',
            [codigoEmpresa, rubroName]
        );
        if (!existing || existing.length === 0) {
            await db.pool.query(
                'INSERT INTO rubros (codigo_empresa, nombre) VALUES (?, ?)',
                [codigoEmpresa, rubroName]
            );
            console.log(`  + Rubro creado: ${rubroName}`);
        }
    }

    // 2. Leer archivo CSV
    const csvPath = path.join(__dirname, '..', 'candidatos_eze.xlsx - Seleccionados.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('❌ Archivo CSV no encontrado en:', csvPath);
        process.exit(1);
    }

    const text = fs.readFileSync(csvPath, 'utf8');
    const records = parseCSV(text);
    console.log(`📄 Filas encontradas en el CSV: ${records.length}`);

    let countImported = 0;
    let countSkipped = 0;

    for (const r of records) {
        const nombre = r.Nombre;
        if (!nombre || nombre === 'Sin Nombre' || nombre === '-') {
            countSkipped++;
            continue;
        }

        const phoneNorm = normalizePhoneAR(r.Telefono);
        if (!phoneNorm) {
            countSkipped++;
            continue;
        }

        const email = r.Email && r.Email !== '-' ? r.Email.toLowerCase().trim() : null;
        const dni = formatDNI(r.DNI);
        const metadata = {
            edad: r.Edad || '',
            zona: r.Zona || '',
            puesto_computrabajo: r.Rol || '',
            url_cv: r.URL || '',
            origen: 'Computrabajo Ezequiel',
            etapa: 'Prospecto para Campañas de Captación Asesores'
        };

        const contactData = {
            nombre,
            telefono: phoneNorm,
            email,
            dni,
            grupo: 'PROSPECTO ASESORES',
            rol_asignado: 'Prospecto Asesores',
            estado_resolucion: 'PENDIENTE',
            nota_pendiente: 'Prospecto de candidato a asesor comercial cargado para campañas de incorporación.',
            metadata_extra: metadata
        };

        await db.crearContactoCRM(codigoEmpresa, contactData);
        countImported++;
        console.log(`  ✓ [${countImported}] ${nombre} (+${phoneNorm}) -> Rubro: PROSPECTO ASESORES`);
    }

    console.log('\n=============================================');
    console.log(`✅ Importación finalizada con éxito:`);
    console.log(`   - Contactos importados/actualizados: ${countImported}`);
    console.log(`   - Filas omitidas (sin nombre/teléfono): ${countSkipped}`);
    console.log('=============================================\n');

    process.exit(0);
}

run().catch(err => {
    console.error('❌ Error durante la importación:', err);
    process.exit(1);
});
