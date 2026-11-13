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

/**
 * Genera un resumen ejecutivo estructurado con IA de una reunión de Google Meet con Inversor
 */
async function summarizeMeeting({ transcript, notes = '', clientName = 'Inversor', meetingTitle = 'Reunión Meet de Inversión', advisorName = 'Asesor Colaboratium' }) {
    const systemPrompt = `Eres el Analista Financiero Senior de IA de Colaboratium (BCRA Nº 40.015).
Tu labor es procesar la transcripción o notas de una videollamada de Google Meet entre un Asesor/Líder y un Inversor y generar un Resumen Ejecutivo estructurado para archivo en base de datos y auditoría de cartera.

Debes responder ÚNICAMENTE en formato JSON con la siguiente estructura exacta:
{
  "resumen_ejecutivo": "Síntesis clara de 2-3 párrafos sobre la reunión, el interés demostrado y los temas discutidos.",
  "perfil_inversor": "Perfil de riesgo (conservador/moderado/agresivo), experiencia previa en inversiones, rubro o actividad principal.",
  "capital_plazo": "Monto estimado o declarado a invertir (en ARS o USD), horizonte temporal, modalidad (cuotas, fondo común, tasa fija).",
  "acuerdos": [
    "Acuerdo 1...",
    "Acuerdo 2..."
  ],
  "proximos_pasos": [
    "Próximo paso 1 con responsable...",
    "Próximo paso 2..."
  ],
  "estado_interes": "ALTO",
  "markdown_formateado": "# Resumen de Reunión..."
}
No agregues texto explicativo antes ni después del JSON.`;

    const userPrompt = `DATOS DE LA REUNIÓN:
- Título: ${meetingTitle}
- Asesor / Convocante: ${advisorName}
- Inversor / Cliente: ${clientName}
- Notas adicionales: ${notes || 'Ninguna provista'}

TRANSCRIPCIÓN O APUNTES DE LA SESIÓN MEET:
${transcript || notes || 'Reunión ejecutiva sobre portafolio de inversión y rendimientos Colaboratium.'}
`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];

    try {
        let rawResponse = '';
        try {
            rawResponse = await queryGroq(messages, 'openai/gpt-oss-120b', 0.2);
        } catch(gErr) {
            console.warn('Fallo gpt-oss-120b, intentando llama3.1-8b fallback:', gErr.message);
            rawResponse = await queryGroq(messages, 'llama-3.1-8b-instant', 0.2);
        }

        let parsed = null;
        try {
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch(e) {}

        if (!parsed) {
            parsed = {
                resumen_ejecutivo: rawResponse.slice(0, 500),
                perfil_inversor: 'Interés en rendimiento y opciones de colocación.',
                capital_plazo: 'A definir en seguimiento.',
                acuerdos: ['Envío de propuesta formal'],
                proximos_pasos: ['Enviar detalle de comisiones y calce'],
                estado_interes: 'ALTO',
                markdown_formateado: rawResponse
            };
        }

        return parsed;
    } catch(err) {
        console.error('Error generando resumen de reunión con IA:', err.message);
        return {
            resumen_ejecutivo: 'Reunión de inversión realizada con el cliente.',
            perfil_inversor: 'Pendiente de evaluación detallada.',
            capital_plazo: 'A definir.',
            acuerdos: ['Coordinar nueva llamada'],
            proximos_pasos: ['Enviar información por WhatsApp/Email'],
            estado_interes: 'MEDIO',
            markdown_formateado: `### Resumen de Reunión: ${meetingTitle}\n- Cliente: ${clientName}\n- Notas: ${notes || 'Sesión Meet completada.'}`
        };
    }
}

module.exports = {
    processMessageWithAI,
    summarizeDocument,
    queryOllama,
    queryGroq,
    transcribeAudioWithGroq,
    summarizeMeeting
};
