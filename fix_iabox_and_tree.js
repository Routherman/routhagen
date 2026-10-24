const db = require('./database');

async function fix() {
    await db.initDB();
    console.log('--- Actualizando iaboxeeuu a INVERSORES y configurando dependencias de árbol ---');

    // 1. Actualizar iaboxeeuu
    await db.pool.query(`
        UPDATE contactos 
        SET grupo = 'INVERSORES', 
            rol_asignado = 'Inversores',
            estado_resolucion = 'PENDIENTE',
            nota_pendiente = 'Inversor registrado: explorando colocación desde $100.000 a $10.000.000. Pendiente validación de CVU y asignación de asesor.',
            asesor_id = 52,
            lider_id = 38
        WHERE telefono LIKE '%24013981%' OR nombre LIKE '%iabox%'
    `);

    // 2. Actualizar Juan Ramón Valle como Asesor dependiente de Líder Alejandro Bolognese
    await db.pool.query(`
        UPDATE contactos 
        SET grupo = 'ASESORES', 
            rol_asignado = 'Asesores',
            estado_resolucion = 'RESUELTO',
            lider_id = 38
        WHERE id = 52 OR email = 'damduff@gmail.com'
    `);

    // 3. Alejandro Bolognese como Líder
    await db.pool.query(`
        UPDATE contactos 
        SET grupo = 'LIDERES', 
            rol_asignado = 'Lideres',
            estado_resolucion = 'RESUELTO'
        WHERE id = 38 OR email = 'sirkimonolabs@gmail.com'
    `);

    const [rows] = await db.pool.query(`
        SELECT id, nombre, telefono, email, grupo, rol_asignado, estado_resolucion, nota_pendiente, lider_id, asesor_id 
        FROM contactos 
        ORDER BY id ASC
    `);
    console.log('CONTACTOS ACTUALIZADOS:\n', rows);
    process.exit(0);
}

fix().catch(e => { console.error(e); process.exit(1); });
