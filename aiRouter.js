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
 * Limpia cualquier porcentaje escrito, tabla Markdown o negrita doble antes de enviar por WhatsApp.
 */
function sanitizeBotReplyText(text) {
    if (!text || typeof text !== 'string') return text || '';

    // Proteger URLs (pueden contener %20 u otros escapes)
    const urls = [];
    let clean = text.replace(/https?:\/\/[^\s)>"']+/gi, (match) => {
        const idx = urls.length;
        urls.push(match);
        return `__URL_TOKEN_${idx}__`;
    });

    // 1. Quitar paréntesis que mencionen porcentajes (ej: "(3 % inmediato + cuotas)")
    clean = clean.replace(/\s*\([^()\n]*\b\d+[\d.,\s]*%[^()\n]*\)/g, '');

    // 2. Reemplazar expresiones frecuentes con porcentaje por redacción cualitativa sin "%"
    clean = clean
        .replace(/\b0\s*%\s*(?:de\s+)?(?:comisi[oó]n(?:es)?|costo|gastos?)\b/gi, 'sin costo ni comisión')
        .replace(/\b100\s*%\s*(?:de\s+(?:la\s+)?)?comisi[oó]n(?:es)?/gi, 'esquema completo de comisiones')
        .replace(/\bel\s+100\s*%\s*(en|de)\b/gi, 'comisión plena $1')
        .replace(/\b100\s*%\s*(bancarizad[ao]s?|digital(?:es)?|no\s+custodial(?:es)?|gratuit[ao]s?|autogestionad[ao]s?|autom[aá]tic[ao]s?|virtual(?:es)?)/gi, 'totalmente $1')
        .replace(/~?\b\d+(?:[.,]\d+)?\s*%\s*(?:a|al|y|\-|–)\s*\d+(?:[.,]\d+)?\s*%(?:\s*TNA)?/gi, 'condiciones competitivas de mercado')
        .replace(/\b\d+(?:[.,]\d+)?\s*%\s*(?:inmediat[ao]\s*al\s*calce|al\s*calce\s*inmediat[ao]|inmediat[ao]\s*\+\s*cuotas|inmediat[ao]|overriding|adicional|inicial)/gi, 'esquema de alto rendimiento')
        .replace(/\b\d+(?:[.,]\d+)?\s*%/g, '')
        .replace(/\bpor\s+ciento\b/gi, '')
        .replace(/%/g, '');

    // 3. Convertir formato Markdown a WhatsApp (*negrita* y listas sin tablas)
    clean = clean.replace(/\*\*(.+?)\*\*/g, '*$1*');
    const lines = clean.split('\n');
    const formattedLines = [];
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue; // línea separadora de tabla markdown
        if (/^\|.*\|$/.test(trimmed)) {
            const cells = trimmed.slice(1, -1).split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length > 0 && !/^(opci[oó]n|fecha|modalidad)$/i.test(cells[0])) {
                formattedLines.push(`• ${cells.join(' — ')}`);
            }
            continue;
        }
        formattedLines.push(rawLine);
    }
    clean = formattedLines.join('\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([,.;:!?])/g, '$1')
        .replace(/\(\s*\)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Restaurar URLs
    clean = clean.replace(/__URL_TOKEN_(\d+)__/g, (_, idx) => urls[Number(idx)] || '');
    return clean;
}

/**
 * Router Principal Inteligente:
 * Gestiona el envío con cascada de velocidad y failovers automáticos.
 */
async function routeAiMessage(userMessage, history = [], empresaData = {}) {
    const codigoEmpresa = empresaData.codigo || 'KRZMJI';

    // Si quien llama no pasó prompt_ia o conocimiento_ia (ej. WASender), cargarlos desde MySQL para mantener contexto completo
    if ((!empresaData.prompt_ia || !empresaData.conocimiento_ia) && db && db.pool) {
        try {
            const [rows] = await db.pool.query(
                'SELECT nombre, prompt_ia, conocimiento_ia FROM empresas WHERE codigo = ? LIMIT 1',
                [codigoEmpresa]
            );
            if (rows && rows[0]) {
                empresaData = {
                    ...rows[0],
                    ...empresaData,
                    prompt_ia: empresaData.prompt_ia || rows[0].prompt_ia,
                    conocimiento_ia: empresaData.conocimiento_ia || rows[0].conocimiento_ia
                };
            }
        } catch (dbLoadErr) {
            console.warn('⚠️ [AI ROUTER] No se pudo cargar contexto de empresa desde BD:', dbLoadErr.message);
        }
    }

    const basePrompt = empresaData.prompt_ia || 'Eres el Asistente Oficial de Colaboratium.';
    const customPrompt = empresaData.systemPromptOverride
        ? `${basePrompt}\n\n[INSTRUCCIONES DEL CANAL]:\n${empresaData.systemPromptOverride}`
        : basePrompt;
    const customKnowledge = empresaData.conocimiento_ia ? `\nBASE DE CONOCIMIENTO:\n${empresaData.conocimiento_ia}` : '';

    let liveSlotsContext = '';
    try {
        const { getAvailableWebinarSlots } = require('./googleCalendarService');
        const slotsAsesores = await getAvailableWebinarSlots(codigoEmpresa, 'asesores');
        const slotsLideres = await getAvailableWebinarSlots(codigoEmpresa, 'lideres');
        
        const formatSlots = (slots) => (slots && slots.length > 0)
            ? slots.map(s => `• Opción ${s.id}: ${s.titulo} - ${s.fechaStr} a las ${s.horarioStr} (${s.modalidad}${s.modalidad === 'VIRTUAL' && s.meetLink ? ' - Meet: ' + s.meetLink : ''})`).join('\n')
            : 'Sin eventos programados actualmente.';
            
        liveSlotsContext = `\n\n[CALENDARIO OFICIAL EN VIVO DE WEBINARS Y REUNIONES]:
OPCIONES ASESORES COMERCIALES:
${formatSlots(slotsAsesores)}

OPCIONES LÍDERES DE EQUIPO:
${formatSlots(slotsLideres)}

REGLAS ESTRICTAS DE FECHAS (PROHIBICIÓN ABSOLUTA DE ALUCINAR):
- PROHIBIDO INVENTAR FECHAS O DÍAS FICTICIOS (como "Lunes 4 de noviembre" u otros). Ofrece o confirma ÚNICAMENTE las opciones del calendario oficial anterior.
- NO OFREZCAS REUNIONES PRESENCIALES si no figuran expresamente en el listado activo; actualmente todas las capacitaciones y webinars programados son 100% VIRTUALES por Google Meet.
- Si el usuario dice "1" o "slot_1" o una opción, confirma la fecha EXACTA que figura en el listado anterior.
- Si el usuario pregunta por capacitaciones o webinars, ofrécele las opciones disponibles y pídele: número de opción elegida, su Nombre Completo y su Correo Electrónico para agendarlo formalmente y enviarle el enlace de acceso por email.
- Si el usuario ya dio su elección y su email, confirma la opción oficial elegida indicándole que recibirá la invitación a su correo.`;
    } catch (e) {
        console.warn('Error inyectando slots de calendario en aiRouter:', e.message);
    }

    const messages = [
        {
            role: 'system',
            content: `${customPrompt}${customKnowledge}${liveSlotsContext}

REGLAS DE DERIVACIÓN Y RESPUESTA OBLIGATORIA:
1. Si no puedes resolver la consulta o el usuario requiere atención humana, incluye [HANDOFF].
2. OBLIGATORIO: Finaliza tu mensaje con una única etiqueta de rol: [ROLE:Asesores], [ROLE:Inversores], [ROLE:Lideres] o [ROLE:Soporte] (o [ROLE:General] si es saludo).
3. CONSULTAS DE ASESORES COMERCIALES (REGLA FUNDAMENTAL):
   • La MAYORÍA de las consultas de los asesores (sobre clientes inversores, comisiones, producción de equipo, precargas o dudas comerciales) DEBEN derivarse a su Líder Comercial con [ROLE:Lideres] y [HANDOFF].
   • Solo si es un problema técnico específico (olvido de contraseña, error en la plataforma, falla del sistema) se deriva a [ROLE:Soporte].
   • Solo trámites formales de alta o constancia de CBU institucional van a [ROLE:Administracion].
4. PROHIBIDO TABLAS MARKDOWN: NUNCA utilices tablas de markdown (| col1 | col2 |) porque WhatsApp no las soporta y se muestran como texto roto e ilegible. Si presentas horarios o comparativas, usa viñetas (•), negritas (*) y saltos de línea claros y limpios.
5. Cuando el usuario pregunte por horarios o capacitaciones, dale las opciones numeradas del CALENDARIO OFICIAL de forma clara y amigable invitándolo a responder con el número de opción y su email. NUNCA inventes fechas.
6. APP PRINCIPAL Y ACCESO (REGLA OBLIGATORIA): La aplicación y plataforma principal oficial de Colaboratium es *https://colaboratium.com.ar/*. SIEMPRE que cualquier persona pregunte cómo acceder, ingresar, registrarse, abrir la cuenta o pida el enlace/link de la app o plataforma, debes enviarla directamente a *https://colaboratium.com.ar/* (es una aplicación web; NO menciones descargas de App Store/Google Play ni el dominio obsoleto consola.colaboratium.com.ar ni "wallet interno"). Si pide el enlace inmediatamente después de hablar de la app, dale *https://colaboratium.com.ar/*, NO le envíes links de webinars salvo que haya preguntado explícitamente por capacitación o reunión.
7. PROHIBICIÓN ABSOLUTA DE PORCENTAJES (% POR ESCRITO): NUNCA incluyas el símbolo "%" ni la palabra "por ciento" ni cifras numéricas porcentuales sobre comisiones (ni "3%", "4%", "5%", "6%", "10%", "100%"), overriding ni tasas en tus mensajes escritos. Habla únicamente de forma cualitativa ("Comisiones de alto rendimiento con cobro al calce, residual en cuotas y reinversiones", "comisión plena en clientes propios y reinversiones", "overriding adicional de equipo", "sin costo ni comisión para el inversor", "totalmente bancarizado y No Custodial", "filtro estricto de IA", "tasas variables de mercado en tiempo real en https://colaboratium.com.ar/inversiones.php#simulador"). Toda escala numérica se explica en vivo en el Webinar o reunión presencial.`
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
        return sanitizeBotReplyText(result.text);
    }

    // 2. Probar Cerebras Cloud (Prioridad 2)
    console.log(`⏩ [AI ROUTER] Falló Groq, derivando a Cerebras Cloud...`);
    result = await callCerebras(messages, 'llama3.1-8b', codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return sanitizeBotReplyText(result.text);
    }

    // 3. Probar Gemini 1.5 Flash (Prioridad 3)
    console.log(`⏩ [AI ROUTER] Intentando con Google Gemini...`);
    result = await callGemini(messages, codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return sanitizeBotReplyText(result.text);
    }

    // 4. Probar OpenRouter (Prioridad 4)
    console.log(`⏩ [AI ROUTER] Intentando con OpenRouter Cloud...`);
    result = await callOpenRouter(messages, 'meta-llama/llama-3.1-8b-instruct', codigoEmpresa);
    if (result) {
        console.log(`⚡ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return sanitizeBotReplyText(result.text);
    }

    // 5. Fallback a Ollama Local (Desbordes / Servidor Local)
    console.log(`🏠 [AI ROUTER] Conmutando a Ollama Local para desborde...`);
    result = await callOllama(messages, OLLAMA_MODEL, codigoEmpresa);
    if (result) {
        console.log(`✅ [AI ROUTER] Respondido por: ${result.model} (${result.tokens} tokens)`);
        return sanitizeBotReplyText(result.text);
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
    sanitizeBotReplyText,
    callGroq,
    callCerebras,
    callGemini,
    callOpenRouter,
    callOllama
};
