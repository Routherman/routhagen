const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');

async function extractTextFromFile(filePath, mimeType) {
    try {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.pdf' || mimeType === 'application/pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            return data.text;
        }

        if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;
        }

        if (ext === '.xlsx' || ext === '.xls' || mimeType.includes('excel') || mimeType.includes('spreadsheetml')) {
            const workbook = xlsx.readFile(filePath);
            let text = '';
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const csv = xlsx.utils.sheet_to_csv(sheet);
                text += `\n--- Hoja: ${sheetName} ---\n${csv}`;
            });
            return text;
        }

        if (ext === '.txt' || ext === '.md' || ext === '.csv' || mimeType.startsWith('text/')) {
            return fs.readFileSync(filePath, 'utf-8');
        }

        // Fallback for unknown text-like files
        return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        console.error('Error extrayendo texto del archivo:', error);
        throw new Error('No se pudo procesar el archivo. Asegúrate de que el formato sea correcto.');
    }
}

module.exports = {
    extractTextFromFile
};
