const axios = require('axios');
const Groq = require('groq-sdk');
const db = require('./database');
require('dotenv').config();

// Configuración de API Keys desde variables de entorno
const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_TOKEN || '';
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b-instruct-q4_K_M';

const groq = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null;

/**
 * 1. Groq Cloud (Prioridad 1 - Ultra Rápido)
 */
async function callGroq(messages, model = 'openai/gpt-oss-120b', codigoEmpresa = 'KRZMJI') {
    if (!groq) return null;
    try {
        const safeMessages = messages.map(m => {
            let content = m.content || '';
            if (m.role === 'system' && content.length > 12000) {
                content = content.substring(0, 12000) + '\n\n[... Base de conocimiento recortada para agilidad ...]';
            }
            return { role: m.role, content };
        });

        const chatCompletion = await groq.chat.completions.create({
            messages: safeMessages,
            model: model,
            temperature: 0.7,
            max_tokens: 1024
        });

        const text = chatCompletion.choices[0]?.message?.content || '';
        const tokens = chatCompletion.usage?.total_tokens || Math.round((JSON.stringify(messages).length + text.length) / 4);

        if (text) {
            await db.actualizarAiStat(codigoEmpresa, `Groq (${model})`, tokens, 1, 0);
            return { text, model: `Groq (${model})`, tokens };
        }
    } catch (err) {
        console.warn(`⚠️ [AI ROUTER - GROQ ERROR]: ${err.message}`);
        await db.actualizarAiStat(codigoEmpresa, `Groq (${model})`, 0, 0, 1);
    }
    return null;
}

/**
 * 2. Cerebras Cloud (Prioridad 2 - Ultra Baja Latencia)
 */
async function callCerebras(messages, model = 'llama3.1-8b', codigoEmpresa = 'KRZMJI') {
    if (!CEREBRAS_KEY) return null;
    try {
        const response = await axios.post('https://api.cerebras.ai/v1/chat/completions', {
            model: model,
            messages: messages,
            temperature: 0.6,
            max_tokens: 1024
        }, {
            headers: {
                'Authorization': `Bearer ${CEREBRAS_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 12000
        });

        const text = response.data.choices[0]?.message?.content || '';
        const tokens = response.data.usage?.total_tokens || Math.round((JSON.stringify(messages).length + text.length) / 4);

        if (text) {
            await db.actualizarAiStat(codigoEmpresa, `Cerebras (${model})`, tokens, 1, 0);
            return { text, model: `Cerebras (${model})`, tokens };
        }
    } catch (err) {
        console.warn(`⚠️ [AI ROUTER - CEREBRAS ERROR]: ${err.message}`);
        await db.actualizarAiStat(codigoEmpresa, `Cerebras (${model})`, 0, 0, 1);
    }
    return null;
}

/**
 * 3. Google Gemini 1.5 Flash (Prioridad 3 - Multimodal / Contexto Amplio)
 */
async function callGemini(messages, codigoEmpresa = 'KRZMJI') {
    if (!GEMINI_KEY) return null;
    try {
        const promptText = messages.map(m => `${(m.role || 'user').toUpperCase()}: ${m.content}`).join('\n\n');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
        
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: promptText }] }]
        }, { timeout: 15000 });

        const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const tokens = Math.round((promptText.length + text.length) / 4);

        if (text) {
            await db.actualizarAiStat(codigoEmpresa, 'Gemini 1.5 Flash', tokens, 1, 0);
            return { text, model: 'Gemini 1.5 Flash', tokens };
        }
    } catch (err) {
        console.warn(`⚠️ [AI ROUTER - GEMINI ERROR]: ${err.message}`);
        await db.actualizarAiStat(codigoEmpresa, 'Gemini 1.5 Flash', 0, 0, 1);
    }
    return null;
}

/**
 * 4. OpenRouter (Prioridad 4 - Modelos Open Source en la Nube)
 */
async function callOpenRouter(messages, model = 'meta-llama/llama-3.1-8b-instruct', codigoEmpresa = 'KRZMJI') {
    if (!OPENROUTER_KEY) return null;
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: model,
            messages: messages,
            temperature: 0.6,
            max_tokens: 1024
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const text = response.data.choices?.[0]?.message?.content || '';
        const tokens = response.data.usage?.total_tokens || Math.round((JSON.stringify(messages).length + text.length) / 4);

        if (text) {
            await db.actualizarAiStat(codigoEmpresa, `OpenRouter (${model})`, tokens, 1, 0);
            return { text, model: `OpenRouter (${model})`, tokens };
        }
    } catch (err) {
        console.warn(`⚠️ [AI ROUTER - OPENROUTER ERROR]: ${err.message}`);
        await db.actualizarAiStat(codigoEmpresa, `OpenRouter (${model})`, 0, 0, 1);
    }
    return null;
}

/**
 * 5. Ollama Local (Prioridad 5 - Desbordes e Inferencia In-House)
 */
async function callOllama(messages, model = OLLAMA_MODEL, codigoEmpresa = 'KRZMJI') {
    try {
        const cleanBase = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '').replace(/\/api\/?$/, '');
        const url = `${cleanBase}/api/chat`;

        const response = await axios.post(url, {
            model: model,
            messages: messages,
            stream: false,
            options: { temperature: 0.7, num_ctx: 8192 }
        }, { timeout: 60000 });

        const text = response.data.message?.content || '';
        const evalToks = (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0);
        const tokens = evalToks > 0 ? evalToks : Math.round((JSON.stringify(messages).length + text.length) / 4);

        if (text) {
            await db.actualizarAiStat(codigoEmpresa, `Ollama Local (${model})`, tokens, 1, 0);
            return { text, model: `Ollama Local (${model})`, tokens };
        }
    } catch (err) {
        console.warn(`⚠️ [AI ROUTER - OLLAMA LOCAL ERROR]: ${err.message}`);
        await db.actualizarAiStat(codigoEmpresa, `Ollama Local (${model})`, 0, 0, 1);
    }
    return null;
}

/**
 * Router Principal Inteligente:
 * Gestiona el envío con cascada de velocidad y failovers automáticos.
 */
async function routeAiMessage(userMessage, history = [], empresaData = {}) {
    const codigoEmpresa = empresaData.codigo || 'KRZMJI';
    const customPrompt = empresaData.prompt_ia || 'Eres el Asistente Oficial de Colaboratium.';
    const customKnowledge = empresaData.conocimiento_ia ? `\nBASE DE CONOCIMIENTO:\n${empresaData.conocimiento_ia}` : '';

    const messages = [
        {
            role: 'system',
            content: `${customPrompt}${customKnowledge}

REGLAS DE DERIVACIÓN Y RESPUESTA OBLIGATORIA:
1. Si no puedes resolver la consulta o el usuario requiere atención humana, incluye [HANDOFF].
2. OBLIGATORIO: Finaliza tu mensaje con una única etiqueta de rol: [ROLE:Asesores], [ROLE:Inversores], [ROLE:Lideres] o [ROLE:Soporte] (o [ROLE:General] si es saludo).
3. PROHIBIDO TABLAS MARKDOWN: NUNCA utilices tablas de markdown (| col1 | col2 |) porque WhatsApp no las soporta y se muestran como texto roto e ilegible. Si presentas horarios o comparativas, usa viñetas (•), negritas (*) y saltos de línea claros y limpios.
4. Cuando el usuario pregunte por horarios o capacitaciones, dale las opciones numeradas de forma clara y amigable invitándolo a responder con el número de opción y su email.`
        }
    ];

    for (const msg of history) {
        messages.push({
            role: msg.direccion === 'ENTRANTE' ? 'user' : 'assistant',
            content: msg.contenido
        });
    }

    messages.push({
        role: 'user',
        content: `${userMessage}\n\n[INSTRUCCIÓN INTERNA]: Finaliza con la etiqueta de rol asignado [ROLE:nombre_del_rol] y [HANDOFF] si corresponde.`
    });

    console.log(`\n🔀 [AI ROUTER] Enrutando mensaje entrante para empresa ${codigoEmpresa}...`);

    // 1. Probar Groq Cloud (Prioridad 1)
    let result = await callGroq(messages, 'openai/gpt-oss-120b', codigoEmpresa);
    if (!result) result = await callGroq(messages, 'openai/gpt-oss-20b', codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return result.text;
    }

    // 2. Probar Cerebras Cloud (Prioridad 2)
    console.log(`⏩ [AI ROUTER] Falló Groq, derivando a Cerebras Cloud...`);
    result = await callCerebras(messages, 'llama3.1-8b', codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return result.text;
    }

    // 3. Probar Gemini 1.5 Flash (Prioridad 3)
    console.log(`⏩ [AI ROUTER] Intentando con Google Gemini...`);
    result = await callGemini(messages, codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return result.text;
    }

    // 4. Probar OpenRouter (Prioridad 4)
    console.log(`⏩ [AI ROUTER] Intentando con OpenRouter Cloud...`);
    result = await callOpenRouter(messages, 'meta-llama/llama-3.1-8b-instruct', codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return result.text;
    }

    // 5. Fallback a Ollama Local (Desbordes / Servidor Local)
    console.log(`🏠 [AI ROUTER] Conmutando a Ollama Local para desborde...`);
    result = await callOllama(messages, OLLAMA_MODEL, codigoEmpresa);
    if (result) {
        console.log(`✅ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return result.text;
    }

    // Fallback de contingencia si todos están caídos
    return '¡Hola! En este momento nuestros canales automáticos están con alta demanda. Un asesor de nuestro equipo se contactará contigo en breve. [HANDOFF]';
}

/**
 * Resumen automático de conversaciones para la creación y gestión de tickets
 */
async function summarizeConversationWithAI(chatHistoryText, codigoEmpresa = 'KRZMJI') {
    const prompt = [
        {
            role: 'system',
            content: 'Eres un analista de soporte y operaciones. Analiza el siguiente historial de chat de WhatsApp y genera un RESUMEN EJECUTIVO de exactamente 2 a 3 líneas con: 1) Nombre o datos detectados del cliente, 2) Qué servicio o perfil consulta (Asesor, Inversor, Líder o Consulta Técnica) y 3) Qué acción o derivación se requiere. Sé directo, sin rodeos.'
        },
        {
            role: 'user',
            content: `HISTORIAL DEL CHAT:\n${chatHistoryText}`
        }
    ];

    // Usar Groq o Cerebras para máxima velocidad
    let res = await callGroq(prompt, 'openai/gpt-oss-120b', codigoEmpresa);
    if (!res) res = await callCerebras(prompt, 'llama3.1-8b', codigoEmpresa);
    if (!res) res = await callOpenRouter(prompt, 'meta-llama/llama-3.1-8b-instruct', codigoEmpresa);
    if (!res) res = await callOllama(prompt, OLLAMA_MODEL, codigoEmpresa);

    return res?.text || 'Consulta general en curso sin resolución automática. Requiere seguimiento de operador.';
}

module.exports = {
    routeAiMessage,
    summarizeConversationWithAI,
    callGroq,
    callCerebras,
    callGemini,
    callOpenRouter,
    callOllama
};
