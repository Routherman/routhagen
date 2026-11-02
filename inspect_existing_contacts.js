const db = require('./database');

async function run() {
    await db.initDB();
    const [c] = await db.pool.query('SELECT id, telefono, nombre, email, grupo, rol_asignado, metadata_extra FROM contactos WHERE codigo_empresa = ? ORDER BY id DESC LIMIT 10', ['KRZMJI']);
    console.log('Últimos contactos en CRM:');
    c.forEach(x => console.log(x.id, x.telefono, x.nombre, x.email, x.grupo, x.rol_asignado));

    const [groups] = await db.pool.query('SELECT grupo, rol_asignado, COUNT(*) as cnt FROM contactos WHERE codigo_empresa = ? GROUP BY grupo, rol_asignado', ['KRZMJI']);
    console.log('\nDistribución de grupos y roles:');
    console.log(groups);
    process.exit(0);
}

run();
