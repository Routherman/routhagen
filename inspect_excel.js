const xlsx = require('xlsx');
const path = 'C:/Users/Administrador/Desktop/Routh-Agent/RAG/Colaboratium_Base_Prospeccion_Asesores.xlsx';

const wb = xlsx.readFile(path);
console.log('Hojas encontradas:', wb.SheetNames);

for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const data = xlsx.utils.sheet_to_json(ws);
    console.log(`\n========================================`);
    console.log(`HOJA: "${name}" - Total registros: ${data.length}`);
    if (data.length > 0) {
        console.log('Columnas:', Object.keys(data[0]));
        console.log('Fila 1 muestra:', JSON.stringify(data[0], null, 2));
        if (data.length > 1) {
            console.log('Fila 2 muestra:', JSON.stringify(data[1], null, 2));
        }
    }
}
