const db = require('./database.js');
const { getAvailableWebinarSlots } = require('./googleCalendarService.js');

async function createTemplate() {
  await db.initDB();

  // Obtener fechas posibles del calendario real de Asesores
  let slots = [];
  try {
    slots = await getAvailableWebinarSlots('KRZMJI', 'asesores');
  } catch(e) {
    console.error('Error fetching slots:', e);
  }

  // Generar bloque de fechas posibles encontradas en el calendario
  let fechasHtml = '';
  if (slots && slots.length > 0) {
    fechasHtml = slots.map((s, idx) => {
      const hora = s.horarioStr ? s.horarioStr.split(' a ')[0] : '13:00 hs';
      return `<li style="margin-bottom: 6px;"><strong>Opción ${idx + 1}:</strong> ${s.fechaStr} • <strong>${s.horarioStr || (hora + ' hs')}</strong> (Argentina) • Modalidad Virtual • Duración: 1h 30m</li>`;
    }).join('\n');
  } else {
    fechasHtml = `<li><strong>Fecha:</strong> {{Fecha}} • <strong>Horario:</strong> {{Hora}} (Argentina) • <strong>Modalidad:</strong> Virtual • <strong>Duración estimada:</strong> {{Duracion}}</li>`;
  }

  const nombre = 'Reunión Informativa Asesores Colaboratium (Oficial)';
  const asunto = 'Invitación: Reunión Informativa para Futuros Asesores Comerciales • Colaboratium';

  const contenido = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 24px 12px; color: #1e293b; line-height: 1.6;">
  <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
    
    <!-- Encabezado Institucional -->
    <div style="background: linear-gradient(135deg, #0284c7 0%, #1e40af 100%); padding: 26px 24px; text-align: center; color: #ffffff;">
      <div style="display: inline-block; background: rgba(255,255,255,0.18); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">
        Entidad Registrada BCRA Nº 40.015
      </div>
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">COLABORATIUM</h1>
      <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; font-weight: 500;">Convocatoria Comercial • Red de Asesores y Líderes</p>
    </div>

    <!-- Cuerpo del Mensaje -->
    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; margin-top: 0; color: #0f172a;">
        Hola, <strong>{{Nombre}}</strong>:
      </p>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Hace un tiempo recibimos tus datos a partir de tu interés en formar parte del equipo comercial de Colaboratium.
      </p>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Hoy queremos retomar ese contacto e invitarte a conocer más sobre nuestro proyecto y las oportunidades de desarrollo que estamos construyendo.
      </p>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Estamos organizando una reunión informativa para futuros asesores comerciales, en la que compartiremos nuestra propuesta de trabajo, el funcionamiento de Colaboratium y los próximos pasos para quienes estén interesados en sumarse.
      </p>

      <!-- Detalles del encuentro (del calendario) -->
      <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 16px; border-radius: 6px; margin: 22px 0;">
        <h4 style="margin: 0 0 10px 0; color: #0369a1; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
          📅 Detalles del encuentro:
        </h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #334155; line-height: 1.7;">
          ${fechasHtml}
        </ul>
      </div>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Para participar, simplemente confirmá tu asistencia a través del siguiente enlace:
      </p>

      <!-- Botón de Registro -->
      <div style="text-align: center; margin: 26px 0;">
        <a href="{{EnlaceRegistro}}" target="_blank" style="background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 800; font-size: 14px; display: inline-block; letter-spacing: 0.5px; box-shadow: 0 4px 6px -1px rgba(2,132,199,0.3);">
          "RESERVAR MI LUGAR EN LA REUNIÓN"
        </a>
      </div>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Una vez que te registres, recibirás la confirmación y los detalles necesarios para participar, junto con la invitación para agregar el encuentro a tu calendario.
      </p>

      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Nos entusiasma la posibilidad de conocerte y compartir esta nueva etapa de Colaboratium.
      </p>

      <p style="font-size: 15px; font-weight: 800; color: #0284c7; margin: 20px 0 14px 0;">
        ¡Te esperamos!
      </p>

      <p style="font-size: 13px; color: #475569; margin: 0 0 20px 0; line-height: 1.5;">
        <strong>Equipo de Colaboratium</strong><br>
        Global Loan S.A.
      </p>

      <!-- Datos de Contacto Oficiales -->
      <div style="background-color: #f1f5f9; border-radius: 10px; padding: 16px; margin: 22px 0;">
        <h4 style="margin: 0 0 10px 0; color: #475569; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Canales de Contacto:</h4>
        <table style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; width: 28px;">🌐</td>
            <td style="padding: 4px 0;"><strong>Página Web:</strong> <a href="https://colaboratium.com.ar" target="_blank" style="color:#0284c7;text-decoration:none;">www.colaboratium.com.ar</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">📞</td>
            <td style="padding: 4px 0;"><strong>Teléfono Central:</strong> <a href="tel:+541136822400" style="color:#0284c7;text-decoration:none;">+54 11 3682-2400</a></td>
          </tr>
          <tr>
            <td style="padding: 6px 0 4px 0;">💬</td>
            <td style="padding: 6px 0 4px 0;">
              <strong>WhatsApp Oficial Directo (Bot):</strong><br>
              <div style="margin-top: 6px;">
                <a href="https://wa.me/5491173722708?text=Hola%20Colaboratium,%20quiero%20confirmar%20mi%20asistencia%20a%20la%20reuni%C3%B3n%20de%20asesores" target="_blank" style="background-color: #22c55e; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 12px; display: inline-block; box-shadow: 0 2px 4px rgba(34,197,94,0.3);">
                  💬 Abrir WhatsApp Bot (+54 9 11 7372-2708)
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0 4px 0;">✉️</td>
            <td style="padding: 6px 0 4px 0;"><strong>Correo Oficial:</strong> <a href="mailto:colaboratium@gmail.com" style="color:#0284c7;text-decoration:none;">colaboratium@gmail.com</a></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">🏢</td>
            <td style="padding: 4px 0;"><strong>Sede:</strong> Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.</td>
          </tr>
        </table>
      </div>

      <!-- Redes Sociales Oficiales -->
      <div style="text-align: center; margin: 20px 0 10px 0;">
        <p style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Redes Sociales Oficiales:</p>
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

    </div>

    <!-- Pie de Baja Anti-Baneo -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
      <p style="margin: 0;">
        Recibís este mensaje porque anteriormente manifestaste interés en oportunidades dentro de Colaboratium. Si preferís no recibir nuevas convocatorias, podés 
        <a href="{{EnlaceBaja}}" style="color: #64748b; text-decoration: underline; font-weight: 600;">
          indicárnoslo aquí
        </a>.
      </p>
    </div>

  </div>
</div>`;

  // Actualizar plantilla 7 o insertar
  const [existing] = await db.pool.query('SELECT id FROM plantillas WHERE nombre = ? OR id = 7', [nombre]);
  if (existing.length > 0) {
    await db.pool.query('UPDATE plantillas SET nombre = ?, asunto = ?, contenido = ? WHERE id = ?', [nombre, asunto, contenido, existing[0].id]);
    console.log('✅ Plantilla actualizada exitosamente con ID:', existing[0].id);
  } else {
    const [res] = await db.pool.query('INSERT INTO plantillas (codigo_empresa, nombre, tipo, asunto, contenido) VALUES (?, ?, ?, ?, ?)', ['KRZMJI', nombre, 'email', asunto, contenido]);
    console.log('✅ Plantilla creada exitosamente con ID:', res.insertId);
  }

  process.exit(0);
}

createTemplate().catch(e => {
  console.error('Error creating template:', e);
  process.exit(1);
});
