const xlsx = require('xlsx');
const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
    apiKey: process.env.GROQ_TOKEN
});

/**
 * Normaliza y sanitiza números de teléfono para WhatsApp Cloud API.
 * Elimina espacios, guiones, ceros iniciales y garantiza el código de país.
 * Por defecto maneja reglas de Argentina (549) y números internacionales.
 */
function normalizePhoneNumber(rawNumber, defaultCountryCode = '549') {
    if (!rawNumber) return null;
    
    // Convertir a string y quitar cualquier carácter no numérico
    let clean = String(rawNumber).trim().replace(/\D/g, '');
    
    // Si empieza con 00 (código internacional europeo), quitarlo
    if (clean.startsWith('00')) {
        clean = clean.slice(2);
    }
    
    // Quitar ceros a la izquierda (ej: 011 -> 11)
    clean = clean.replace(/^0+/, '');

    // Quitar el prefijo local "15" si está presente (ej: 11 15 4444 3333 -> 11 4444 3333)
    if (clean.length === 12 && clean.slice(2, 4) === '15') {
        clean = clean.slice(0, 2) + clean.slice(4); // Ahora queda de 10 dígitos
    } else if (clean.length === 15 && clean.startsWith('549') && clean.slice(5, 7) === '15') {
        clean = clean.slice(0, 5) + clean.slice(7); // Ahora queda de 13 dígitos (549 + 10 dígitos)
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

    // Un número de WhatsApp válido debe tener entre 10 y 15 dígitos
    if (clean.length >= 10 && clean.length <= 16) {
        return clean;
    }

    return null;
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
 * Lee un archivo Excel (.xlsx, .xls) o CSV, lo analiza con IA y normaliza todos los contactos.
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

    // 1. Analizar columnas con IA
    const mapping = await analyzeColumnsWithAI(headers, sampleRows);

    if (!mapping.telefono) {
        return {
            success: false,
            error: `No se pudo identificar una columna de teléfono entre los encabezados: ${headers.join(', ')}.`,
            headers
        };
    }

    // 2. Procesar y normalizar cada fila
    const validContacts = [];
    const seenPhones = new Set();
    let invalidCount = 0;

    for (const row of rows) {
        const rawPhone = row[mapping.telefono];
        const normalizedPhone = normalizePhoneNumber(rawPhone);

        if (!normalizedPhone || seenPhones.has(normalizedPhone)) {
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
    normalizePhoneNumber,
    cleanName,
    cleanEmail,
    processExcelContactsWithAI
};
