const db = require('../database');
const { getEmailConfig } = require('../emailService');

async function updateRemaxCampaign() {
    await db.initDB();
    const cfg = getEmailConfig();
    const replyEmail = cfg.replyToEmail;
    const newSubject = 'Alianza comercial para tus operaciones en {{Office}}';
    const newContent = `Hola {{First Name}}, ¿cómo estás?

Vi tu perfil en el equipo de {{Office}} en {{City}} y te escribo porque en Colaboratium (Global Loan S.A. — Registro BCRA Nº 40.015) estamos sumando agentes inmobiliarios con cartera activa a nuestra Red Oficial de Asesores.

Sabemos que en la operatoria inmobiliaria hablás todas las semanas con clientes que acaban de vender, que están esperando cerrar una operación o que tienen excedentes de liquidez y buscan una renta superadora al plazo fijo tradicional sin inmovilizar su capital a largo plazo.

¿Cómo funciona la alianza para vos y para tu cliente?

• Para tu cliente inversor (Costo Cero): Invierte desde una plataforma totalmente bancarizada (Banco BIND y Banco Coinag) operando desde su propio CVU, financiando créditos atomizados calificados por IA. Al inversor jamás se le cobra comisión ni gasto administrativo.

• Para vos como Asesor: Percibís comisiones de alto rendimiento sobre el capital colocado, con cobro inicial al calce del crédito y saldo residual en cuotas, más comisión plena completa en cada reinversión futura de tu cliente.

Brindamos una reunión informativa online de 40 minutos exclusiva para agentes y brokers de redes. Tenemos 4 opciones de turnos disponibles para que elijas la que mejor se adapte a tu agenda:

• Opción 1: Jueves 12/11 a las 12:00 hs (40 min)
• Opción 2: Jueves 12/11 a las 19:00 hs (40 min)
• Opción 3: Lunes 16/11 a las 12:00 hs (40 min)
• Opción 4: Lunes 16/11 a las 19:00 hs (40 min)

<div style="margin: 24px 0; text-align: center;">
  <a href="{{4}}"
     style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 30px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(2,132,199,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin-bottom: 12px;">
     📅 Elegir Turno y Reservar Lugar en 1 Paso
  </a>
  <br>
  <a href="https://wa.me/5491124735062?text=Hola%20Dami%C3%A1n,%20vi%20tu%20correo%20sobre%20la%20alianza%20para%20operaciones%20inmobiliarias"
     style="display: inline-block; background-color: #25D366; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 30px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(37,211,102,0.35); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
     👉 Chatear por WhatsApp con Damián Feuermann (+54 9 11 2473-5062)
  </a>
</div>

(También podés responder directamente este correo indicando tu opción de preferencia: 1, 2, 3 o 4)

---
Canales Oficiales de Contacto:
🌐 Web: https://colaboratium.com.ar
✉️ Email: ${replyEmail}
📱 WhatsApp Directo: https://wa.me/5491124735062 (+54 9 11 2473-5062)
📸 Instagram: https://www.instagram.com/colaboratium/ (@colaboratium)

Global Loan S.A. • Registro Oficial BCRA Nº 40.015
Av. del Libertador 264, 1° Piso, Vicente López
Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Datos de contacto comercial del directorio público de {{Office}} en {{City}}. Baja inmediata en <a href="{{5}}" style="color:#0284c7;">este enlace</a> o respondiendo "BAJA".`;

    await db.pool.query('UPDATE plantillas SET asunto = ?, contenido = ? WHERE id = 9', [newSubject, newContent]);
    console.log('✅ Template #9 updated successfully!');
    process.exit(0);
}

updateRemaxCampaign().catch(err => {
    console.error(err);
    process.exit(1);
});
