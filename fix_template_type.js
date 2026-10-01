const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  
  // Fix the template message that was incorrectly saved as 'text'
  const [r] = await pool.query(
    "UPDATE mensajes SET tipo = 'template' WHERE direccion = 'SALIENTE' AND contenido LIKE '%Welcome%'"
  );
  console.log('Filas actualizadas:', r.affectedRows);
  await pool.end();
}

run().catch(console.error);
