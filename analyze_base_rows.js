const xlsx = require('xlsx');
const path = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx';

const wb = xlsx.readFile(path);
const ws = wb.Sheets['Base'];
const rows = xlsx.utils.sheet_to_json(ws);

console.log('Total filas en Base:', rows.length);

let withPhone = 0;
let withoutPhone = 0;
let withEmail = 0;
let withoutEmail = 0;

const samplePhones = [];
const sampleNoPhones = [];

rows.forEach((r, idx) => {
    const rawPhone = r['Teléfono'];
    const rawEmail = r['Email institucional'];
    
    if (rawPhone && String(rawPhone).trim()) {
        withPhone++;
        if (samplePhones.length < 5) samplePhones.push({ id: r['ID'], org: r['Organización'], phone: rawPhone });
    } else {
        withoutPhone++;
        if (sampleNoPhones.length < 5) sampleNoPhones.push({ id: r['ID'], org: r['Organización'], email: rawEmail });
    }

    if (rawEmail && String(rawEmail).trim()) {
        withEmail++;
    } else {
        withoutEmail++;
    }
});

console.log({
    total: rows.length,
    withPhone,
    withoutPhone,
    withEmail,
    withoutEmail
});

console.log('\nMuestra con teléfono:', samplePhones);
console.log('\nMuestra SIN teléfono:', sampleNoPhones);
