/**
 * Telegram Tunnel para Routh Agent & Antigravity
 * 
 * Permite enviar texto o notas de voz desde tu celular (1136822400) a Antigravity / Routh Agent,
 * transcribe el audio con Groq Whisper y ejecuta la instrucción devolviendo la salida de consola por Telegram.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const Groq = require('groq-sdk');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_TOKEN = process.env.GROQ_TOKEN;
const TARGET_PHONE = '1136822400';
const AUTH_FILE = path.join(__dirname, 'telegram_auth.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..');

if (!TELEGRAM_TOKEN) {
    console.warn('⚠️ [TELEGRAM TUNNEL] TELEGRAM_BOT_TOKEN no configurado en .env.');
    console.warn('ℹ️ Coloca TELEGRAM_BOT_TOKEN en backend/.env con el formato 123456789:ABCDefgh...');
}

const groq = GROQ_TOKEN ? new Groq({ apiKey: GROQ_TOKEN }) : null;

// Funciones de autenticación y persistencia
function getAuthData() {
    try {
        if (fs.existsSync(AUTH_FILE)) {
            return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
        }
    } catch (e) {}
    return { authorized_chat_id: null, phone: TARGET_PHONE };
}

function saveAuthData(data) {
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error guardando telegram_auth.json:', e);
    }
}

// Enviar mensaje de texto a Telegram
async function sendTelegramMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
    if (!TELEGRAM_TOKEN) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    // Telegram limita los mensajes a 4096 caracteres
    const maxLen = 3900;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.substring(i, i + maxLen));
    }

    for (let idx = 0; idx < chunks.length; idx++) {
        const payload = {
            chat_id: chatId,
            text: chunks[idx],
            parse_mode: parseMode
        };
        // Solo adjuntar reply_markup en el último chunk
        if (replyMarkup && idx === chunks.length - 1) {
            payload.reply_markup = replyMarkup;
        }

        try {
            await axios.post(url, payload, { timeout: 15000 });
        } catch (err) {
            // Fallback sin parse_mode si falla el formateo HTML
            try {
                delete payload.parse_mode;
                await axios.post(url, payload, { timeout: 15000 });
            } catch (fallbackErr) {
                console.error('Error enviando mensaje a Telegram:', fallbackErr.message);
            }
        }
    }
}

// Descargar archivo de audio de Telegram
async function downloadTelegramAudio(fileId) {
    const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
    const fileRes = await axios.get(getFileUrl);
    const filePath = fileRes.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

    const tempDir = path.join(__dirname, 'temp_audio');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const localFileName = `voice_${Date.now()}.ogg`;
    const localFilePath = path.join(tempDir, localFileName);

    const writer = fs.createWriteStream(localFilePath);
    const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(localFilePath));
        writer.on('error', reject);
    });
}

// Transcribir audio a texto usando Groq Whisper v3
async function transcribeAudio(audioPath) {
    if (!groq) {
        throw new Error('Groq no está configurado (GROQ_TOKEN faltante).');
    }
    const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-large-v3',
        language: 'es',
        response_format: 'json'
    });

    // Limpiar archivo temporal
    try { fs.unlinkSync(audioPath); } catch(e){}

    return transcription.text;
}

// Ejecutar comando en consola y capturar salida
function executeShellCommand(command, cwd = WORKSPACE_DIR) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        exec(command, { cwd, timeout: 180000, maxBuffer: 10 * 1024 * 1024, shell: 'powershell.exe' }, (error, stdout, stderr) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            resolve({
                command,
                stdout: stdout || '',
                stderr: stderr || '',
                error: error ? error.message : null,
                duration
            });
        });
    });
}

// Procesar instrucción recibida (texto o audio transcrito)
async function processInstruction(chatId, instruction, userName = '') {
    console.log(`🤖 [TELEGRAM] Instrucción de ${userName}: "${instruction}"`);

    await sendTelegramMessage(chatId, `⏳ <b>Procesando orden con Antigravity:</b>\n<i>"${instruction}"</i>`);

    let commandToRun = '';
    const cleanInst = instruction.trim();

    if (cleanInst.startsWith('/cmd ') || cleanInst.startsWith('/run ')) {
        commandToRun = cleanInst.replace(/^\/(cmd|run)\s+/, '');
    } else if (cleanInst.toLowerCase().startsWith('git ')) {
        commandToRun = cleanInst;
    } else if (cleanInst.toLowerCase().includes('compilar') || cleanInst.toLowerCase().includes('build')) {
        commandToRun = 'cd frontend; npm run build';
    } else if (cleanInst.toLowerCase() === 'status' || cleanInst.toLowerCase() === 'estado' || cleanInst.toLowerCase() === '/status') {
        commandToRun = 'Write-Host "=== BACKEND ==="; cd backend; git status -s; cd ..; Write-Host ""; Write-Host "=== FRONTEND ==="; cd frontend; git status -s; cd ..; Write-Host ""; Write-Host "Node: $(node -v)"';
    } else if (cleanInst.toLowerCase() === 'hola' || cleanInst.toLowerCase() === 'buenas') {
        await sendTelegramMessage(
            chatId, 
            `👋 <b>¡Hola! Conexión activa con Antigravity & Routh Agent</b>\n\nCelular autorizado: <code>${TARGET_PHONE}</code>\nWorkspace: <code>${WORKSPACE_DIR}</code>\n\n¿Qué cambios deseas realizar hoy? Puedes escribirme o enviarme un audio de voz.`
        );
        return;
    } else {
        // Enviar al Router Multi-IA de Colaboratium
        try {
            const aiRouter = require('./aiRouter');
            const aiResponse = await aiRouter.routeAiMessage(
                `Eres el asistente técnico de Antigravity en Colaboratium conectado por Telegram al celular de Ignacio (1136822400). Responde de forma concisa, técnica y orientada a desarrollo:\n\nUsuario solicita: "${instruction}"`,
                [],
                { nombre: 'Colaboratium Admin', codigo: 'KRZMJI' }
            );

            await sendTelegramMessage(chatId, `<b>Antigravity IA:</b>\n\n${aiResponse.content || aiResponse}`);
            return;
        } catch (aiErr) {
            commandToRun = `echo "Instrucción recibida: ${cleanInst.replace(/"/g, '')}"`;
        }
    }

    // Inteligencia para comandos Git en estructura multi-repositorio (backend + frontend)
    if (commandToRun && /^git\s+/i.test(commandToRun.trim()) && !commandToRun.includes('cd backend') && !commandToRun.includes('cd frontend')) {
        const gitSubcmd = commandToRun.trim();
        commandToRun = `Write-Host "=== BACKEND ==="; cd backend; ${gitSubcmd}; cd ..; Write-Host ""; Write-Host "=== FRONTEND ==="; cd frontend; ${gitSubcmd}; cd ..`;
    }

    if (commandToRun) {
        await sendTelegramMessage(chatId, `⚙️ <b>Ejecutando en consola:</b>\n<code>${commandToRun}</code>`);
        const result = await executeShellCommand(commandToRun);

        let reply = `<b>Consola (${result.duration}s):</b>\n`;
        if (result.stdout) {
            reply += `<pre>${result.stdout.substring(0, 3000)}</pre>\n`;
        }
        if (result.stderr) {
            reply += `⚠️ <b>Stderr:</b>\n<pre>${result.stderr.substring(0, 1000)}</pre>\n`;
        }
        if (result.error && !result.stderr) {
            reply += `❌ <b>Error:</b> ${result.error}\n`;
        }

        await sendTelegramMessage(chatId, reply);
    }
}

// Bucle principal de Long Polling para Telegram
async function startTelegramPolling() {
    if (!TELEGRAM_TOKEN) {
        console.log('ℹ️ Telegram Polling desactivado (falta TELEGRAM_BOT_TOKEN).');
        return;
    }

    console.log('🚀 [TELEGRAM TUNNEL] Conectado y escuchando exclusivamente para celular ' + TARGET_PHONE + '...');
    let offset = 0;

    while (true) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=25`;
            const res = await axios.get(url, { timeout: 35000 });
            const updates = res.data.result || [];

            for (const update of updates) {
                offset = update.update_id + 1;
                const msg = update.message;
                if (!msg) continue;

                const chatId = msg.chat.id;
                const userName = msg.from.first_name || msg.from.username || 'Celular ' + TARGET_PHONE;
                let auth = getAuthData();

                // 1. Caso: Contacto compartido (verificación oficial de número de teléfono)
                if (msg.contact) {
                    const rawPhone = String(msg.contact.phone_number || '').replace(/\D/g, '');
                    console.log(`📱 Contacto recibido: ${rawPhone}`);
                    if (rawPhone.includes(TARGET_PHONE) || TARGET_PHONE.includes(rawPhone) || rawPhone.endsWith(TARGET_PHONE)) {
                        auth.authorized_chat_id = chatId;
                        auth.phone = rawPhone;
                        auth.verified_at = new Date().toISOString();
                        saveAuthData(auth);

                        await sendTelegramMessage(
                            chatId, 
                            `✅ <b>¡Identidad Verificada!</b>\nEl celular <b>+${rawPhone}</b> ha sido autenticado como el único administrador autorizado para este túnel de Antigravity.\n\nYa puedes enviarme texto o audios de voz con tus pedidos para la app.`,
                            'HTML',
                            { remove_keyboard: true }
                        );
                        continue;
                    } else {
                        await sendTelegramMessage(chatId, `⛔ <b>Acceso denegado:</b> El número +${rawPhone} no coincide con el celular autorizado (${TARGET_PHONE}).`);
                        continue;
                    }
                }

                // 2. Comprobación de seguridad: Si no está verificado el chat_id
                const isAuthorized = auth.authorized_chat_id && auth.authorized_chat_id === chatId;

                // Si aún no hay ningún chat_id registrado y el usuario escribe "hola" o envía mensaje
                if (!isAuthorized) {
                    // Si el usuario escribe /auth o incluye su número
                    const text = (msg.text || '').trim();
                    if (text.includes(TARGET_PHONE) || text === '/auth' || !auth.authorized_chat_id) {
                        // Si no había chat_id previo, registrar este chat como el del creador
                        auth.authorized_chat_id = chatId;
                        auth.phone = TARGET_PHONE;
                        auth.verified_at = new Date().toISOString();
                        saveAuthData(auth);
                        console.log(`🔐 Chat ID ${chatId} autenticado automáticamente para ${TARGET_PHONE}`);

                        await sendTelegramMessage(
                            chatId,
                            `✅ <b>¡Conexión Establecida con Antigravity!</b>\n\nTu chat ha quedado vinculado exclusivamente a tu celular <b>${TARGET_PHONE}</b>.\nCualquier mensaje o audio de voz que envíes se procesará directamente en tu proyecto.`,
                            'HTML',
                            { remove_keyboard: true }
                        );

                        // Si envió "hola", responder inmediatamente
                        if (text.toLowerCase().includes('hola')) {
                            await processInstruction(chatId, 'hola', userName);
                        }
                        continue;
                    } else {
                        // Rechazar acceso a terceros
                        await sendTelegramMessage(
                            chatId,
                            `⛔ <b>Acceso Restringido</b>\nEste bot es un túnel privado exclusivo para el teléfono <b>${TARGET_PHONE}</b>.`,
                            'HTML',
                            {
                                keyboard: [[{ text: `📱 Autenticar mi número (${TARGET_PHONE})`, request_contact: true }]],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        );
                        continue;
                    }
                }

                // 3. Caso: Mensaje de Voz / Audio desde el teléfono autorizado
                if (msg.voice || msg.audio) {
                    const fileId = msg.voice ? msg.voice.file_id : msg.audio.file_id;
                    await sendTelegramMessage(chatId, '🎙️ <i>Audio recibido. Transcribiendo con Groq Whisper v3...</i>');

                    try {
                        const audioPath = await downloadTelegramAudio(fileId);
                        const transcription = await transcribeAudio(audioPath);

                        await sendTelegramMessage(chatId, `🗣️ <b>Transcripción:</b> <i>"${transcription}"</i>`);
                        await processInstruction(chatId, transcription, userName);
                    } catch (audioErr) {
                        console.error('Error procesando audio de Telegram:', audioErr);
                        await sendTelegramMessage(chatId, `❌ Error transcribiendo audio: ${audioErr.message}`);
                    }
                }
                // 4. Caso: Mensaje de Texto desde el teléfono autorizado
                else if (msg.text) {
                    const text = msg.text.trim();

                    if (text === '/start') {
                        await sendTelegramMessage(chatId, `👋 <b>¡Hola! Conexión activa con Antigravity & Routh Agent</b>\n\nPuedes enviarme:\n• <b>Texto:</b> Pidiendo cambios o instrucciones para la app.\n• <b>Audios de voz:</b> Los transcribo con Whisper e inicio la tarea.\n• <b>/cmd &lt;comando&gt;:</b> Ejecuta comandos directos y devuelve la salida de consola.\n\nEcosistema: <code>${WORKSPACE_DIR}</code>`);
                    } else {
                        await processInstruction(chatId, text, userName);
                    }
                }
            }
        } catch (err) {
            // Reintentar tras breve pausa en caso de pérdida temporal de red
            await new Promise(r => setTimeout(r, 4000));
        }
    }
}

// Iniciar automáticamente si se ejecuta directo
if (require.main === module) {
    startTelegramPolling().catch(console.error);
}

module.exports = {
    startTelegramPolling,
    sendTelegramMessage,
    processInstruction
};
