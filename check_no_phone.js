const xlsx = require('xlsx');
const path = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx';

const wb = xlsx.readFile(path);
const ws = wb.Sheets['Base'];
const rows = xlsx.utils.sheet_to_json(ws);

const noPhoneWithEmail = [];
const noPhoneNoEmail = [];

rows.forEach(r => {
    const hasPhone = r['Teléfono'] && String(r['Teléfono']).trim();
    const hasEmail = r['Email institucional'] && String(r['Email institucional']).trim();

    if (!hasPhone) {
        if (hasEmail) {
            noPhoneWithEmail.push({ id: r['ID'], org: r['Organización'], email: r['Email institucional'] });
        } else {
            noPhoneNoEmail.push({ id: r['ID'], org: r['Organización'], site: r['Sitio web'] });
        }
    }
});

console.log('Sin teléfono pero CON email:', noPhoneWithEmail.length, noPhoneWithEmail.slice(0, 5));
console.log('Sin teléfono y SIN email:', noPhoneNoEmail.length, noPhoneNoEmail.slice(0, 5));
