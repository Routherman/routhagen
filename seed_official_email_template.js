const db = require('./database.js');

async function seedTemplate() {
  await db.initDB();

  const nombre = 'Búsqueda de Asesores Comerciales Colaboratium (Oficial)';
  const asunto = 'Búsqueda de Asesores Comerciales Colaboratium • Convocatoria Nacional';
  const contenido = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 24px 12px; color: #1e293b; line-height: 1.5;">
  <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
    
    <!-- Encabezado Institucional -->
    <div style="background: linear-gradient(135deg, #0284c7 0%, #1e40af 100%); padding: 28px 24px; text-align: center; color: #ffffff;">
      <div style="display: inline-block; background: rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">
        Entidad Registrada BCRA Nº 40.015
      </div>
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">COLABORATIUM</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95; font-weight: 500;">Convocatoria Ejecutiva: Asesores Comerciales & Líderes de Red</p>
    </div>

    <!-- Cuerpo del Mensaje -->
    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; margin-top: 0; color: #0f172a;">Estimado/a <strong>{{nombre}}</strong>,</p>
      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Nos ponemos en contacto desde la <strong>Dirección de Expansión de Colaboratium</strong> en referencia a tu postulación para integrarte como <strong>Asesor Comercial</strong> en nuestra red de operaciones financieras y crediticias.
      </p>

      <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 16px; border-radius: 6px; margin: 22px 0;">
        <h3 style="margin: 0 0 10px 0; color: #0369a1; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Estructura y Beneficios Comerciales:</h3>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #334155; line-height: 1.7;">
          <li><strong>Comisiones Inmediatas:</strong> devengamiento al 3% al calce inmediato, con escalas del 4%, 5% y 6% por cumplimiento.</li>
          <li><strong>Tecnología CRM con IA:</strong> acceso a plataforma propia con Copiloto IA para cotizaciones, seguimiento y scoring.</li>
          <li><strong>Capacitaciones Continuas:</strong> webinars semanales vía Google Meet y encuentros ejecutivos en Vicente López.</li>
          <li><strong>Marco Regulatorio Seguro:</strong> productos respaldados bajo normativa BCRA Nº 40.015 y custodia bancaria.</li>
        </ul>
      </div>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Adjuntamos a este correo la <strong>Presentación Institucional 2026</strong> en formato PDF con el detalle comercial y las líneas operativas.
      </p>

      <!-- Botones de Acción -->
      <div style="text-align: center; margin: 28px 0 20px 0;">
        <a href="https://colaboratium.com.ar" target="_blank" style="background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 13px 26px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block; margin-right: 8px; box-shadow: 0 2px 4px rgba(2,132,199,0.3);">
          🌐 Visitar Sitio Web Oficial
        </a>
        <a href="https://wa.me/5491136822400?text=Hola%20Colaboratium,%20recib%C3%AD%20la%20propuesta%20de%20Asesores%20y%20deseo%20m%C3%A1s%20informaci%C3%B3n" target="_blank" style="background-color: #22c55e; color: #ffffff; text-decoration: none; padding: 13px 24px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block; box-shadow: 0 2px 4px rgba(34,197,94,0.3);">
          💬 Contactar por WhatsApp
        </a>
      </div>

      <!-- Canales de Contacto Directos -->
      <div style="background-color: #f1f5f9; border-radius: 10px; padding: 16px; margin: 24px 0;">
        <h4 style="margin: 0 0 10px 0; color: #475569; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Canales de Contacto Directo:</h4>
        <table style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; width: 28px;">🌐</td>
            <td style="padding: 4px 0;"><strong>Sitio Web:</strong> <a href="https://colaboratium.com.ar" style="color:#0284c7;text-decoration:none;">www.colaboratium.com.ar</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">📞</td>
            <td style="padding: 4px 0;"><strong>Teléfono:</strong> <a href="tel:+541136822400" style="color:#0284c7;text-decoration:none;">+54 11 3682-2400</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">💬</td>
            <td style="padding: 4px 0;"><strong>WhatsApp Oficial:</strong> <a href="https://wa.me/5491136822400" style="color:#16a34a;text-decoration:none;">+54 9 11 3682-2400</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">✉️</td>
            <td style="padding: 4px 0;"><strong>Correo Electrónico:</strong> <a href="mailto:colaboratium@gmail.com" style="color:#0284c7;text-decoration:none;">colaboratium@gmail.com</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">🏢</td>
            <td style="padding: 4px 0;"><strong>Sede Central:</strong> Av. del Libertador 264, 1° Piso, Vicente López, Bs. As.</td>
          </tr>
        </table>
      </div>

      <!-- Redes Sociales -->
      <div style="text-align: center; margin: 20px 0 10px 0;">
        <p style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Nuestras Redes Sociales:</p>
        <a href="https://www.linkedin.com/company/colaboratium/" target="_blank" style="margin: 0 6px; font-size: 12px; color: #0077b5; text-decoration: none; font-weight: 600; padding: 6px 12px; background: #e0f2fe; border-radius: 6px; display: inline-block;">
          💼 LinkedIn
        </a>
        <a href="https://www.instagram.com/colaboratium/" target="_blank" style="margin: 0 6px; font-size: 12px; color: #e1306c; text-decoration: none; font-weight: 600; padding: 6px 12px; background: #fce7f3; border-radius: 6px; display: inline-block;">
          📸 Instagram
        </a>
        <a href="https://www.facebook.com/colaboratium" target="_blank" style="margin: 0 6px; font-size: 12px; color: #1877f2; text-decoration: none; font-weight: 600; padding: 6px 12px; background: #eff6ff; border-radius: 6px; display: inline-block;">
          👍 Facebook
        </a>
      </div>

      <p style="font-size: 13px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        Saludos cordiales,<br>
        <strong>Gerencia de Selección y Expansión de Red</strong><br>
        Colaboratium — Registro BCRA Nº 40.015
      </p>
    </div>

    <!-- Pie Anti-Spam y Botón de Desuscripción -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
      <p style="margin: 0 0 8px 0;">
        Estás recibiendo este correo porque tu casilla <strong>{{email}}</strong> fue registrada en nuestra convocatoria comercial o formulario de postulación de Colaboratium.
      </p>
      <p style="margin: 0;">
        Si no deseas recibir más comunicaciones sobre esta búsqueda laboral, puedes 
        <a href="mailto:colaboratium@gmail.com?subject=Baja%20de%20Comunicaciones%20Colaboratium&body=Por%20favor%20eliminar%20el%20correo%20{{email}}%20de%20la%20lista%20de%20difusi%C3%B3n." style="color: #64748b; text-decoration: underline; font-weight: 600;">
          Darse de baja / Desuscribirme haciendo clic aquí
        </a>
      </p>
    </div>

  </div>
</div>`;

  const [existing] = await db.pool.query('SELECT id FROM plantillas WHERE nombre = ?', [nombre]);
  if (existing.length > 0) {
    await db.pool.query('UPDATE plantillas SET asunto = ?, contenido = ? WHERE id = ?', [asunto, contenido, existing[0].id]);
    console.log('✅ Template updated with ID:', existing[0].id);
  } else {
    const [res] = await db.pool.query('INSERT INTO plantillas (codigo_empresa, nombre, tipo, asunto, contenido) VALUES (?, ?, ?, ?, ?)', ['KRZMJI', nombre, 'email', asunto, contenido]);
    console.log('✅ Template created with ID:', res.insertId);
  }
  process.exit(0);
}

seedTemplate().catch(e => {
  console.error(e);
  process.exit(1);
});
