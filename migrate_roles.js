const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    const [empresas] = await pool.query('SELECT codigo FROM empresas');
    for (const emp of empresas) {
        const codigo = emp.codigo;
        
        // Crear roles base
        const masterPrivs = JSON.stringify({ can_manage_users: true, can_manage_roles: true, can_manage_social: true, can_edit_company: true });
        const mainPrivs = JSON.stringify({ can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false });
        
        // Check if roles exist
        const [existingMaster] = await pool.query('SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = ?', [codigo, 'master']);
        let masterRoleId;
        if (existingMaster.length === 0) {
            const [masterResult] = await pool.query(
                `INSERT INTO roles (codigo_empresa, nombre, is_system, privilegios) VALUES (?, ?, ?, ?)`,
                [codigo, 'master', true, masterPrivs]
            );
            masterRoleId = masterResult.insertId;
        } else {
            masterRoleId = existingMaster[0].id;
        }

        const [existingMain] = await pool.query('SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = ?', [codigo, 'main']);
        let mainRoleId;
        if (existingMain.length === 0) {
            const [mainResult] = await pool.query(
                `INSERT INTO roles (codigo_empresa, nombre, is_system, privilegios) VALUES (?, ?, ?, ?)`,
                [codigo, 'main', true, mainPrivs]
            );
            mainRoleId = mainResult.insertId;
        } else {
            mainRoleId = existingMain[0].id;
        }

        // Obtener usuarios de la empresa ordenados por id (el primero será master, el resto main)
        const [users] = await pool.query('SELECT id FROM users WHERE codigo_empresa = ? ORDER BY id ASC', [codigo]);
        if (users.length > 0) {
            // El primer usuario es master
            await pool.query('UPDATE users SET rol_id = ? WHERE id = ?', [masterRoleId, users[0].id]);
            
            // Los demas son main
            for (let i = 1; i < users.length; i++) {
                await pool.query('UPDATE users SET rol_id = ? WHERE id = ?', [mainRoleId, users[i].id]);
            }
        }
    }
    console.log('✅ Migración de roles completada con éxito.');
  } catch (error) {
    console.error('❌ Error en migración:', error);
  } finally {
    await pool.end();
  }
}

run();
