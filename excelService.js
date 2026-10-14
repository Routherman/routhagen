const xlsx = require('xlsx');
const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
    apiKey: process.env.GROQ_TOKEN
});

/**
 * Valida si un número cumple con el estándar E.164 exigido por WhatsApp Cloud API.
 */
function isValidWhatsAppFormat(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const clean = phone.replace(/\D/g, '');
    
    // Para Argentina (549), el formato oficial es:
    // 54 (país) + 9 (móvil) + 10 dígitos (área + local) = 13 dígitos numéricos exactos
    if (clean.startsWith('549')) {
        return clean.length === 13;
    }
    
    // Un número no puede empezar con 11 o 15 directo sin código de país
    if (clean.startsWith('11') || clean.startsWith('15')) {
        return false;
    }
    
    // Para números internacionales en general: entre 10 y 15 dígitos
    return clean.length >= 10 && clean.length <= 15;
}

/**
 * Normaliza y sanitiza números de teléfono para WhatsApp Cloud API.
 * Elimina espacios, guiones, ceros iniciales, "15" local y antepone el código de país (549).
 */
function normalizePhoneNumber(rawNumber, defaultCountryCode = '549') {
    if (!rawNumber) return null;
    
    // Convertir a string y quitar cualquier carácter no numérico
    let clean = String(rawNumber).trim().replace(/\D/g, '');
    if (!clean) return null;
    
    // Si empieza con 00 (código internacional europeo), quitarlo
    if (clean.startsWith('00')) {
        clean = clean.slice(2);
    }
    
    // Quitar ceros a la izquierda (ej: 011 -> 11, 0351 -> 351)
    clean = clean.replace(/^0+/, '');

    // Quitar el prefijo local "15" si está presente:
    // Caso A: 11 15 4444 3333 -> 11 4444 3333 (12 dígitos -> 10 dígitos)
    if (clean.length === 12 && clean.slice(2, 4) === '15') {
        clean = clean.slice(0, 2) + clean.slice(4);
    } 
    // Caso B: 549 11 15 4444 3333 -> 549 11 4444 3333 (15 dígitos -> 13 dígitos)
    else if (clean.length === 15 && clean.startsWith('549') && clean.slice(5, 7) === '15') {
        clean = clean.slice(0, 5) + clean.slice(7);
    } 
    // Caso C: 54 11 15 4444 3333 -> 549 11 4444 3333
    else if (clean.startsWith('54') && clean.length === 14 && clean.slice(4, 6) === '15') {
        clean = '549' + clean.slice(2, 4) + clean.slice(6);
    }
    // Caso D: 15 4444 3333 (10 dígitos empezando con 15 sin código de área CABA)
    else if (clean.startsWith('15') && clean.length === 10) {
        clean = '11' + clean.slice(2);
    }

    // Reglas para Argentina:
    // 1. Si tiene 10 dígitos (ej: 11 1234 5678 o 351 123 4567), anteponer 549
    if (clean.length === 10) {
        clean = defaultCountryCode + clean;
    }
    // 2. Si empieza con 54 y tiene 12 dígitos (ej: 54 11 1234 5678, le falta el 9 de celular)
    else if (clean.startsWith('54') && clean.length === 12 && !clean.startsWith('549')) {
        clean = '549' + clean.slice(2);
    }
    // 3. Si viene como 540 o 5490 (con el 0 del código de área local)
    else if (clean.startsWith('540')) {
        clean = '549' + clean.slice(3);
    } else if (clean.startsWith('5490')) {
        clean = '549' + clean.slice(4);
    }

    // Validación final estricta
    if (isValidWhatsAppFormat(clean)) {
        return clean;
    }

    return null;
}

/**
 * Normaliza un lote de números crudos usando IA (Groq) para detectar y reparar
 * omisiones de prefijo 549, 15, ceros, o formatos complejos en el Excel.
 */
async function batchNormalizePhonesWithAI(rawPhones) {
    if (!rawPhones || rawPhones.length === 0) return {};
    
    // Obtener valores únicos y no vacíos
    const uniquePhones = [...new Set(rawPhones.map(p => String(p || '').trim()).filter(Boolean))];
    if (uniquePhones.length === 0) return {};

    const results = {};
    const chunkSize = 50; // Procesar en bloques para respetar context tokens

    for (let i = 0; i < uniquePhones.length; i += chunkSize) {
        const chunk = uniquePhones.slice(i, i + chunkSize);
        try {
            const prompt = `Actúa como un validador y normalizador de telecomunicaciones para WhatsApp Cloud API.
Se cargó un archivo Excel en Argentina con números de teléfono para enviar una campaña de WhatsApp.
Tu tarea es normalizar cada número al estándar E.164 internacional requerido por WhatsApp.

Reglas estrictas para números de Argentina:
1. El formato final de WhatsApp para celulares de Argentina DEBE ser: 549 + código de área (ej: 11 para Buenos Aires, 351 para Córdoba, 341 para Rosario, etc.) + número de abonado (ej: 8 dígitos para CABA). Total 13 dígitos numéricos (ej: 5491123988447).
2. Si un número viene como local sin código de país (ej: "1123988447", "11 2398 8447", "011...", "1523988447"), agrégale el 549 y remueve el "0" inicial o el "15".
3. Si un número ya tiene "54" pero le falta el "9" de celular (ej: "541123988447"), insértale el 9 -> "5491123988447".
4. Si un número tiene un error evidente, dígitos de más/menos irrecuperables (ej: "11239898447" con dígitos inventados), o no es un teléfono válido, devuélvelo como null.
5. Si es un número internacional de otro país (ej: México +52, España +34, USA +1), devuélvelo en formato E.164 sin signos "+".

Lista de números a procesar:
${JSON.stringify(chunk)}

Responde ÚNICAMENTE un objeto JSON válido con este formato exacto (sin markdown ni texto extra):
{
  "numero_original": "numero_normalizado_o_null"
}`;

            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'openai/gpt-oss-20b',
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const content = completion.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);
            Object.assign(results, parsed);
        } catch (err) {
            console.warn(`⚠️ Error en normalización con IA de lote telefónico:`, err.message);
            // Fallback: usar reglas locales deterministas
            for (const p of chunk) {
                results[p] = normalizePhoneNumber(p);
            }
        }
    }

    return results;
}

/**
 * Limpia y formatea el nombre del contacto
 */
function cleanName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    const trimmed = rawName.trim();
    if (!trimmed) return '';
    
    // Si viene TODO EN MAYÚSCULAS o todo minúsculas, pasarlo a formato Nombre Propio
    if (trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase()) {
        return trimmed
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    return trimmed;
}

/**
 * Limpia y valida el email
 */
function cleanEmail(rawEmail) {
    if (!rawEmail || typeof rawEmail !== 'string') return null;
    const trimmed = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(trimmed) ? trimmed : null;
}

/**
 * Analiza las columnas del Excel usando Groq IA para detectar Teléfono, Nombre y Email.
 */
async function analyzeColumnsWithAI(headers, sampleRows) {
    try {
        const prompt = `Actúa como un experto en procesamiento de datos. Tengo un archivo Excel o CSV para importar contactos a WhatsApp.
Los encabezados de las columnas son: ${JSON.stringify(headers)}

Aquí tienes una muestra de las primeras filas:
${JSON.stringify(sampleRows, null, 2)}

Analiza los encabezados y valores de ejemplo. Debes identificar cuál columna representa:
1. "telefono": Número de teléfono, celular o WhatsApp (obligatorio).
2. "nombre": Nombre o razón social del contacto (opcional, null si no existe).
3. "email": Correo electrónico (opcional, null si no existe).

Responde ÚNICAMENTE un objeto JSON válido con esta estructura exacta (sin texto previo ni markdown):
{
  "telefono": "nombre_exacto_columna_telefono",
  "nombre": "nombre_exacto_columna_nombre_o_null",
  "email": "nombre_exacto_columna_email_o_null"
}`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'openai/gpt-oss-20b',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const rawContent = completion.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(rawContent);

        return {
            telefono: parsed.telefono && headers.includes(parsed.telefono) ? parsed.telefono : null,
            nombre: parsed.nombre && headers.includes(parsed.nombre) ? parsed.nombre : null,
            email: parsed.email && headers.includes(parsed.email) ? parsed.email : null,
            detectedBy: 'IA (Groq)'
        };
    } catch (error) {
        console.warn('⚠️ IA no pudo mapear columnas, usando detector heurístico:', error.message);
        
        // Fallback heurístico con expresiones regulares
        const findCol = (regex) => headers.find(h => regex.test(String(h).toLowerCase())) || null;

        return {
            telefono: findCol(/tel|cel|phone|whatsapp|wapp|movil|nro|numero/i),
            nombre: findCol(/nom|name|cliente|contacto|destinatario|razon/i),
            email: findCol(/mail|correo|electronico/i),
            detectedBy: 'Heurístico (Fallback)'
        };
    }
}

/**
 * Lee un archivo Excel (.xlsx, .xls) o CSV, analiza columnas y teléfonos con IA y normaliza todos los contactos.
 */
async function processExcelContactsWithAI(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo Excel no contiene hojas.');

    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
        return {
            success: false,
            error: 'El archivo Excel está vacío o no contiene filas con datos.'
        };
    }

    const headers = Object.keys(rows[0]);
    const sampleRows = rows.slice(0, 3);

    // 1. Analizar columnas con IA (Groq)
    const mapping = await analyzeColumnsWithAI(headers, sampleRows);

    if (!mapping.telefono) {
        return {
            success: false,
            error: `No se pudo identificar una columna de teléfono entre los encabezados: ${headers.join(', ')}.`,
            headers
        };
    }

    // 2. Extraer todos los números crudos para análisis con IA
    const rawPhones = rows.map(r => r[mapping.telefono]).filter(Boolean);
    console.log(`🤖 [IA Excel] Analizando y normalizando ${rawPhones.length} teléfonos con IA...`);
    const aiNormalizedMap = await batchNormalizePhonesWithAI(rawPhones);

    // 3. Procesar y normalizar cada fila garantizando prefijo 549
    const validContacts = [];
    const seenPhones = new Set();
    let invalidCount = 0;

    for (const row of rows) {
        const rawPhone = String(row[mapping.telefono] || '').trim();
        
        // Prioridad: Normalización devuelta por IA -> Fallback a normalizador local
        let normalizedPhone = aiNormalizedMap[rawPhone] || normalizePhoneNumber(rawPhone);

        // Si la IA devolvió algo pero no tiene formato WhatsApp estricto, probar con normalizador local
        if (!isValidWhatsAppFormat(normalizedPhone)) {
            normalizedPhone = normalizePhoneNumber(rawPhone);
        }

        // Si sigue sin ser válido o ya fue agregado, descartar
        if (!normalizedPhone || seenPhones.has(normalizedPhone) || !isValidWhatsAppFormat(normalizedPhone)) {
            invalidCount++;
            continue;
        }

        seenPhones.add(normalizedPhone);

        const rawName = mapping.nombre ? row[mapping.nombre] : '';
        const rawMail = mapping.email ? row[mapping.email] : '';

        validContacts.push({
            telefono: normalizedPhone,
            nombre: cleanName(rawName) || `Usuario ${normalizedPhone}`,
            email: cleanEmail(rawMail)
        });
    }

    console.log(`✅ [IA Excel] Procesamiento finalizado: ${validContacts.length} contactos válidos normalizados con 549, ${invalidCount} descartados.`);

    return {
        success: true,
        totalRows: rows.length,
        validCount: validContacts.length,
        invalidCount,
        mappingDetected: mapping,
        contacts: validContacts
    };
}

module.exports = {
    isValidWhatsAppFormat,
    normalizePhoneNumber,
    batchNormalizePhonesWithAI,
    cleanName,
    cleanEmail,
    processExcelContactsWithAI
};
