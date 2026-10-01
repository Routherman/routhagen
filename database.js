const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
};

const DB_NAME = process.env.DB_NAME || 'whatsapp_bot_db';

let pool;

async function initDB() {
    try {
        // 1. Conectarnos a MySQL (sin seleccionar base de datos) para crearla si no existe
        const connection = await mysql.createConnection(dbConfig);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
        await connection.end();

        // 2. Crear el pool de conexiones conectado específicamente a nuestra base de datos
        pool = mysql.createPool({
            ...dbConfig,
            database: DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // 3. Crear las tablas necesarias si no existen

        // Tabla de Contactos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contactos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                telefono VARCHAR(50) NOT NULL,
                codigo_empresa VARCHAR(50) NOT NULL,
                nombre VARCHAR(150),
                estado_bot ENUM('ACTIVO', 'HANDOFF') DEFAULT 'ACTIVO',
                rol_asignado VARCHAR(100) DEFAULT 'General',
                usuario_asignado_id VARCHAR(255) DEFAULT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY (telefono, codigo_empresa)
            );
        `);

        // Tabla de Mensajes (Chat)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensajes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                contacto_id INT NOT NULL,
                mensaje_meta_id VARCHAR(150) UNIQUE,
                direccion ENUM('ENTRANTE', 'SALIENTE') NOT NULL,
                tipo VARCHAR(50),
                contenido TEXT,
                estado_entrega VARCHAR(50) DEFAULT 'recibido',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contacto_id) REFERENCES contactos(id) ON DELETE CASCADE
            );
        `);
        // Tabla de Empresas (Enterprise)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS empresas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo VARCHAR(50) UNIQUE NOT NULL,
                nombre VARCHAR(150),
                telefono VARCHAR(50),
                email VARCHAR(150),
                direccion TEXT,
                cuentas_vinculadas JSON,
                prompt_ia TEXT,
                conocimiento_ia TEXT,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabla de Usuarios (Clerk)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                clerk_id VARCHAR(150) UNIQUE NOT NULL,
                email VARCHAR(150),
                first_name VARCHAR(150),
                last_name VARCHAR(150),
                image_url TEXT,
                codigo_empresa VARCHAR(50),
                token VARCHAR(255),
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabla de Roles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                is_system BOOLEAN DEFAULT FALSE,
                privilegios JSON,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabla de Campañas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campanas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                nombre VARCHAR(150),
                total_contactos INT DEFAULT 0,
                estado VARCHAR(50) DEFAULT 'en_progreso',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabla de Flujos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS flujos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                nombre VARCHAR(150),
                trigger_keyword VARCHAR(100),
                data_json JSON,
                activo BOOLEAN DEFAULT TRUE,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Update existing tables
        try {
            await pool.query('ALTER TABLE empresas ADD COLUMN prompt_ia TEXT');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE empresas ADD COLUMN conocimiento_ia TEXT');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE users ADD COLUMN rol_id INT');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE mensajes ADD COLUMN campana_id INT DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query("ALTER TABLE contactos CHANGE categoria rol_asignado VARCHAR(100) DEFAULT 'General'");
        } catch(e) {
            try {
                await pool.query("ALTER TABLE contactos ADD COLUMN rol_asignado VARCHAR(100) DEFAULT 'General'");
            } catch(ex) {}
        }
        try {
            await pool.query("ALTER TABLE contactos ADD COLUMN usuario_asignado_id VARCHAR(255) DEFAULT NULL");
        } catch(e) {}
        try {
            await pool.query("ALTER TABLE contactos ADD COLUMN flujo_activo_id INT DEFAULT NULL");
        } catch(e) {}
        try {
            await pool.query("ALTER TABLE contactos ADD COLUMN nodo_actual_id VARCHAR(100) DEFAULT NULL");
        } catch(e) {}

        console.log('✅ Base de datos MySQL y tablas inicializadas correctamente.');
    } catch (error) {
        console.error('❌ Error inicializando la base de datos:', error);
    }
}

/**
 * Guarda un contacto o actualiza su nombre si ya existe.
 * Retorna el objeto del contacto (id y estado_bot).
 */
async function upsertContacto(telefono, nombre, codigo_empresa) {
    if (!pool) return null;
    
    await pool.query(`
        INSERT INTO contactos (telefono, nombre, codigo_empresa) 
        VALUES (?, ?, ?) 
        ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)
    `, [telefono, nombre, codigo_empresa]);
    
    const [rows] = await pool.query('SELECT id, estado_bot FROM contactos WHERE telefono = ? AND codigo_empresa = ?', [telefono, codigo_empresa]);
    return rows[0];
}

/**
 * Cambia el estado del bot para un contacto (ej. a HANDOFF)
 */
async function actualizarEstadoBot(contactoId, estado) {
    if (!pool) return;
    await pool.query('UPDATE contactos SET estado_bot = ? WHERE id = ?', [estado, contactoId]);
}

/**
 * Actualiza la asignación del contacto (rol y usuario)
 */
async function actualizarAsignacionContacto(contactoId, rolAsignado, usuarioAsignadoId = null) {
    if (!pool) return;
    await pool.query('UPDATE contactos SET rol_asignado = ?, usuario_asignado_id = ? WHERE id = ?', [rolAsignado, usuarioAsignadoId, contactoId]);
}

/**
 * Guarda un mensaje (entrante o saliente) en el historial del chat
 */
async function guardarMensaje(contactoId, metaId, direccion, tipo, contenido, campanaId = null) {
    if (!pool) return;
    
    await pool.query(`
        INSERT INTO mensajes (contacto_id, mensaje_meta_id, direccion, tipo, contenido, campana_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [contactoId, metaId, direccion, tipo, contenido, campanaId]);
}

/**
 * Crea una nueva campaña masiva
 */
async function crearCampana(codigoEmpresa, nombre, totalContactos) {
    if (!pool) return null;
    const [result] = await pool.query(`
        INSERT INTO campanas (codigo_empresa, nombre, total_contactos, estado)
        VALUES (?, ?, ?, 'en_progreso')
    `, [codigoEmpresa, nombre, totalContactos]);
    return result.insertId;
}

/**
 * Obtiene todas las campañas de una empresa con sus estadísticas
 */
async function obtenerCampanas(codigoEmpresa) {
    if (!pool) return [];
    
    // Obtenemos campañas y usamos subconsultas o LEFT JOIN con mensajes para calcular métricas
    const [rows] = await pool.query(`
        SELECT 
            c.*,
            (SELECT COUNT(*) FROM mensajes m WHERE m.campana_id = c.id) as enviados,
            (SELECT COUNT(*) FROM mensajes m WHERE m.campana_id = c.id AND m.estado_entrega IN ('delivered', 'read')) as entregados,
            (
                SELECT COUNT(DISTINCT m1.contacto_id) 
                FROM mensajes m1 
                WHERE m1.campana_id = c.id 
                AND EXISTS (
                    SELECT 1 FROM mensajes m2 
                    WHERE m2.contacto_id = m1.contacto_id 
                    AND m2.direccion = 'ENTRANTE' 
                    AND m2.creado_en > m1.creado_en
                )
            ) as respondidos
        FROM campanas c
        WHERE c.codigo_empresa = ?
        ORDER BY c.creado_en DESC
    `, [codigoEmpresa]);
    return rows;
}


/**
 * Actualiza el estado de entrega de un mensaje enviado por nosotros (sent, delivered, read)
 */
async function actualizarEstadoMensaje(metaId, estado) {
    if (!pool) return;
    
    await pool.query(`
        UPDATE mensajes SET estado_entrega = ? WHERE mensaje_meta_id = ?
    `, [estado, metaId]);
}

/**
 * Obtiene el historial de los últimos mensajes de un contacto para dar contexto a la IA.
 */
async function obtenerHistorialMensajes(contactoId, limite = 10) {
    if (!pool) return [];
    
    // Obtenemos los últimos N mensajes ordenados por ID descendente
    const [rows] = await pool.query(`
        SELECT direccion, contenido 
        FROM mensajes 
        WHERE contacto_id = ? 
          AND tipo = 'text' 
          AND contenido IS NOT NULL 
        ORDER BY id DESC 
        LIMIT ?
    `, [contactoId, limite]);
    
    // Invertimos el arreglo para que queden en orden cronológico (el más viejo primero)
    return rows.reverse();
}

/**
 * Obtiene todos los contactos para una empresa
 */
async function obtenerContactos(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM contactos WHERE codigo_empresa = ? ORDER BY creado_en DESC', [codigo_empresa]);
    return rows;
}

/**
 * Obtiene TODOS los mensajes de un contacto para el panel
 */
async function obtenerTodosLosMensajes(contactoId) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM mensajes WHERE contacto_id = ? ORDER BY id ASC', [contactoId]);
    return rows;
}

/**
 * Guarda o actualiza un usuario proveniente de Clerk
 */
async function upsertUser(clerkId, email, firstName, lastName, imageUrl, token) {
    if (!pool) return null;
    
    await pool.query(`
        INSERT INTO users (clerk_id, email, first_name, last_name, image_url, token) 
        VALUES (?, ?, ?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
            email = VALUES(email),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            image_url = VALUES(image_url),
            token = COALESCE(VALUES(token), token)
    `, [clerkId, email, firstName, lastName, imageUrl, token]);
    
    const [rows] = await pool.query('SELECT * FROM users WHERE clerk_id = ?', [clerkId]);
    return rows[0];
}

/**
 * Obtiene el usuario de la DB
 */
async function obtenerUsuario(clerkId) {
    if (!pool) return null;
    const [rows] = await pool.query(`
        SELECT u.*, r.nombre as rol_nombre, r.privilegios as rol_privilegios 
        FROM users u 
        LEFT JOIN roles r ON u.rol_id = r.id 
        WHERE u.clerk_id = ?
    `, [clerkId]);
    return rows[0] || null;
}

/**
 * Obtiene todos los usuarios de una empresa
 */
async function obtenerUsuariosPorEmpresa(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query(`
        SELECT u.*, r.nombre as rol_nombre, r.privilegios as rol_privilegios 
        FROM users u 
        LEFT JOIN roles r ON u.rol_id = r.id 
        WHERE u.codigo_empresa = ? 
        ORDER BY u.creado_en DESC
    `, [codigo_empresa]);
    return rows;
}

/**
 * Crea una nueva empresa y vincula al usuario
 */
async function crearEmpresa(clerkId, nombre, telefono, email, direccion, cuentasVinculadas) {
    if (!pool) return null;
    // Generar un código aleatorio de 6 caracteres alfanuméricos
    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
    const cuentasStr = cuentasVinculadas ? JSON.stringify(cuentasVinculadas) : null;
    
    await pool.query(`
        INSERT INTO empresas (codigo, nombre, telefono, email, direccion, cuentas_vinculadas) 
        VALUES (?, ?, ?, ?, ?, ?)
    `, [codigo, nombre, telefono, email, direccion, cuentasStr]);
    
    // Crear roles base
    const masterPrivs = JSON.stringify({ can_manage_users: true, can_manage_roles: true, can_manage_social: true, can_edit_company: true });
    const mainPrivs = JSON.stringify({ can_manage_users: false, can_manage_roles: false, can_manage_social: false, can_edit_company: false });
    
    const [masterResult] = await pool.query(
        `INSERT INTO roles (codigo_empresa, nombre, is_system, privilegios) VALUES (?, ?, ?, ?)`,
        [codigo, 'master', true, masterPrivs]
    );
    
    await pool.query(
        `INSERT INTO roles (codigo_empresa, nombre, is_system, privilegios) VALUES (?, ?, ?, ?)`,
        [codigo, 'main', true, mainPrivs]
    );
    
    const masterRoleId = masterResult.insertId;
    
    // Actualizar al usuario con el código de la nueva empresa y el rol master
    await pool.query('UPDATE users SET codigo_empresa = ?, rol_id = ? WHERE clerk_id = ?', [codigo, masterRoleId, clerkId]);
    
    return codigo;
}

/**
 * Une a un usuario a una empresa existente por código
 */
async function unirseEmpresa(clerkId, codigo) {
    if (!pool) return false;
    
    const [empresas] = await pool.query('SELECT * FROM empresas WHERE codigo = ?', [codigo]);
    if (empresas.length === 0) return false; // La empresa no existe
    
    // Obtener el rol 'main'
    const [roles] = await pool.query('SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = ?', [codigo, 'main']);
    let mainRoleId = null;
    if (roles.length > 0) {
        mainRoleId = roles[0].id;
    }
    
    await pool.query('UPDATE users SET codigo_empresa = ?, rol_id = ? WHERE clerk_id = ?', [codigo, mainRoleId, clerkId]);
    return true;
}

/**
 * Obtiene la empresa por código
 */
async function obtenerEmpresa(codigo) {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM empresas WHERE codigo = ?', [codigo]);
    return rows[0] || null;
}

/**
 * Obtiene la empresa buscando por webhook token de whatsapp
 */
async function obtenerEmpresaPorWebhookToken(token) {
    if (!pool) return null;
    const [rows] = await pool.query(`
        SELECT * FROM empresas 
        WHERE JSON_UNQUOTE(JSON_EXTRACT(cuentas_vinculadas, '$.whatsapp.webhook_token')) = ?
    `, [token]);
    return rows[0] || null;
}

/**
 * Obtiene la empresa buscando por phone id de whatsapp
 */
async function obtenerEmpresaPorPhoneId(phoneId) {
    if (!pool) return null;
    const [rows] = await pool.query(`
        SELECT * FROM empresas 
        WHERE JSON_UNQUOTE(JSON_EXTRACT(cuentas_vinculadas, '$.whatsapp.phone_id')) = ?
    `, [phoneId]);
    return rows[0] || null;
}

/**
 * Actualiza la información de una empresa
 */
async function actualizarEmpresa(codigo, nombre, telefono, email, direccion) {
    if (!pool) return false;
    await pool.query(`
        UPDATE empresas 
        SET nombre = ?, telefono = ?, email = ?, direccion = ?
        WHERE codigo = ?
    `, [nombre, telefono, email, direccion, codigo]);
    return true;
}

/**
 * Actualiza las cuentas vinculadas (JSON) de una empresa
 */
async function actualizarCuentasVinculadas(codigo, cuentasVinculadas) {
    if (!pool) return false;
    await pool.query(`
        UPDATE empresas 
        SET cuentas_vinculadas = ?
        WHERE codigo = ?
    `, [JSON.stringify(cuentasVinculadas), codigo]);
    return true;
}

/**
 * Actualiza la información de IA (prompt y conocimiento) de una empresa
 */
async function actualizarIA(codigo, prompt, conocimiento) {
    if (!pool) return false;
    await pool.query(`
        UPDATE empresas 
        SET prompt_ia = ?, conocimiento_ia = ?
        WHERE codigo = ?
    `, [prompt, conocimiento, codigo]);
    return true;
}

/**
 * Obtiene los roles de una empresa
 */
async function obtenerRoles(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM roles WHERE codigo_empresa = ? ORDER BY creado_en ASC', [codigo_empresa]);
    return rows;
}

/**
 * Crea un rol para una empresa
 */
async function crearRol(codigo_empresa, nombre, privilegios) {
    if (!pool) return null;
    const privsStr = typeof privilegios === 'object' ? JSON.stringify(privilegios) : privilegios;
    const [result] = await pool.query(
        'INSERT INTO roles (codigo_empresa, nombre, privilegios, is_system) VALUES (?, ?, ?, false)',
        [codigo_empresa, nombre, privsStr]
    );
    return result.insertId;
}

/**
 * Actualiza un rol
 */
async function actualizarRol(id, codigo_empresa, nombre, privilegios) {
    if (!pool) return false;
    const privsStr = typeof privilegios === 'object' ? JSON.stringify(privilegios) : privilegios;
    await pool.query(
        'UPDATE roles SET nombre = ?, privilegios = ? WHERE id = ? AND codigo_empresa = ? AND is_system = false',
        [nombre, privsStr, id, codigo_empresa]
    );
    // Also allow updating privileges for system roles, but maybe not the name?
    // Let's just update privileges for system roles, but not name.
    const [roles] = await pool.query('SELECT is_system FROM roles WHERE id = ?', [id]);
    if (roles.length > 0 && roles[0].is_system) {
        await pool.query('UPDATE roles SET privilegios = ? WHERE id = ?', [privsStr, id]);
    }
    return true;
}

/**
 * Elimina un rol
 */
async function eliminarRol(id, codigo_empresa) {
    if (!pool) return false;
    await pool.query('DELETE FROM roles WHERE id = ? AND codigo_empresa = ? AND is_system = false', [id, codigo_empresa]);
    // Also, we might need to reassign users with this role to 'main'.
    const [mainRole] = await pool.query("SELECT id FROM roles WHERE codigo_empresa = ? AND nombre = 'main'", [codigo_empresa]);
    if (mainRole.length > 0) {
        await pool.query('UPDATE users SET rol_id = ? WHERE rol_id = ? AND codigo_empresa = ?', [mainRole[0].id, id, codigo_empresa]);
    }
    return true;
}

/**
 * Asigna un rol a un usuario
 */
async function asignarRolAUsuario(userId, rolId, codigo_empresa) {
    if (!pool) return false;
    await pool.query('UPDATE users SET rol_id = ? WHERE id = ? AND codigo_empresa = ?', [rolId, userId, codigo_empresa]);
    return true;
}

/**
 * Crea un flujo nuevo
 */
async function crearFlujo(codigo_empresa, nombre, trigger_keyword, data_json) {
    if (!pool) return null;
    const jsonStr = typeof data_json === 'object' ? JSON.stringify(data_json) : data_json;
    const [result] = await pool.query(
        'INSERT INTO flujos (codigo_empresa, nombre, trigger_keyword, data_json) VALUES (?, ?, ?, ?)',
        [codigo_empresa, nombre, trigger_keyword, jsonStr]
    );
    return result.insertId;
}

/**
 * Obtiene los flujos de una empresa
 */
async function obtenerFlujos(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM flujos WHERE codigo_empresa = ? ORDER BY creado_en DESC', [codigo_empresa]);
    return rows;
}

/**
 * Obtiene un flujo por id
 */
async function obtenerFlujo(id, codigo_empresa) {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM flujos WHERE id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    return rows[0] || null;
}

/**
 * Actualiza un flujo
 */
async function actualizarFlujo(id, codigo_empresa, data_json, activo = true, trigger_keyword = null) {
    if (!pool) return false;
    const jsonStr = typeof data_json === 'object' ? JSON.stringify(data_json) : data_json;
    await pool.query(
        'UPDATE flujos SET data_json = ?, activo = ?, trigger_keyword = ? WHERE id = ? AND codigo_empresa = ?',
        [jsonStr, activo, trigger_keyword, id, codigo_empresa]
    );
    return true;
}

/**
 * Elimina un flujo
 */
async function eliminarFlujo(id, codigo_empresa) {
    if (!pool) return false;
    // Remove references from contacts
    await pool.query('UPDATE contactos SET flujo_activo_id = NULL, nodo_actual_id = NULL WHERE flujo_activo_id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    // Delete flow
    await pool.query('DELETE FROM flujos WHERE id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    return true;
}

/**
 * Actualiza en qué flujo y nodo está el contacto
 */
async function actualizarContactoFlujo(contactoId, flujoId, nodoId) {
    if (!pool) return;
    await pool.query('UPDATE contactos SET flujo_activo_id = ?, nodo_actual_id = ? WHERE id = ?', [flujoId, nodoId, contactoId]);
}

module.exports = {
    initDB,
    upsertContacto,
    actualizarEstadoBot,
    actualizarAsignacionContacto,
    guardarMensaje,
    actualizarEstadoMensaje,
    obtenerHistorialMensajes,
    obtenerContactos,
    obtenerTodosLosMensajes,
    upsertUser,
    obtenerUsuario,
    obtenerUsuariosPorEmpresa,
    crearEmpresa,
    unirseEmpresa,
    obtenerEmpresa,
    obtenerEmpresaPorWebhookToken,
    obtenerEmpresaPorPhoneId,
    actualizarEmpresa,
    actualizarCuentasVinculadas,
    actualizarIA,
    obtenerRoles,
    crearRol,
    actualizarRol,
    eliminarRol,
    asignarRolAUsuario,
    crearCampana,
    obtenerCampanas,
    crearFlujo,
    obtenerFlujos,
    obtenerFlujo,
    actualizarFlujo,
    eliminarFlujo,
    actualizarContactoFlujo,
    get pool() { return pool; }
};
