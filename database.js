const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
};

const getDBName = () => process.env.DB_NAME || 'routhagent';

let pool;

async function initDB() {
    try {
        const dbName = getDBName();
        const connection = await mysql.createConnection(dbConfig);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        await connection.end();

        // 2. Crear el pool de conexiones conectado específicamente a nuestra base de datos
        pool = mysql.createPool({
            ...dbConfig,
            database: dbName,
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
                trigger_keyword VARCHAR(255),
                data_json JSON,
                activo BOOLEAN DEFAULT TRUE,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Update existing tables
        try {
            await pool.query('ALTER TABLE flujos MODIFY COLUMN trigger_keyword VARCHAR(255)');
        } catch(e) {}
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
        // Tabla de Tickets
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                contacto_id INT DEFAULT NULL,
                customer_number VARCHAR(100) NOT NULL,
                customer_name VARCHAR(150) DEFAULT NULL,
                status VARCHAR(50) DEFAULT 'open',
                summary TEXT DEFAULT NULL,
                assigned_to_user_id VARCHAR(150) DEFAULT NULL,
                assigned_to_name VARCHAR(150) DEFAULT NULL,
                email_sent_to VARCHAR(150) DEFAULT NULL,
                email_sent_at TIMESTAMP NULL DEFAULT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (contacto_id) REFERENCES contactos(id) ON DELETE SET NULL
            );
        `);

        // Tabla de Estadísticas de Modelos IA (Consumo de Tokens)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_models_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                model_name VARCHAR(150) NOT NULL,
                tokens_used BIGINT DEFAULT 0,
                success_count INT DEFAULT 0,
                fail_count INT DEFAULT 0,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_company_model (codigo_empresa, model_name)
            );
        `);

        // Tabla de Rubros / Grupos de Contactos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rubros (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa VARCHAR(50) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN dni VARCHAR(50) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN direccion TEXT DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN cbu VARCHAR(50) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN alias VARCHAR(50) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN banco VARCHAR(100) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN sucursal VARCHAR(100) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query("ALTER TABLE contactos ADD COLUMN grupo VARCHAR(100) DEFAULT 'CLIENTES'");
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN instagram VARCHAR(150) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN facebook VARCHAR(150) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN linkedin VARCHAR(150) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN telegram VARCHAR(150) DEFAULT NULL');
        } catch(e) {}
        try {
            await pool.query('ALTER TABLE contactos ADD COLUMN metadata_extra JSON DEFAULT NULL');
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
async function upsertContacto(telefono, nombre, codigo_empresa, email = null) {
    if (!pool) return null;
    
    await pool.query(`
        INSERT INTO contactos (telefono, nombre, codigo_empresa, email) 
        VALUES (?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
            nombre = IF(VALUES(nombre) IS NOT NULL AND VALUES(nombre) != '', VALUES(nombre), nombre),
            email = IF(VALUES(email) IS NOT NULL AND VALUES(email) != '', VALUES(email), email)
    `, [telefono, nombre, codigo_empresa, email]);
    
    const [rows] = await pool.query('SELECT id, estado_bot, nombre, telefono, email FROM contactos WHERE telefono = ? AND codigo_empresa = ?', [telefono, codigo_empresa]);
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
        ON DUPLICATE KEY UPDATE contenido = VALUES(contenido)
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
            (SELECT COUNT(*) FROM mensajes m WHERE m.campana_id = c.id AND m.estado_entrega = 'read') as leidos,
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
    
    // Si es una cuenta de administrador de Colaboratium, preasignar empresa y rol master (ID 1)
    const adminEmails = ['colaboratium@gmail.com', 'publicidadgloballoan@gmail.com', 'publididadgloballoan@gmail.com'];
    let defaultCodigo = null;
    let defaultRolId = null;
    if (email && adminEmails.includes(email.toLowerCase().trim())) {
        defaultCodigo = 'KRZMJI';
        defaultRolId = 1;
    }

    await pool.query(`
        INSERT INTO users (clerk_id, email, first_name, last_name, image_url, token, codigo_empresa, rol_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
            email = VALUES(email),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            image_url = VALUES(image_url),
            token = COALESCE(VALUES(token), token),
            codigo_empresa = IF(VALUES(codigo_empresa) IS NOT NULL, VALUES(codigo_empresa), codigo_empresa),
            rol_id = IF(VALUES(rol_id) IS NOT NULL, VALUES(rol_id), rol_id)
    `, [clerkId, email, firstName, lastName, imageUrl, token, defaultCodigo, defaultRolId]);
    
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

// -------------------------------------------------------------
// TICKETS (HELPDESK / ÓRDENES)
// -------------------------------------------------------------
async function crearTicket(codigo_empresa, contacto_id, customer_number, customer_name, status = 'open', summary = null, assigned_to_user_id = null, assigned_to_name = null) {
    if (!pool) return null;
    const [result] = await pool.query(`
        INSERT INTO tickets (codigo_empresa, contacto_id, customer_number, customer_name, status, summary, assigned_to_user_id, assigned_to_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [codigo_empresa, contacto_id, customer_number, customer_name, status, summary, assigned_to_user_id, assigned_to_name]);
    return result.insertId;
}

async function obtenerTickets(codigo_empresa, status = null) {
    if (!pool) return [];
    let query = 'SELECT * FROM tickets WHERE codigo_empresa = ?';
    const params = [codigo_empresa];
    if (status && status !== 'all') {
        const statuses = status.split(',').map(s => s.trim());
        query += ` AND status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
    }
    query += ' ORDER BY creado_en DESC';
    const [rows] = await pool.query(query, params);
    return rows;
}

async function obtenerTicket(id, codigo_empresa) {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    return rows[0] || null;
}

async function actualizarTicket(id, codigo_empresa, updateData) {
    if (!pool) return false;
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updateData)) {
        if (['status', 'summary', 'assigned_to_user_id', 'assigned_to_name', 'email_sent_to', 'email_sent_at', 'customer_name'].includes(key)) {
            fields.push(`${key} = ?`);
            values.push(val);
        }
    }
    if (fields.length === 0) return false;
    values.push(id, codigo_empresa);
    await pool.query(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ? AND codigo_empresa = ?`, values);
    return true;
}

async function eliminarTicket(id, codigo_empresa) {
    if (!pool) return false;
    await pool.query('DELETE FROM tickets WHERE id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    return true;
}

// -------------------------------------------------------------
// TELEMETRÍA DE MODELOS IA & CONSUMO DE TOKENS
// -------------------------------------------------------------
async function actualizarAiStat(codigo_empresa, model_name, tokens_used = 0, success = 1, fail = 0) {
    if (!pool) return;
    try {
        await pool.query(`
            INSERT INTO ai_models_stats (codigo_empresa, model_name, tokens_used, success_count, fail_count)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                tokens_used = tokens_used + VALUES(tokens_used),
                success_count = success_count + VALUES(success_count),
                fail_count = fail_count + VALUES(fail_count)
        `, [codigo_empresa, model_name, tokens_used, success, fail]);
    } catch (e) {
        console.error('Error actualizando ai_models_stats:', e.message);
    }
}

async function obtenerAiStats(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM ai_models_stats WHERE codigo_empresa = ? ORDER BY tokens_used DESC', [codigo_empresa]);
    return rows;
}

// -------------------------------------------------------------
// CRM DE CONTACTOS (AGENDA COMPLETA)
// -------------------------------------------------------------
async function obtenerContactosCRM(codigo_empresa, grupo = null, search = '') {
    if (!pool) return [];
    let query = 'SELECT * FROM contactos WHERE codigo_empresa = ?';
    const params = [codigo_empresa];
    if (grupo && grupo !== 'TODOS') {
        query += ' AND grupo = ?';
        params.push(grupo);
    }
    if (search && search.trim()) {
        query += ' AND (nombre LIKE ? OR telefono LIKE ? OR email LIKE ? OR dni LIKE ?)';
        const s = `%${search.trim()}%`;
        params.push(s, s, s, s);
    }
    query += ' ORDER BY creado_en DESC';
    const [rows] = await pool.query(query, params);
    return rows;
}

async function actualizarContactoCRM(id, codigo_empresa, data) {
    if (!pool) return false;
    const allowed = ['nombre', 'email', 'dni', 'direccion', 'cbu', 'alias', 'banco', 'sucursal', 'grupo', 'instagram', 'facebook', 'linkedin', 'telegram', 'metadata_extra'];
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(data)) {
        if (allowed.includes(k)) {
            fields.push(`${k} = ?`);
            values.push(k === 'metadata_extra' && typeof v === 'object' ? JSON.stringify(v) : v);
        }
    }
    if (fields.length === 0) return false;
    values.push(id, codigo_empresa);
    await pool.query(`UPDATE contactos SET ${fields.join(', ')} WHERE id = ? AND codigo_empresa = ?`, values);
    return true;
}

async function crearContactoCRM(codigo_empresa, data) {
    if (!pool) return null;
    const metaStr = data.metadata_extra && typeof data.metadata_extra === 'object' ? JSON.stringify(data.metadata_extra) : data.metadata_extra;
    const [res] = await pool.query(`
        INSERT INTO contactos (telefono, nombre, codigo_empresa, email, dni, direccion, cbu, alias, banco, sucursal, grupo, instagram, facebook, linkedin, telegram, metadata_extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            nombre = VALUES(nombre),
            email = VALUES(email),
            dni = VALUES(dni),
            direccion = VALUES(direccion),
            cbu = VALUES(cbu),
            alias = VALUES(alias),
            banco = VALUES(banco),
            sucursal = VALUES(sucursal),
            grupo = VALUES(grupo),
            instagram = VALUES(instagram),
            facebook = VALUES(facebook),
            linkedin = VALUES(linkedin),
            telegram = VALUES(telegram),
            metadata_extra = VALUES(metadata_extra)
    `, [
        data.telefono, data.nombre || '', codigo_empresa, data.email || null,
        data.dni || null, data.direccion || null, data.cbu || null, data.alias || null,
        data.banco || null, data.sucursal || null, data.grupo || 'CLIENTES',
        data.instagram || null, data.facebook || null, data.linkedin || null, data.telegram || null,
        metaStr || null
    ]);
    return res.insertId;
}

async function eliminarContactoCRM(id, codigo_empresa) {
    if (!pool) return false;
    await pool.query('DELETE FROM contactos WHERE id = ? AND codigo_empresa = ?', [id, codigo_empresa]);
    return true;
}

async function obtenerRubros(codigo_empresa) {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM rubros WHERE codigo_empresa = ? ORDER BY nombre ASC', [codigo_empresa]);
    return rows;
}

async function crearRubro(codigo_empresa, nombre) {
    if (!pool) return null;
    const [res] = await pool.query('INSERT INTO rubros (codigo_empresa, nombre) VALUES (?, ?)', [codigo_empresa, nombre]);
    return res.insertId;
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
    // Nuevas funciones
    crearTicket,
    obtenerTickets,
    obtenerTicket,
    actualizarTicket,
    eliminarTicket,
    actualizarAiStat,
    obtenerAiStats,
    obtenerContactosCRM,
    actualizarContactoCRM,
    crearContactoCRM,
    eliminarContactoCRM,
    obtenerRubros,
    crearRubro,
    get pool() { return pool; }
};
