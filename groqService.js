const Groq = require('groq-sdk');

// Inicializamos el cliente de Groq con el token que está en .env
const groq = new Groq({
    apiKey: process.env.GROQ_TOKEN
});

/**
 * Función principal para analizar el mensaje con IA, usando memoria del chat.
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

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: 'openai/gpt-oss-20b',
            temperature: 0.7,
        });

        return chatCompletion.choices[0]?.message?.content || 'No pude generar una respuesta.';
    } catch (error) {
        console.error('❌ Error consultando a Groq:', error);
        return 'Lo siento, en este momento nuestros sistemas de IA están saturados.';
    }
}

/**
 * Función para generar un resumen detallado de un documento grande
 */
async function summarizeDocument(text) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'Eres un analista de datos. Tu tarea es extraer toda la información relevante, datos, procesos y conocimiento del siguiente documento y resumirlo en un formato claro, estructurado y altamente editable (Markdown). Este resumen se usará luego como "Base de conocimiento" para un bot de atención al cliente. Omite saludos y explicaciones, devuelve únicamente el resumen.'
                },
                {
                    role: 'user',
                    content: `DOCUMENTO:\n${text}`
                }
            ],
            model: 'openai/gpt-oss-120b',
            temperature: 0.2,
        });

        return chatCompletion.choices[0]?.message?.content || '';
    } catch (error) {
        console.error('❌ Error en summarizeDocument:', error);
        throw error;
    }
}

module.exports = {
    processMessageWithAI,
    summarizeDocument
};
