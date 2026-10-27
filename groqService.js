const Groq = require('groq-sdk');
const axios = require('axios');
require('dotenv').config();

// Inicializamos el cliente de Groq
const groq = new Groq({
    apiKey: process.env.GROQ_TOKEN
});

// Configuración de proveedores de IA
const AI_PROVIDER = (process.env.AI_PROVIDER || 'ollama').toLowerCase(); // 'ollama' como primera IA o 'groq'
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b-instruct-q4_K_M';

/**
 * Consulta a Ollama Local usando su endpoint compatible con OpenAI
 */
async function queryOllama(messages, model = OLLAMA_MODEL, temperature = 0.7) {
    const url = `${OLLAMA_BASE_URL.replace(/\/$/, '')}/chat/completions`;
    const response = await axios.post(url, {
        model,
        messages,
        temperature
    }, {
        timeout: 75000 // 75 segundos para holgura de inferencia en CPU
    });
    return response.data.choices[0]?.message?.content || '';
}

/**
 * Consulta a Groq Nube
 */
async function queryGroq(messages, model = 'openai/gpt-oss-20b', temperature = 0.7) {
    const chatCompletion = await groq.chat.completions.create({
        messages,
        model,
        temperature
    });
    return chatCompletion.choices[0]?.message?.content || '';
}

const aiRouter = require('./aiRouter');

/**
 * Función principal para analizar el mensaje con IA.
 * Utiliza el Router Multi-IA de alta velocidad con cascada (Groq -> Cerebras -> Gemini -> OpenRouter -> Ollama)
 * y telemetría de tokens y costos en USD.
 */
async function processMessageWithAI(userMessage, history = [], empresaData = {}) {
    try {
        return await aiRouter.routeAiMessage(userMessage, history, empresaData);
    } catch (error) {
        console.error('❌ Error general en servicio de IA Router:', error);
        return 'Lo siento, en este momento no puedo procesar tu solicitud.';
    }
}

/**
 * Función para generar un resumen detallado de un documento grande
 */
async function summarizeDocument(text) {
    const messages = [
        {
            role: 'system',
            content: 'Eres un analista de datos. Tu tarea es extraer toda la información relevante, datos, procesos y conocimiento del siguiente documento y resumirlo en un formato claro, estructurado y altamente editable (Markdown). Este resumen se usará luego como "Base de conocimiento" para un bot de atención al cliente. Omite saludos y explicaciones, devuelve únicamente el resumen.'
        },
        {
            role: 'user',
            content: `DOCUMENTO:\n${text}`
        }
    ];

    // Intentar primero con Groq (para documentos grandes gpt-oss-120b es más rápido) o Ollama
    try {
        return await queryGroq(messages, 'openai/gpt-oss-120b', 0.2);
    } catch (err) {
        console.warn('⚠️ Falló Groq para resumen, intentando con Ollama Local:', err.message);
        try {
            return await queryOllama(messages, 'llama3.1:8b', 0.2);
        } catch (ollamaErr) {
            console.error('❌ Error en summarizeDocument:', ollamaErr.message);
            throw ollamaErr;
        }
    }
}

const fs = require('fs');

/**
 * Transcribe notas de voz y audios de WhatsApp usando Groq Whisper LPU
 */
async function transcribeAudioWithGroq(filePath, language = 'es') {
    try {
        if (!fs.existsSync(filePath)) {
            console.error('❌ Archivo de audio no encontrado para transcribir:', filePath);
            return '';
        }
        const fileStream = fs.createReadStream(filePath);
        const transcription = await groq.audio.transcriptions.create({
            file: fileStream,
            model: 'whisper-large-v3',
            language: language,
            response_format: 'text'
        });
        const text = typeof transcription === 'string' ? transcription : (transcription?.text || '');
        console.log(`🎙️ [WHISPER GROQ] Audio transcribido con éxito: "${text.trim()}"`);
        return text.trim();
    } catch (error) {
        console.error('❌ Error transcribiendo audio con Groq Whisper:', error.message);
        return '';
    }
}

module.exports = {
    processMessageWithAI,
    summarizeDocument,
    queryOllama,
    queryGroq,
    transcribeAudioWithGroq
};
