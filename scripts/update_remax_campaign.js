const db = require('../database');

async function updateRemaxCampaign() {
    await db.initDB();
    const newSubject = 'Alianza comercial para tus operaciones en {{Office}}';
    const newContent = `Hola {{First Name}}, ¿cómo estás?

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
Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Datos de contacto comercial del directorio público de {{Office}} en {{City}}. Baja inmediata en [este enlace ({{5}})] o respondiendo "BAJA".`;

    await db.pool.query('UPDATE plantillas SET asunto = ?, contenido = ? WHERE id = 9', [newSubject, newContent]);
    await db.pool.query('UPDATE campanas SET asunto_email = ?, contenido_personalizado = ? WHERE id = 18', [newSubject, newContent]);
    console.log('✅ Template #9 and Campaign #18 updated successfully!');
    process.exit(0);
}

updateRemaxCampaign().catch(err => {
    console.error(err);
    process.exit(1);
});
