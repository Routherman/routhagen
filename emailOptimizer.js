/**
 * EMAIL OPTIMIZER & DISPATCH ENGINE
 * Metodología Combinada:
 * 1. robindarlington/mail-merge: Validación previa de variables, missing field alerts, per-row attachments & single-address test gate.
 * 2. ranaroussi/minigun: Resiliencia ante caídas, auto-reanudación por puntero persistente y gestión de desuscripciones.
 * 3. chunkydotdev/email-skills: Diagnóstico de entregabilidad anti-spam, verificación de directrices Gmail 2024 y optimización de inbox.
 */

const SPAM_WORDS = [
    'urgente', 'gana dinero', '100% gratis', 'hazte rico', 'ganador', 'premio',
    'ingresos pasivos', 'sin riesgo', 'comisiones ya', 'oferta limitada', 'compra ya',
    'actua ahora', 'sin costo alguno', 'duplica tu dinero', 'inversion milagrosa'
];

/**
 * 1. Analizador de Entregabilidad Anti-Spam (chunkydotdev/email-skills)
 */
function analyzeDeliverability({ subject = '', htmlContent = '', fromEmail = 'colaboratium@gmail.com' }) {
    let score = 100;
    const warnings = [];
    const suggestions = [];
    const lowerSubject = (subject || '').toLowerCase();
    const lowerHtml = (htmlContent || '').toLowerCase();

    // Regla 1: Asunto en mayúsculas sostenidas
    if (subject.length > 5 && subject === subject.toUpperCase()) {
        score -= 20;
        warnings.push('El asunto está escrito completamente en MAYÚSCULAS.');
        suggestions.push('Usa mayúsculas solo al inicio de oraciones o nombres propios.');
    }

    // Regla 2: Exclamaciones o signos repetidos en asunto
    if (/!{2,}|\?{2,}|\${2,}/.test(subject)) {
        score -= 15;
        warnings.push('El asunto contiene múltiples signos de exclamación o interrogación consecutivos.');
        suggestions.push('Usa como máximo un signo de exclamación en el asunto.');
    }

    // Regla 3: Palabras consideradas 'Spam Triggers'
    const foundSpamWords = [];
    SPAM_WORDS.forEach(word => {
        if (lowerSubject.includes(word) || lowerHtml.includes(word)) {
            foundSpamWords.push(word);
        }
    });

    if (foundSpamWords.length > 0) {
        score -= (foundSpamWords.length * 8);
        warnings.push(`Se detectaron palabras sensibles a filtros de spam: ${foundSpamWords.join(', ')}`);
        suggestions.push('Reemplaza estas expresiones por términos profesionales e institucionales.');
    }

    // Regla 4: Presencia de enlace de desuscripción (Obligatorio Gmail 2024 / CAN-SPAM)
    const hasUnsubscribe = lowerHtml.includes('desuscrib') || lowerHtml.includes('baja') || lowerHtml.includes('enlacebaja');
    if (!hasUnsubscribe) {
        score -= 30;
        warnings.push('Falta enlace o botón de desuscripción visible en el pie del correo.');
        suggestions.push('Incluye la variable {{EnlaceBaja}} o un enlace directo para darse de baja.');
    }

    // Regla 5: Presencia de dirección física / razón social legal (CAN-SPAM)
    const hasLegalAddress = lowerHtml.includes('vicente lópez') || lowerHtml.includes('libertador') || lowerHtml.includes('bcra');
    if (!hasLegalAddress) {
        score -= 10;
        warnings.push('No se detectó dirección física o personería jurídica visible en el correo.');
        suggestions.push('Asegúrate de incluir la sede de Colaboratium (Av. del Libertador 264, Vicente López).');
    }

    // Regla 6: Ratio Texto / HTML
    const textOnly = htmlContent.replace(/<[^>]*>?/gm, '').trim();
    if (htmlContent.length > 100 && textOnly.length < 50) {
        score -= 15;
        warnings.push('El correo contiene mucho código HTML en comparación con el texto legible.');
        suggestions.push('Añade párrafos de texto claros para equilibrar el ratio texto/HTML.');
    }

    score = Math.max(10, Math.min(100, score));

    let status = 'excelente';
    if (score < 70) status = 'critico';
    else if (score < 85) status = 'moderado';

    return {
        score,
        status, // 'excelente' (85-100), 'moderado' (70-84), 'critico' (<70)
        warnings,
        suggestions,
        canSpamCompliant: hasUnsubscribe && hasLegalAddress
    };
}

/**
 * 2. Validador previo de variables y campos vacíos (robindarlington/mail-merge)
 */
function validateMergeVariables(templateText, contacts = []) {
    // Detectar todas las variables {{variable}} en el template
    const regex = /\{\{([a-zA-Z0-9_-]+)\}\}/g;
    const foundVars = new Set();
    let match;
    while ((match = regex.exec(templateText)) !== null) {
        foundVars.add(match[1]);
    }

    const totalContacts = contacts.length;
    let missingNames = 0;
    let invalidEmails = 0;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    contacts.forEach(c => {
        if (!c.nombre || c.nombre.trim() === '' || c.nombre.toLowerCase().includes('prospecto')) {
            missingNames++;
        }
        if (!c.email || !emailRegex.test(c.email.trim())) {
            invalidEmails++;
        }
    });

    return {
        detectedVariables: Array.from(foundVars),
        totalContacts,
        validEmails: totalContacts - invalidEmails,
        invalidEmails,
        missingNames,
        samplePreview: contacts.length > 0 ? {
            contact: contacts[0].nombre || 'Estimado/a',
            email: contacts[0].email
        } : null
    };
}

module.exports = {
    analyzeDeliverability,
    validateMergeVariables,
    SPAM_WORDS
};
