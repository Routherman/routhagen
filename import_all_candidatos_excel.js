const fs = require('fs');
const path = require('path');
const db = require('./database');

async function importAllExcelCandidatos() {
    await db.initDB();
    console.log('🚀 Importando 706 candidatos a MySQL como PROSPECTO ASESORES / PENDIENTE...');

    const jsonPath = path.join(__dirname, 'candidatos_extracted.json');
    const records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    let insertados = 0;
    let actualizados = 0;
    let errores = 0;
    const codigoEmpresa = 'KRZMJI';

    for (const item of records) {
        if (!item.telefono) continue;

        const metadata = {
            edad: item.edad,
            zona: item.zona,
            rol_postulado: item.rol,
            url_cv: item.url_cv,
            hoja_origen: item.hoja_origen,
            fuente: 'candidatos_eze.xlsx'
        };

        const query = `
            INSERT INTO contactos (
                telefono, codigo_empresa, nombre, email, dni, grupo, rol_asignado,
                estado_resolucion, nota_pendiente, metadata_extra
            ) VALUES (?, ?, ?, ?, ?, 'PROSPECTO ASESORES', 'Prospecto Asesores', 'PENDIENTE', ?, ?)
            ON DUPLICATE KEY UPDATE
                nombre = IF(VALUES(nombre) != '' AND VALUES(nombre) NOT LIKE 'Prospecto (%)', VALUES(nombre), nombre),
                email = IF(VALUES(email) != '', VALUES(email), email),
                dni = IF(VALUES(dni) != '', VALUES(dni), dni),
                grupo = 'PROSPECTO ASESORES',
                rol_asignado = 'Prospecto Asesores',
                estado_resolucion = 'PENDIENTE',
                nota_pendiente = IF(nota_pendiente IS NULL OR nota_pendiente = '', VALUES(nota_pendiente), nota_pendiente),
                metadata_extra = VALUES(metadata_extra);
        `;

        const nota = `Candidato para campaña de captación (Hoja: ${item.hoja_origen})`;

        try {
            const [res] = await db.pool.query(query, [
                item.telefono,
                codigoEmpresa,
                item.nombre || `Prospecto (${item.telefono})`,
                item.email || null,
                item.dni || null,
                nota,
                JSON.stringify(metadata)
            ]);

            if (res.affectedRows === 1) insertados++;
            else if (res.affectedRows === 2) actualizados++;
        } catch (err) {
            errores++;
            console.error(`Error guardando ${item.telefono}:`, err.message);
        }
    }

    console.log(`✅ Importación finalizada:`);
    console.log(`   - Nuevos insertados: ${insertados}`);
    console.log(`   - Existentes actualizados: ${actualizados}`);
    console.log(`   - Errores: ${errores}`);

    const [totals] = await db.pool.query(`
        SELECT 
            grupo, 
            estado_resolucion, 
            COUNT(*) as cantidad, 
            COUNT(IF(email IS NOT NULL AND email != '', 1, NULL)) as con_email
        FROM contactos 
        WHERE codigo_empresa = ?
        GROUP BY grupo, estado_resolucion;
    `, [codigoEmpresa]);

    console.log('\n📈 Resumen en Base de Datos:');
    console.table(totals);
    process.exit(0);
}

importAllExcelCandidatos().catch(err => {
    console.error('Error fatal importando candidatos:', err);
    process.exit(1);
});
