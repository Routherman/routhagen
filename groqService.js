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
        timeout: 45000 // 45 segundos para holgura de inferencia en CPU
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

/**
 * Función principal para analizar el mensaje con IA, usando memoria del chat.
 * Implementa Ollama local como primera opción con fallback transparente a Groq.
 */
async function processMessageWithAI(userMessage, history = [], empresaData = {}) {
    try {
        const customPrompt = empresaData.prompt_ia || 'Eres un asistente útil y amable.';
        const customKnowledge = empresaData.conocimiento_ia ? `\nBASE DE CONOCIMIENTO (Usa esta información para responder si aplica):\n${empresaData.conocimiento_ia}` : '';

        // Armamos el arreglo de mensajes para la IA
        const messages = [
            {
                role: 'system',
                content: `${customPrompt}${customKnowledge}
                
REGLA CRÍTICA DE SISTEMA: 
1. Si no puedes ayudar al usuario con su consulta (ya sea porque escapa a tu base de conocimiento, porque el administrador te dio instrucciones de rechazar ese tema, o porque el usuario pide un humano), DEBES incluir obligatoriamente la etiqueta [HANDOFF] en tu respuesta. Puedes agregar el texto de rechazo que el administrador te haya configurado, pero SIEMPRE debes incluir [HANDOFF] para que el sistema pueda pausar el bot. Ejemplo: "No puedo ayudarte con eso [HANDOFF]".
2. OBLIGATORIO: Al final de tu respuesta, DEBES asignar el chat a un rol agregando EXACTAMENTE UNA etiqueta con el formato [ROLE:nombre_del_rol]. Usa el rol que más se acerque a la intención del usuario. Si es una consulta general sin intención específica, usa [ROLE:General]. Tu respuesta no será válida si no incluye esta etiqueta.`
            }
        ];

        // Añadimos el historial previo
        for (const msg of history) {
            messages.push({
                role: msg.direccion === 'ENTRANTE' ? 'user' : 'assistant',
                content: msg.contenido
            });
        }

        // Añadimos el mensaje actual
        messages.push({
            role: 'user',
            content: `${userMessage}\n\n[INSTRUCCIÓN INTERNA AL MODELO]: Recuerda que es OBLIGATORIO añadir al final de tu respuesta una etiqueta con el formato [ROLE:nombre_del_rol] para derivar el chat (por ejemplo [ROLE:Soporte], [ROLE:Ventas], etc. o [ROLE:General] si no corresponde). Si debes derivar a un humano, añade también [HANDOFF].`
        });

        // 1. SI OLLAMA ES LA PRIMERA IA (Predeterminado)
        if (AI_PROVIDER === 'ollama') {
            try {
                console.log(`🦙 [OLLAMA LOCAL] Procesando mensaje con modelo '${OLLAMA_MODEL}'...`);
                const reply = await queryOllama(messages, OLLAMA_MODEL, 0.7);
                if (reply && reply.trim()) {
                    console.log(`✅ [OLLAMA LOCAL] Respuesta generada exitosamente por Ollama.`);
                    return reply;
                }
            } catch (ollamaErr) {
                console.warn(`⚠️ [OLLAMA LOCAL] Falló o no responde (${ollamaErr.message}). Conmutando automáticamente a Groq...`);
            }

            // Fallback a Groq en caso de que Ollama esté cerrado o demore
            try {
                console.log(`☁️ [GROQ NUBE] Procesando respuesta como respaldo...`);
                return await queryGroq(messages, 'openai/gpt-oss-20b', 0.7);
            } catch (groqErr) {
                console.error(`❌ [GROQ NUBE] Error en respaldo de Groq:`, groqErr.message);
                return 'Lo siento, en este momento nuestros sistemas de atención automática están ocupados.';
            }
        } 
        // 2. SI GROQ ES LA PRIMERA IA
        else {
            try {
                console.log(`☁️ [GROQ NUBE] Procesando mensaje con Groq...`);
                return await queryGroq(messages, 'openai/gpt-oss-20b', 0.7);
            } catch (groqErr) {
                console.warn(`⚠️ [GROQ NUBE] Error (${groqErr.message}). Conmutando a Ollama Local...`);
                try {
                    return await queryOllama(messages, OLLAMA_MODEL, 0.7);
                } catch (ollamaErr) {
                    console.error(`❌ [OLLAMA LOCAL] Falló también Ollama:`, ollamaErr.message);
                    return 'Lo siento, en este momento nuestros sistemas de atención automática están ocupados.';
                }
            }
        }
    } catch (error) {
        console.error('❌ Error general en servicio de IA:', error);
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

module.exports = {
    processMessageWithAI,
    summarizeDocument,
    queryOllama,
    queryGroq
};
