const { chromium } = require('playwright-core');
const db = require('./database');
const b2bService = require('./b2bProspectsService');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

class B2BPlaywrightCrawler {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.shouldStop = false;
        this.currentJobId = null;
        this.codigoEmpresa = 'KRZMJI';
        this.currentOffice = null;
        this.currentOfficeIndex = 0;
        this.totalOffices = 0;
        this.extractedCount = 0;
        this.startedAt = null;
        this.logs = [];
        this.browser = null;
        this.page = null;
    }

    addLog(msg) {
        const time = new Date().toLocaleTimeString('es-AR');
        const entry = `[${time}] ${msg}`;
        console.log(`🕷️ ${entry}`);
        this.logs.unshift(entry);
        if (this.logs.length > 100) this.logs.pop();
    }

    async getPool() {
        if (!db.pool) await db.initDB();
        return db.pool;
    }

    /**
     * Retorna el estado actual del crawler para la UI
     */
    getStatus() {
        let percent = 0;
        if (this.totalOffices > 0) {
            percent = Math.min(100, Math.round((this.currentOfficeIndex / this.totalOffices) * 1000) / 10);
        }

        // Estimación de tiempo restante (asumiendo ~40s por oficina completa con agentes)
        let etaStr = 'Calculando...';
        if (this.isRunning && this.totalOffices > 0 && this.currentOfficeIndex > 0) {
            const remaining = this.totalOffices - this.currentOfficeIndex;
            const remainingSec = remaining * 45;
            const hours = Math.floor(remainingSec / 3600);
            const mins = Math.floor((remainingSec % 3600) / 60);
            etaStr = `${hours}h ${mins}m aprox.`;
        } else if (!this.isRunning && this.totalOffices > 0 && this.currentOfficeIndex >= this.totalOffices) {
            etaStr = 'Completado';
        }

        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            jobId: this.currentJobId,
            currentOffice: this.currentOffice,
            currentOfficeIndex: this.currentOfficeIndex,
            totalOffices: this.totalOffices,
            percent,
            extractedCount: this.extractedCount,
            startedAt: this.startedAt,
            etaStr,
            logs: this.logs.slice(0, 30)
        };
    }

    /**
     * Cargar y sembrar los checkpoints de las 215 oficinas de RE/MAX Argentina
     */
    async seedCheckpoints(jobId, codigoEmpresa = 'KRZMJI') {
        const pool = await this.getPool();
        const officeList = [];

        // 1. Oficinas de Base Prospección Excel
        const baseExcelPath = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx';
        if (fs.existsSync(baseExcelPath)) {
            try {
                const wb = xlsx.readFile(baseExcelPath);
                const ws = wb.Sheets['Base'];
                if (ws) {
                    const rows = xlsx.utils.sheet_to_json(ws);
                    for (const r of rows) {
                        const org = r['Organización'] || '';
                        const tipo = r['Tipo'] || '';
                        if (org.toLowerCase().includes('re/max') || tipo.toLowerCase().includes('re/max')) {
                            const url = r['Sitio web'] || r['URL fuente'] || '';
                            let slug = '';
                            if (url.includes('remax.com.ar/')) {
                                slug = url.split('remax.com.ar/')[1].split('/')[0].split('?')[0];
                            } else {
                                slug = org.toLowerCase().replace(/re\/max\s*/i, '').replace(/remax\s*/i, '').trim().replace(/\s+/g, '-');
                            }
                            if (slug && !officeList.some(o => o.slug === slug)) {
                                officeList.push({ name: org, slug, city: r['Ciudad / barrio'], province: r['Provincia'] });
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 2. Oficinas del Excel de Lotes 1 y 2
        const lotesExcelPath = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_REMAX_agentes_lotes1-2.xlsx';
        if (fs.existsSync(lotesExcelPath)) {
            try {
                const wb = xlsx.readFile(lotesExcelPath);
                const ws = wb.Sheets['Agentes REMAX'] || wb.Sheets[wb.SheetNames[0]];
                if (ws) {
                    const rows = xlsx.utils.sheet_to_json(ws);
                    for (const r of rows) {
                        const ofName = r['Oficina'] || '';
                        if (ofName) {
                            const slug = ofName.toLowerCase()
                                .replace(/re\/max\s*/i, '')
                                .replace(/remax\s*/i, '')
                                .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
                                .replace(/ñ/g, 'n')
                                .trim()
                                .replace(/[^a-z0-9]+/g, '-')
                                .replace(/^-+|-+$/g, '');
                            if (slug && !officeList.some(o => o.slug === slug)) {
                                officeList.push({ name: ofName, slug, city: r['Ciudad'], province: r['Provincia'] });
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 3. Slugs oficiales confirmados adicionales de RE/MAX Argentina
        const popularSlugs = [
            'alfa', '197', 'acqua', 'alfil', 'parque', 'total-i', 'norte', 'puerto', 'elite', 'action',
            'actitud', 'beach', 'blue', 'cimientos', 'class', 'class-ii', 'data-lagos', 'dreams', 'duo', 'espacio',
            'estilo', 'estudio', 'friends', 'grammar', 'namai', 'naval', 'potencia', 'remeros', 'summit',
            'vanguardia', 'vita', 'ayres', 'buro', 'chacras', 'concord', 'delta', 'focus', 'horizonte',
            'impacto', 'innovar', 'libertad', 'magnolia', 'milenio', 'nexus', 'oasis', 'power', 'eximia',
            'net', 'time', 'heart', 'free', 'uno-iv', 'terra', 'terrunos', 'pacara', 'faro', 'impulso',
            'eclipse', 'energy', 'estero', 'excelencia', 'exclusivo', 'extremo', 'fin-del-mundo', 'flor',
            'forever', 'fortaleza', 'forum', 'ilusion', 'invictus', 'iron', 'la-vie', 'litoral', 'metro',
            'metropolitano', 'mirage', 'modo', 'nativo', 'new', 'oportunidades', 'platino-iii', 'pora',
            'premium-ii', 'premium-v', 'raices', 'rio', 'roble-ii', 'signature', 'sinergia', 'social',
            'solutions', 'splendid', 'stage', 'supera', 'surf', 'teatro', 'titanium', 'towers', 'ultra',
            'unidos', 'uno', 'up', 'urbana', 'vip', 'vanguard', 'vendimia', 'village', 'vision'
        ];
        for (const s of popularSlugs) {
            if (!officeList.some(o => o.slug === s)) {
                officeList.push({ name: `REMAX ${s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')}`, slug: s });
            }
        }

        // Insertar checkpoints en DB
        for (const o of officeList) {
            const targetUrl = `https://www.remax.com.ar/${o.slug}`;
            try {
                await pool.query(`
                    INSERT INTO scraper_checkpoints (job_id, codigo_empresa, target_type, target_name, target_url, status)
                    VALUES (?, ?, 'OFFICE', ?, ?, 'PENDING')
                    ON DUPLICATE KEY UPDATE target_name = VALUES(target_name)
                `, [jobId, codigoEmpresa, o.name, targetUrl]);
            } catch(e) {}
        }

        this.addLog(`Checkpoints sembrados: ${officeList.length} oficinas de RE/MAX Argentina registradas en base de datos.`);
        return officeList.length;
    }

    /**
     * Iniciar o reanudar el crawler en segundo plano
     */
    async start(options = {}) {
        if (this.isRunning) {
            return { success: false, message: 'El crawler ya se encuentra en ejecución' };
        }

        const { codigoEmpresa = 'KRZMJI', fresh = false } = options;
        this.codigoEmpresa = codigoEmpresa;
        this.isPaused = false;
        this.shouldStop = false;
        this.isRunning = true;
        this.startedAt = new Date().toISOString();

        const pool = await this.getPool();

        // Buscar trabajo existente o crear uno nuevo
        let jobId = null;
        if (!fresh) {
            const [existing] = await pool.query(
                'SELECT id, total_pages, current_page FROM scraper_jobs WHERE codigo_empresa = ? AND layer = "CAPA_1_REMAX" AND status IN ("RUNNING", "PAUSED", "IDLE") ORDER BY id DESC LIMIT 1',
                [codigoEmpresa]
            );
            if (existing && existing.length > 0) {
                jobId = existing[0].id;
                this.addLog(`Reanudando trabajo anterior #${jobId} desde el último punto de control.`);
            }
        }

        if (!jobId) {
            const [insertRes] = await pool.query(`
                INSERT INTO scraper_jobs (codigo_empresa, job_name, layer, status, started_at)
                VALUES (?, 'Crawler Playwright Stealth RE/MAX Argentina', 'CAPA_1_REMAX', 'RUNNING', CURRENT_TIMESTAMP)
            `, [codigoEmpresa]);
            jobId = insertRes.insertId;
            this.addLog(`Nuevo trabajo de extracción creado #${jobId}.`);
            await this.seedCheckpoints(jobId, codigoEmpresa);
        }

        this.currentJobId = jobId;

        // Actualizar total de oficinas y procesadas
        const [cpStats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(IF(status = 'DONE', 1, 0)) as done_count,
                SUM(prospects_found) as prospects_total
            FROM scraper_checkpoints 
            WHERE job_id = ?
        `, [jobId]);

        this.totalOffices = cpStats[0]?.total || 215;
        this.currentOfficeIndex = cpStats[0]?.done_count || 0;
        this.extractedCount = cpStats[0]?.prospects_total || 0;

        await pool.query('UPDATE scraper_jobs SET status = "RUNNING", total_pages = ? WHERE id = ?', [this.totalOffices, jobId]);

        // Iniciar loop en background (asíncrono sin bloquear el request HTTP)
        this.runWorkerLoop(jobId, codigoEmpresa).catch(err => {
            console.error('Error en worker loop del crawler:', err);
            this.addLog(`❌ Error en worker loop: ${err.message}`);
            this.isRunning = false;
        });

        return {
            success: true,
            message: 'Crawler Playwright Stealth iniciado exitosamente en segundo plano',
            jobId,
            totalOffices: this.totalOffices,
            currentOfficeIndex: this.currentOfficeIndex
        };
    }

    /**
     * Pausar la ejecución
     */
    async pause() {
        if (!this.isRunning) return { success: false, message: 'El crawler no está en ejecución' };
        this.isPaused = true;
        this.addLog('Pausa solicitada. El crawler se pausará al terminar la oficina actual...');
        return { success: true, message: 'Pausando crawler...' };
    }

    /**
     * Reanudar ejecución
     */
    async resume() {
        if (this.isRunning && !this.isPaused) return { success: false, message: 'El crawler ya está corriendo' };
        this.isPaused = false;
        if (!this.isRunning) {
            return this.start({ codigoEmpresa: this.codigoEmpresa, fresh: false });
        }
        this.addLog('Reanudando crawler...');
        return { success: true, message: 'Crawler reanudado' };
    }

    /**
     * Detener por completo
     */
    async stop() {
        this.shouldStop = true;
        this.isRunning = false;
        this.isPaused = false;
        if (this.browser) {
            try { await this.browser.close(); } catch(e){}
            this.browser = null;
        }
        const pool = await this.getPool();
        if (this.currentJobId) {
            await pool.query('UPDATE scraper_jobs SET status = "PAUSED", finished_at = CURRENT_TIMESTAMP WHERE id = ?', [this.currentJobId]);
        }
        this.addLog('Crawler detenido por el usuario.');
        return { success: true, message: 'Crawler detenido' };
    }

    /**
     * Loop principal de Playwright Stealth con Jitter y Bloqueo de Assets
     */
    async runWorkerLoop(jobId, codigoEmpresa) {
        const pool = await this.getPool();

        this.addLog('Lanzando navegador Chromium Headless con flags Stealth...');
        this.browser = await chromium.launch({
            channel: 'chrome',
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--disable-extensions'
            ]
        });

        const context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            locale: 'es-AR',
            timezoneId: 'America/Argentina/Buenos_Aires'
        });

        // Evasión de detección navigator.webdriver
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        });

        this.page = await context.newPage();

        // -------------------------------------------------------------
        // OPTIMIZACIÓN DE RECURSOS (BLOQUEO DE ASSETS SEGÚN SKILLSCRAP.MD)
        // Reduce consumo de RAM un 70% y acelera navegación 5x
        // -------------------------------------------------------------
        await this.page.route('**/*', (route) => {
            const req = route.request();
            const type = req.resourceType();
            const url = req.url().toLowerCase();

            if (['image', 'font', 'media'].includes(type) ||
                url.includes('google-analytics') ||
                url.includes('facebook') ||
                url.includes('clarity') ||
                url.includes('doubleclick') ||
                url.includes('hotjar') ||
                url.includes('googletagmanager')) {
                return route.abort();
            }
            return route.continue();
        });

        this.addLog('Sesión iniciada. Visitando home de RE/MAX para establecer cookies de navegación...');
        try {
            await this.page.goto('https://www.remax.com.ar', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch(e) {}

        // Loop sobre checkpoints pendientes
        while (this.isRunning && !this.shouldStop) {
            if (this.isPaused) {
                this.addLog('Crawler en pausa. Esperando reanudación...');
                await pool.query('UPDATE scraper_jobs SET status = "PAUSED" WHERE id = ?', [jobId]);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            // Obtener siguiente checkpoint pendiente
            const [pending] = await pool.query(`
                SELECT * FROM scraper_checkpoints
                WHERE job_id = ? AND status IN ('PENDING', 'FAILED') AND attempts < 3
                ORDER BY id ASC LIMIT 1
            `, [jobId]);

            if (!pending || pending.length === 0) {
                this.addLog('🎉 ¡Todas las oficinas del lote han sido procesadas exitosamente!');
                await pool.query('UPDATE scraper_jobs SET status = "COMPLETED", finished_at = CURRENT_TIMESTAMP WHERE id = ?', [jobId]);
                break;
            }

            const cp = pending[0];
            this.currentOffice = cp.target_name || cp.target_url;
            await pool.query('UPDATE scraper_checkpoints SET status = "PROCESSING", attempts = attempts + 1 WHERE id = ?', [cp.id]);

            // Jitter Humano entre oficinas (2.5s a 4.8s)
            const jitterMs = Math.floor(Math.random() * (4800 - 2500) + 2500);
            this.addLog(`🏢 [${this.currentOfficeIndex + 1}/${this.totalOffices}] Procesando ${cp.target_name}... (Jitter: ${jitterMs}ms)`);
            await this.page.waitForTimeout(jitterMs);

            let officeProspectsCount = 0;
            try {
                const res = await this.page.goto(cp.target_url, { waitUntil: 'domcontentloaded', timeout: 35000 });
                const status = res ? res.status() : 0;

                // Backoff si Cloudflare limita
                if (status === 429 || status === 503) {
                    this.addLog(`⚠️ Rate limit detectado (${status}). Aplicando backoff de 60 segundos...`);
                    await this.page.waitForTimeout(60000);
                    throw new Error(`HTTP ${status} Rate Limited`);
                }

                if (status === 404) {
                    this.addLog(`Oficina no encontrada (404): ${cp.target_url}. Marcando SKIPPED.`);
                    await pool.query('UPDATE scraper_checkpoints SET status = "SKIPPED", processed_at = CURRENT_TIMESTAMP WHERE id = ?', [cp.id]);
                    this.currentOfficeIndex++;
                    continue;
                }

                await this.page.waitForTimeout(1500);

                // Clic específicamente en 'Ver todos' para desplegar la plantilla completa del equipo
                try {
                    const expanded = await this.page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button, a'));
                        const btn = btns.find(b => (b.innerText || '').trim().toLowerCase() === 'ver todos');
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        return false;
                    });
                    if (expanded) {
                        this.addLog(`Oficina ${cp.target_name}: Desplegando equipo completo con "Ver todos"...`);
                        await this.page.waitForTimeout(3000);
                    }
                } catch(e) {}

                // Obtener enlaces a perfiles de agentes en la página de la oficina
                const agentLinks = await this.page.$$eval('a', as => {
                    return Array.from(new Set(
                        as.map(a => a.href)
                          .filter(h => h && h.includes('/agent/'))
                    ));
                });

                this.addLog(`Oficina ${cp.target_name}: ${agentLinks.length} integrantes/agentes detectados.`);

                // Recorrer los perfiles de agentes de esta oficina
                for (const agentUrl of agentLinks) {
                    if (this.isPaused || this.shouldStop) break;

                    try {
                        // Delay humano breve entre agentes (1.2s a 2.2s)
                        const agentJitter = Math.floor(Math.random() * (2200 - 1200) + 1200);
                        await this.page.waitForTimeout(agentJitter);

                        const aRes = await this.page.goto(agentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
                        if (aRes && aRes.status() === 200) {
                            await this.page.waitForTimeout(1200);

                            // Extraer texto y datos del perfil
                            const pageData = await this.page.evaluate(() => {
                                const body = document.body ? document.body.innerText : '';
                                const title = document.title || '';
                                const h1 = document.querySelector('h1')?.innerText?.trim() || '';

                                // Buscar mailto
                                const mailLink = document.querySelector('a[href^="mailto:"]');
                                const email = mailLink ? mailLink.href.replace('mailto:', '').split('?')[0].trim() : null;

                                // Buscar WhatsApp link
                                const waLink = document.querySelector('a[href*="wa.me"], a[href*="whatsapp.com"]');
                                const whatsappUrl = waLink ? waLink.href : null;

                                return { body, title, h1, email, whatsappUrl };
                            });

                            // Parsear datos con heurística
                            const nameCandidate = pageData.h1 || pageData.title.split('|')[0].trim();
                            const bodyLines = pageData.body.split('\n').map(l => l.trim()).filter(Boolean);

                            // Detectar teléfono
                            let phoneRaw = null;
                            const phoneRegex = /(?:\+?54\s*9?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
                            for (const line of bodyLines) {
                                if (line.match(phoneRegex)) {
                                    phoneRaw = line.match(phoneRegex)[0];
                                    break;
                                }
                            }
                            if (!phoneRaw && pageData.whatsappUrl) {
                                phoneRaw = pageData.whatsappUrl;
                            }

                            // Detectar matrícula
                            let matricula = null;
                            for (const line of bodyLines) {
                                if (line.includes('CPI') || line.includes('CSM') || line.includes('CUCICBA') || line.includes('Mat.')) {
                                    matricula = line;
                                    break;
                                }
                            }

                            // Clasificar rol
                            const isBroker = pageData.body.toLowerCase().includes('corredor') ||
                                             pageData.body.toLowerCase().includes('broker') ||
                                             pageData.body.toLowerCase().includes('martillero');

                            // Guardar en b2b_prospects
                            await b2bService.upsertProspect({
                                full_name: nameCandidate,
                                email: pageData.email,
                                phone: phoneRaw,
                                role: isBroker ? 'broker' : 'agente',
                                company_or_board: 'RE/MAX Argentina',
                                office_name: cp.target_name,
                                source_layer: 'CAPA_1_REMAX',
                                source_url: agentUrl,
                                metadata_extra: {
                                    matricula,
                                    scraped_live: true,
                                    oficina_slug: cp.target_url
                                }
                            }, codigoEmpresa);

                            officeProspectsCount++;
                            this.extractedCount++;
                        }
                    } catch(errAgent) {
                        // Continuar con el siguiente agente si falla uno
                    }
                }

                // Checkpoint completado
                await pool.query(`
                    UPDATE scraper_checkpoints 
                    SET status = 'DONE', prospects_found = ?, processed_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [officeProspectsCount, cp.id]);

                this.currentOfficeIndex++;

                // Actualizar progreso del job
                await pool.query(`
                    UPDATE scraper_jobs
                    SET total_inserted = ?, current_page = ?, last_url = ?, last_heartbeat = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [this.extractedCount, this.currentOfficeIndex, cp.target_url, jobId]);

                this.addLog(`✅ Oficina ${cp.target_name} finalizada: ${officeProspectsCount} prospectos procesados (Total acumulado: ${this.extractedCount}).`);

            } catch (errOffice) {
                this.addLog(`⚠️ Error en oficina ${cp.target_name}: ${errOffice.message}`);
                await pool.query(`
                    UPDATE scraper_checkpoints
                    SET status = 'FAILED', error_details = ?
                    WHERE id = ?
                `, [errOffice.message, cp.id]);
            }
        }

        // Cierre del navegador al finalizar o detener
        if (this.browser) {
            try { await this.browser.close(); } catch(e){}
            this.browser = null;
        }
        this.isRunning = false;
        this.addLog('Proceso del crawler finalizado.');
    }
}

const b2bCrawler = new B2BPlaywrightCrawler();
module.exports = b2bCrawler;
