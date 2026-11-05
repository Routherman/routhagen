const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'routhagent'
};

async function initB2BTables() {
    console.log('📦 Inicializando tablas b2b_prospects y scraper_jobs...');
    const conn = await mysql.createConnection(dbConfig);

    await conn.query(`
        CREATE TABLE IF NOT EXISTS b2b_prospects (
            id VARCHAR(36) PRIMARY KEY,
            codigo_empresa VARCHAR(50) DEFAULT 'KRZMJI',
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(150),
            email_domain VARCHAR(100),
            phone_raw VARCHAR(100),
            phone_e164 VARCHAR(50),
            detected_role ENUM('ASESOR_POTENCIAL', 'LIDER_BROKER_POTENCIAL') NOT NULL DEFAULT 'ASESOR_POTENCIAL',
            assigned_bot_flow ENUM('FLOW_2_ASESORES', 'FLOW_3_LIDERES') NOT NULL DEFAULT 'FLOW_2_ASESORES',
            company_or_board VARCHAR(150),
            office_name VARCHAR(150),
            broker_owner_name VARCHAR(150),
            city VARCHAR(100),
            province VARCHAR(100),
            source_layer ENUM('CAPA_1_REMAX', 'CAPA_2_PADRONES_CORREDORES', 'CAPA_3_PREVISIONALISTAS', 'CAPA_4_CONTADORES', 'CAPA_5_PAS') NOT NULL DEFAULT 'CAPA_1_REMAX',
            source_url TEXT,
            extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            campaign_status ENUM('NUEVO', 'LOTE_GMAIL_EXPORTADO', 'EMAIL_ENVIADO', 'WHATSAPP_ENVIADO', 'RESPONDIO_INTERESADO', 'REGISTRADO_WEBINAR', 'CONVERTIDO_ASESOR', 'OPT_OUT_BAJA') DEFAULT 'NUEVO',
            opt_out_at TIMESTAMP NULL,
            last_contacted_at TIMESTAMP NULL,
            metadata_extra JSON,
            INDEX idx_empresa (codigo_empresa),
            INDEX idx_email (email),
            INDEX idx_phone (phone_e164),
            INDEX idx_domain (email_domain),
            INDEX idx_role (detected_role),
            INDEX idx_layer (source_layer),
            INDEX idx_status (campaign_status)
        );
    `);

    await conn.query(`
        CREATE TABLE IF NOT EXISTS scraper_jobs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codigo_empresa VARCHAR(50) DEFAULT 'KRZMJI',
            job_name VARCHAR(100) NOT NULL,
            layer VARCHAR(50) NOT NULL,
            status ENUM('IDLE', 'RUNNING', 'COMPLETED', 'FAILED', 'PAUSED') DEFAULT 'IDLE',
            total_found INT DEFAULT 0,
            total_inserted INT DEFAULT 0,
            current_page INT DEFAULT 1,
            total_pages INT DEFAULT 1,
            last_url TEXT,
            error_message TEXT,
            started_at TIMESTAMP NULL,
            finished_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await conn.query(`
        CREATE TABLE IF NOT EXISTS scraper_checkpoints (
            id INT AUTO_INCREMENT PRIMARY KEY,
            job_id INT NOT NULL,
            codigo_empresa VARCHAR(50) DEFAULT 'KRZMJI',
            target_type VARCHAR(50) DEFAULT 'OFFICE',
            target_name VARCHAR(150),
            target_url VARCHAR(255) NOT NULL,
            status ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED') DEFAULT 'PENDING',
            prospects_found INT DEFAULT 0,
            attempts INT DEFAULT 0,
            error_details TEXT,
            processed_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_job_status (job_id, status),
            INDEX idx_target_url (target_url)
        );
    `);

    try {
        await conn.query(`
            ALTER TABLE b2b_prospects 
            MODIFY COLUMN campaign_status ENUM('NUEVO', 'LOTE_GMAIL_EXPORTADO', 'EMAIL_ENVIADO', 'WHATSAPP_ENVIADO', 'RESPONDIO_INTERESADO', 'REGISTRADO_WEBINAR', 'CONVERTIDO_ASESOR', 'CONVERTIDO_CRM', 'OPT_OUT_BAJA') DEFAULT 'NUEVO'
        `);
        console.log('✅ ENUM campaign_status actualizado con CONVERTIDO_CRM.');
    } catch (e) {
        console.warn('Nota sobre alter campaign_status:', e.message);
    }

    try {
        await conn.query(`
            ALTER TABLE b2b_prospects 
            MODIFY COLUMN source_layer ENUM('CAPA_1_REMAX', 'CAPA_2_PADRONES_CORREDORES', 'CAPA_3_PREVISIONALISTAS', 'CAPA_4_DESARROLLADORES', 'CAPA_4_CONTADORES', 'CAPA_5_PAS') NOT NULL DEFAULT 'CAPA_1_REMAX'
        `);
        console.log('✅ ENUM source_layer actualizado con CAPA_4_DESARROLLADORES.');
    } catch (e) {
        console.warn('Nota sobre alter source_layer:', e.message);
    }

    console.log('✅ Tablas b2b_prospects, scraper_jobs y scraper_checkpoints creadas correctamente.');
    await conn.end();
}

initB2BTables().catch(err => {
    console.error('❌ Error creando tablas B2B:', err);
    process.exit(1);
});
