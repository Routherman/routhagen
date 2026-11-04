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
const ALLOWED_USER = process.env.TELEGRAM_ALLOWED_USER || ''; // ID o teléfono
const WORKSPACE_DIR = path.resolve(__dirname, '..');

if (!TELEGRAM_TOKEN) {
    console.warn('⚠️ [TELEGRAM TUNNEL] TELEGRAM_BOT_TOKEN no configurado en .env.');
    console.warn('ℹ️ Crea tu bot con @BotFather en Telegram y coloca TELEGRAM_BOT_TOKEN=tu_token en backend/.env');
}

const groq = GROQ_TOKEN ? new Groq({ apiKey: GROQ_TOKEN }) : null;

// Enviar mensaje de texto a Telegram
async function sendTelegramMessage(chatId, text, parseMode = 'HTML') {
    if (!TELEGRAM_TOKEN) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    // Telegram limita los mensajes a 4096 caracteres
    const maxLen = 3900;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.substring(i, i + maxLen));
    }

    for (const chunk of chunks) {
        try {
            await axios.post(url, {
                chat_id: chatId,
                text: chunk,
                parse_mode: parseMode
            }, { timeout: 15000 });
        } catch (err) {
            // Fallback sin parse_mode si falla el formateo HTML
            try {
                await axios.post(url, {
                    chat_id: chatId,
                    text: chunk
                }, { timeout: 15000 });
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
    console.log(`🤖 [TELEGRAM] Instrucción recibida de ${userName}: "${instruction}"`);

    await sendTelegramMessage(chatId, `⏳ <b>Procesando orden con Antigravity / Routh Agent:</b>\n<i>"${instruction}"</i>`);

    // Comandos directos o scripts de la app
    let commandToRun = '';
    const cleanInst = instruction.trim();

    if (cleanInst.startsWith('/cmd ') || cleanInst.startsWith('/run ')) {
        commandToRun = cleanInst.replace(/^\/(cmd|run)\s+/, '');
    } else if (cleanInst.toLowerCase().startsWith('git ')) {
        commandToRun = cleanInst;
    } else if (cleanInst.toLowerCase().includes('compilar') || cleanInst.toLowerCase().includes('build')) {
        commandToRun = 'cd frontend; npm run build';
    } else if (cleanInst.toLowerCase().includes('status') || cleanInst.toLowerCase().includes('estado')) {
        commandToRun = 'git status; node -v';
    } else {
        // Enviar a la IA / agente para análisis y respuesta
        try {
            const aiRouter = require('./aiRouter');
            const aiResponse = await aiRouter.routeAiMessage(
                `Eres el asistente técnico de Antigravity en Colaboratium conectado por Telegram al celular del creador (1136822400). Responde de forma concisa, técnica y accionable:\n\nUsuario solicita: "${instruction}"`,
                [],
                { nombre: 'Colaboratium Admin', codigo: 'KRZMJI' }
            );

            await sendTelegramMessage(chatId, `<b>Respuesta de Antigravity IA:</b>\n\n${aiResponse.content || aiResponse}`);
            return;
        } catch (aiErr) {
            commandToRun = `echo "Instruccion recibida: ${cleanInst.replace(/"/g, '')}"`;
        }
    }

    if (commandToRun) {
        await sendTelegramMessage(chatId, `⚙️ <b>Ejecutando en consola:</b>\n<code>${commandToRun}</code>`);
        const result = await executeShellCommand(commandToRun);

        let reply = `<b>Resultado (${result.duration}s):</b>\n`;
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

    console.log('🚀 [TELEGRAM TUNNEL] Conectado y escuchando mensajes y audios para Antigravity...');
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
                const userName = msg.from.first_name || msg.from.username || 'Celular 1136822400';

                // Caso 1: Mensaje de Voz / Audio
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
                // Caso 2: Mensaje de Texto
                else if (msg.text) {
                    const text = msg.text.trim();

                    if (text === '/start') {
                        await sendTelegramMessage(chatId, `👋 <b>¡Hola! Conexión activa con Antigravity & Routh Agent</b>\n\nPuedes enviarme:\n• <b>Texto:</b> Pidiendo cambios o instrucciones para la app.\n• <b>Audios de voz:</b> Los transcribo con Whisper e inicio la tarea.\n• <b>/cmd &lt;comando&gt;:</b> Ejecuta comandos directos y devuelve la salida de consola.\n\nEcosistema: <code>c:\\Users\\Administrador\\Desktop\\Routh-Agent</code>`);
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
