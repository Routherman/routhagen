const db = require('./database');

async function seedAllLayersTemplates() {
    await db.initDB();
    const pool = db.pool;
    const codigoEmpresa = 'KRZMJI';

    const templates = [
        // CAPA 1: FRANQUICIAS
        {
            nombre: 'Prospección Fría: Agentes Inmobiliarios RE/MAX (Flujo 2 - Capa 1)',
            tipo: 'email',
            categoria: 'asesores',
            asunto: 'Alianza comercial para tus operaciones en {{Office}}',
            contenido: `Hola {{First Name}}, ¿cómo estás?

Vi tu perfil en el equipo de {{Office}} en {{City}} y te escribo porque en Colaboratium (Global Loan S.A. — Registro BCRA Nº 40.015) estamos sumando agentes inmobiliarios con cartera activa a nuestra Red Oficial de Asesores.

Sabemos que en la operatoria inmobiliaria hablás todas las semanas con clientes que acaban de vender, que están esperando cerrar una operación o que tienen excedentes de liquidez y buscan una renta superadora al plazo fijo tradicional sin inmovilizar su capital a largo plazo.

¿Cómo funciona la alianza para vos y para tu cliente?

• Para tu cliente inversor (Costo 0%): Invierte desde una plataforma 100% bancarizada (Banco BIND y Banco Coinag) operando desde su propio CVU, financiando créditos atomizados calificados por IA. Al inversor jamás se le cobra comisión ni gasto administrativo.

• Para vos como Asesor: Percibís Comisiones de alto rendimiento sobre capital colocado, cobrando un porcentaje inmediato al calce del crédito y el resto con las cuotas, más el 100% de comisión en cada reinversión futura de tu cliente.

Brindamos una reunión informativa online de 40 minutos exclusiva para agentes y brokers de redes. Tenemos 4 opciones de turnos disponibles para que elijas la que mejor se adapte a tu agenda:

• Opción 1: Jueves 12/11 a las 12:00 hs (40 min)
• Opción 2: Jueves 12/11 a las 19:00 hs (40 min)
• Opción 3: Lunes 16/11 a las 12:00 hs (40 min)
• Opción 4: Lunes 16/11 a las 19:00 hs (40 min)

<div style="margin: 28px 0; text-align: center;">
  <a href="https://wa.me/5491124735062?text=Hola%20Dami%C3%A1n,%20vi%20tu%20correo%20sobre%20la%20alianza%20para%20operaciones%20inmobiliarias" 
     style="display: inline-block; background-color: #25D366; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 30px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(37,211,102,0.35); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
     👉 Chatear por WhatsApp con Damián Feuermann (+54 9 11 2473-5062)
  </a>
</div>

👉 Podés reservar tu lugar: https://routhagent.vercel.app/dashboard/calendar
(O bien responder directamente a este correo indicando tu opción de preferencia: 1, 2, 3 o 4)

---
Canales Oficiales de Contacto:
🌐 Web: https://colaboratium.com.ar
✉️ Email: colaboratium@gmail.com
📱 WhatsApp Directo: https://wa.me/5491124735062 (+54 9 11 2473-5062)
📸 Instagram: https://www.instagram.com/colaboratium/ (@colaboratium)

Global Loan S.A. • Registro Oficial BCRA Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López
Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Datos de contacto comercial del directorio público de {{Office}} en {{City}}. Baja inmediata en [este enlace ({{5}})] o respondiendo "BAJA".`
        },
        {
            nombre: 'Prospección WhatsApp: Agentes Franquicias (Capa 1)',
            tipo: 'whatsapp',
            categoria: 'asesores',
            asunto: 'Contacto Inicial Asesores Franquicias',
            contenido: `Hola {{First Name}}, ¿cómo estás? Vi tu perfil público en {{Office}} ({{City}}). En Colaboratium (Global Loan S.A. - Reg. BCRA Nº 40.015) incorporamos agentes con cartera para monetizar operaciones inmobiliarias con comisiones del 4% al 6% al calce. Este {{1}} a las {{2}} hs brindamos un webinar de 40 min exclusivo. ¿Te gustaría sumarte o que coordinemos un café en nuestras oficinas de Av. del Libertador 264, Vicente López?`
        },

        // CAPA 2: CORREDORES MATRICULADOS
        {
            nombre: 'Prospección Fría: Corredores Matriculados (Capa 2)',
            tipo: 'email',
            categoria: 'asesores',
            asunto: '[PUBLICIDAD] Financiamiento ágil para destrabar operaciones inmobiliarias en {{City}}, {{First Name}} (BCRA Nº 40.015)',
            contenido: `Hola {{First Name}}, ¿cómo estás?

Te contacto como Corredor Inmobiliario Matriculado en {{City}} porque en Colaboratium (Global Loan S.A. — Primera plataforma Fintech de créditos entre particulares registrada en el BCRA bajo el Nº 40.015) desarrollamos un canal específico para martilleros y corredores colegiados independientes.

Sabemos que uno de los mayores frenos en la operatoria inmobiliaria son las operaciones que se caen o se demoran 90 a 120 días por la lentitud de los créditos bancarios tradicionales, o clientes compradores que necesitan un crédito puente con garantía para calzar la compra de su nueva propiedad antes de vender la anterior.

¿Qué soluciones brindamos para tu inmobiliaria y tus clientes?

1. Créditos Puente y Mutuos con Garantía Real: Financiación ágil en 48 hs aprobada por motor de IA, permitiendo destrabar reservas y boletos de compraventa para clientes calificados.
2. Destino para Clientes Vendedores con Liquidez: Si tu cliente acaba de vender y busca renta en pesos 100% bancarizada (vía Banco BIND y Banco Coinag con CVU propio), invierte sin comisiones ni cargos administrativos financiando carteras atomizadas de bajo riesgo.
3. Honorarios y Comisiones para Vos: Percibís entre el 4% y el 6% de honorarios directos sobre el capital colocado, cobrando un 3% inmediato al calce de la operación y el saldo en cuotas, más el 100% en reinversiones futuras.

Este {{1}} a las {{2}} hs brindaremos una sesión online de {{3}} exclusiva para Corredores Matriculados donde mostramos cómo estructurar los mutuos puente y el marco legal regulatorio.

👉 Podés reservar tu acceso sin cargo acá: {{4}}

O bien respondeme este correo y coordinamos una reunión de 15 minutos personalizada.

Un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López / Maipú 568, Piso 8°, CABA

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Datos obtenidos del padrón público oficial de profesionales habilitados en {{City}}. Podés ejercer la baja inmediata haciendo clic en [este enlace ({{5}})] o respondiendo "BAJA".`
        },
        {
            nombre: 'Prospección WhatsApp: Corredores Matriculados (Capa 2)',
            tipo: 'whatsapp',
            categoria: 'asesores',
            asunto: 'Contacto Inicial Corredores Matriculados',
            contenido: `Hola {{First Name}}, ¿cómo estás? Te escribo como Corredor Inmobiliario Matriculado en {{City}}. En Colaboratium (Global Loan S.A. - Reg. BCRA Nº 40.015) creamos un canal para martilleros que permite destrabar operaciones con créditos puente con garantía real en 48 hs aprobados por IA, y captar renta para vendedores al 4-6% de honorarios. Este {{1}} a las {{2}} hs explicamos el marco legal en un webinar de 40 min. ¿Te gustaría recibir el link de Google Meet?`
        },

        // CAPA 3: PREVISIONALISTAS
        {
            nombre: 'Prospección Fría: Abogados y Gestores Previsionales (Capa 3)',
            tipo: 'email',
            categoria: 'asesores',
            asunto: '[PUBLICIDAD] Mutuos con código de débito y financiamiento para clientes previsionales en {{City}}, {{First Name}} (BCRA Nº 40.015)',
            contenido: `Hola {{First Name}}, ¿cómo estás?

Te contacto por tu actividad profesional en asesoramiento previsional y jubilaciones en {{City}}. En Colaboratium (Global Loan S.A. — Plataforma registrada en el BCRA bajo el Nº 40.015) desarrollamos una línea de mutuos atomizados y préstamos a jubilados con cuota fija y cobranza bancarizada segura.

Esta operatoria permite a los profesionales previsionales sumar una unidad de ingresos para su estudio, ofreciendo préstamos con tasa transparente y análisis de scoring en segundos:

1. Préstamos a Jubilados y Pensionados: Créditos con cuota fija y débito seguro en cuenta bancaria.
2. Inversión para Clientes con Sentencias o Cobros Retroactivos: Alternativa de renta bancarizada a través de BIND y Coinag sin comisiones de entrada ni salida.
3. Comisiones del 4% al 6% directo para el profesional, con 3% cobrado de inmediato al desembolso del crédito.

Este {{1}} a las {{2}} hs daremos una charla explicativa online de {{3}} exclusiva para el sector previsional.

👉 Reservá tu cupo sin costo acá: {{4}}

Te mando un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López / Maipú 568, Piso 8°, CABA

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Enviado conforme a registros profesionales públicos en {{City}}. Solicitá baja inmediata en [este enlace ({{5}})] o respondiendo "BAJA".`
        },
        {
            nombre: 'Prospección WhatsApp: Previsionales (Capa 3)',
            tipo: 'whatsapp',
            categoria: 'asesores',
            asunto: 'Contacto Inicial Previsionales',
            contenido: `Hola {{First Name}}, ¿cómo estás? Te escribo por tu actividad previsional en {{City}}. En Colaboratium (Reg. BCRA Nº 40.015) habilitamos un canal para gestores y abogados previsionales con créditos a jubilados de cuota fija y comisiones del 4% al 6%. Este {{1}} a las {{2}} hs tenemos una sesión online de 40 min. ¿Te gustaría participar?`
        },

        // CAPA 4: DESARROLLADORES URBANOS
        {
            nombre: 'Prospección Fría: Desarrolladores Urbanos y Fideicomisos (Capa 4)',
            tipo: 'email',
            categoria: 'lideres',
            asunto: '[PUBLICIDAD] Fondeo ágil de pozo y créditos puente para desarrollos en {{City}}, {{First Name}} (BCRA Nº 40.015)',
            contenido: `Hola {{First Name}}, ¿cómo estás?

Te contacto como desarrollador / titular de proyectos constructivos en {{City}}. En Colaboratium (Global Loan S.A. — Primera plataforma Fintech de créditos entre particulares con Reg. BCRA Nº 40.015) estructuramos financiamiento de pozo y créditos puente con garantía real para loteos, edificios y fideicomisos al costo.

Conectamos proyectos calificados directamente con una comunidad activa de inversores bancarizados (Banco BIND y Banco Coinag) que operan bajo CVU propio y contratos de mutuo digitales auditados por IA.

Beneficios para tu desarrolladora:
- Calce ágil de fondos para avance de obra sin depender de la burocracia bancaria tradicional.
- Garantías reales adaptables (hipoteca en primer grado, cesión fiduciaria de boletos o prendas).
- Opción de comercializar tus unidades como alternativa de inversión dentro de nuestra red nacional de asesores.

Este {{1}} a las {{2}} hs brindaremos una sesión ejecutiva online de {{3}} para estructuradores de proyectos y desarrolladores.

👉 Podés confirmar tu participación acá: {{4}}

O bien respondeme este correo para coordinar una reunión privada en nuestras oficinas de Av. del Libertador 264, 1° Piso, Vicente López.

Un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López / Maipú 568, Piso 8°, CABA

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Relevado de registros públicos corporativos en {{City}}. Baja inmediata en [este link ({{5}})] o respondiendo "BAJA".`
        },
        {
            nombre: 'Prospección WhatsApp: Desarrolladores Urbanos (Capa 4)',
            tipo: 'whatsapp',
            categoria: 'lideres',
            asunto: 'Contacto Inicial Desarrolladores',
            contenido: `Hola {{First Name}}, ¿cómo estás? Te escribo como desarrollador en {{City}}. En Colaboratium (Reg. BCRA Nº 40.015) brindamos financiamiento puente y fondeo para desarrollos y loteos con garantía real y aprobación ágil. Este {{1}} a las {{2}} hs daremos una presentación para desarrolladores. ¿Te paso el link de acceso a la sala?`
        },

        // CAPA 5: PRODUCTORES ASESORES DE SEGUROS
        {
            nombre: 'Prospección Fría: Productores Asesores de Seguros PAS (Capa 5)',
            tipo: 'email',
            categoria: 'asesores',
            asunto: '[PUBLICIDAD] Nueva unidad de préstamos con garantía y jubilados para tu cartera, {{First Name}} (PAS Mat. SSN)',
            contenido: `Hola {{First Name}}, ¿cómo estás?

Te escribo como Productor Asesor de Seguros (PAS) matriculado ante la Superintendencia de Seguros de la Nación porque en Colaboratium (Global Loan S.A. — Plataforma registrada en el BCRA bajo el Nº 40.015) creamos una alianza estratégica para que productores independientes sumen colocación de créditos a su cartera de asegurados.

Como PAS, ya contás con la confianza y el conocimiento financiero de tus asegurados particulares y comerciales. Nuestra plataforma te permite monetizar esa relación con productos que tu cliente ya necesita:

1. Préstamos a Jubilados y Pensionados: Créditos con cuota fija y débito seguro, ideales para familiares o asegurados de vida y retiro.
2. Créditos Prendarios e Hipotecarios: Para clientes de autos o patrimoniales que buscan liquidez inmediata sin desarmar posiciones de ahorro.
3. Inversión en Créditos con Rendimiento Superior al Plazo Fijo: Para asegurados con excedentes de liquidez en cuenta bancaria, con respaldo bancario vía Banco BIND y Coinag.

Tus Beneficios como Productor:
- Comisiones de entre el 4% y el 6% sobre el desembolso total del crédito (cobrando un 3% inmediato al calce).
- Ingresos residuales mes a mes y 100% de comisión sobre cada renovación de crédito.
- Operatoria 100% digital desde tu consola propia con scoring IA en segundos.

Este {{1}} a las {{2}} hs daremos una charla informativa online de {{3}} para Productores de Seguros.

👉 Reservá tu cupo sin costo acá: {{4}}

Te mando un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López / Maipú 568, Piso 8°, CABA

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Datos de matriculación profesional pública en la SSN. Podés solicitar la baja inmediata haciendo clic en [este link ({{5}})] o respondiendo "BAJA".`
        },
        {
            nombre: 'Prospección WhatsApp: Productores Seguros PAS (Capa 5)',
            tipo: 'whatsapp',
            categoria: 'asesores',
            asunto: 'Contacto Inicial PAS Seguros',
            contenido: `Hola {{First Name}}, ¿cómo estás? Te escribo como Productor Asesor de Seguros (PAS) en {{City}}. En Colaboratium (Global Loan S.A. - Reg. BCRA Nº 40.015) creamos una alianza para que productores sumen colocación de créditos con garantía y préstamos a jubilados a su cartera, ganando entre el 4% y el 6% de comisión inmediata más residuales. Este {{1}} a las {{2}} hs tenemos un webinar de 40 min para PAS. ¿Te reservo un lugar?`
        }
    ];

    for (const t of templates) {
        const [existing] = await pool.query(
            'SELECT id FROM plantillas WHERE codigo_empresa = ? AND nombre = ?',
            [codigoEmpresa, t.nombre]
        );
        if (existing && existing.length > 0) {
            await pool.query(
                'UPDATE plantillas SET tipo = ?, categoria = ?, asunto = ?, contenido = ? WHERE id = ?',
                [t.tipo, t.categoria, t.asunto, t.contenido, existing[0].id]
            );
            console.log(`Updated template: ${t.nombre} (ID: ${existing[0].id})`);
        } else {
            const [res] = await pool.query(
                'INSERT INTO plantillas (codigo_empresa, tipo, nombre, categoria, asunto, contenido) VALUES (?, ?, ?, ?, ?, ?)',
                [codigoEmpresa, t.tipo, t.nombre, t.categoria, t.asunto, t.contenido]
            );
            console.log(`Inserted template: ${t.nombre} (ID: ${res.insertId})`);
        }
    }

    console.log('🎉 Todas las plantillas de las Capas 1 a 5 sembradas correctamente en DB.');
}

if (require.main === module) {
    seedAllLayersTemplates()
        .then(() => process.exit(0))
        .catch(err => { console.error(err); process.exit(1); });
}

module.exports = seedAllLayersTemplates;
