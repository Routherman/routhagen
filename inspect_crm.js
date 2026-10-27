const db = require('./database');

async function main() {
    await db.initDB();
    const [cols] = await db.pool.query('DESCRIBE contactos');
    console.log('COLUMNS:', cols.map(c => `${c.Field} (${c.Type})`));

    const [all] = await db.pool.query('SELECT id, nombre, telefono, email, grupo, rol_asignado FROM contactos');
    console.log('ALL CONTACTS:\n', all);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
