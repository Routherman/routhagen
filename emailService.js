const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Configuración de transporte de email
let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const user = process.env.SMTP_USER || process.env.EMAIL_USER || 'colaboratium@gmail.com';
    const pass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s+/g, '');

    if (pass) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user, pass }
        });
    } else {
        // Transporte de desarrollo / fallback que registra los correos sin fallar
        transporter = {
            sendMail: async (mailOptions) => {
                console.log('\n📧 =================== SIMULACIÓN ENVÍO DE EMAIL ===================');
                console.log(`De: ${mailOptions.from}`);
                console.log(`Para: ${mailOptions.to}`);
                console.log(`Asunto: ${mailOptions.subject}`);
                console.log(`Cuerpo:\n${mailOptions.text || mailOptions.html.replace(/<[^>]*>?/gm, '').substring(0, 300)}...`);
                console.log('====================================================================\n');
                return { messageId: `mock_email_${Date.now()}`, accepted: [mailOptions.to] };
            }
        };
    }
    return transporter;
}

/**
 * Envía un ticket de soporte/orden por email a la casilla oficial (colaboratium@gmail.com o especificada)
 */
async function sendTicketEmail(ticket, targetEmail = 'colaboratium@gmail.com') {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';

        const subject = `🎫 [TICKET #${ticket.id}] ${ticket.customer_name || ticket.customer_number} - Estado: ${(ticket.status || 'OPEN').toUpperCase()}`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0c0d0e; color: #ffffff; padding: 20px; }
                .card { background-color: #17181c; border-radius: 16px; border: 1px solid #2e3038; max-width: 600px; margin: 0 auto; overflow: hidden; }
                .header { background: linear-gradient(135deg, #0284c7, #6366f1); padding: 24px; text-align: left; }
                .title { font-size: 20px; font-weight: 800; color: #ffffff; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
                .subtitle { font-size: 12px; color: rgba(255,255,255,0.8); margin-top: 4px; font-weight: 600; }
                .content { padding: 24px; }
                .field-row { display: flex; justify-content: space-between; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #22242b; }
                .field-label { font-size: 11px; font-weight: 700; color: #8e94a5; text-transform: uppercase; letter-spacing: 0.5px; }
                .field-value { font-size: 13px; font-weight: 600; color: #f1f5f9; text-align: right; }
                .badge { display: inline-block; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
                .badge-open { background-color: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4); }
                .summary-box { background-color: #1f2128; border-radius: 12px; padding: 16px; margin: 16px 0; border-left: 4px solid #38bdf8; }
                .summary-title { font-size: 11px; font-weight: 800; color: #38bdf8; text-transform: uppercase; margin-bottom: 6px; }
                .summary-text { font-size: 13px; line-height: 1.5; color: #cbd5e1; white-space: pre-line; }
                .footer { padding: 16px 24px; background-color: #121316; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #22242b; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <h1 class="title">Routh Agent • Ticket #${ticket.id}</h1>
                    <p class="subtitle">Notificación de Atención al Cliente y Asesores</p>
                </div>
                <div class="content">
                    <div class="field-row">
                        <span class="field-label">Estado</span>
                        <span class="field-value"><span class="badge badge-open">${(ticket.status || 'OPEN').toUpperCase()}</span></span>
                    </div>
                    <div class="field-row">
                        <span class="field-label">Cliente / Asesor</span>
                        <span class="field-value">${ticket.customer_name || 'Sin Nombre Registrado'}</span>
                    </div>
                    <div class="field-row">
                        <span class="field-label">Teléfono / WhatsApp</span>
                        <span class="field-value">${ticket.customer_number}</span>
                    </div>
                    <div class="field-row">
                        <span class="field-label">Fecha de Apertura</span>
                        <span class="field-value">${new Date(ticket.creado_en || Date.now()).toLocaleString('es-AR')}</span>
                    </div>

                    <div class="summary-box">
                        <div class="summary-title">Resumen Ejecutivo</div>
                        <div class="summary-text">${ticket.summary || 'Aún no se ha generado resumen automático para este caso.'}</div>
                    </div>
                    ${ticket.details ? `<p style="font-size:12px;color:#94a3b8;margin-top:8px;"><strong>Detalles adicionales:</strong> ${ticket.details}</p>` : ''}
                </div>
                <div class="footer">
                    Notificación automática de Routh-Agent para ${ticket.codigo_empresa || 'Colaboratium'}.<br>
                    Destinatario oficial: ${targetEmail}
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await mailer.sendMail({
            from: `"Colaboratium Helpdesk" <${fromEmail}>`,
            to: targetEmail,
            subject: subject,
            html: htmlContent
        });

        console.log(`✅ [TICKET EMAIL] Notificación enviada con éxito a ${targetEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ [TICKET EMAIL ERROR]:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Envía confirmación de turno/webinar al Asesor interesado (damduff@gmail.com)
 */
async function sendWebinarConfirmationToAdvisor(booking) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const isVirtual = booking.modalidad === 'VIRTUAL';

        const subject = isVirtual
            ? `✅ Confirmación: Webinar Virtual de Capacitación Colaboratium - ${booking.fechaStr} ${booking.horarioStr}`
            : `📍 Confirmación: Reunión Presencial Colaboratium - ${booking.fechaStr} ${booking.horarioStr}`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
                .card { background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; max-width: 600px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
                .header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 30px; text-align: center; color: white; }
                .badge { background-color: #f59e0b; color: #000; font-weight: 800; font-size: 11px; padding: 4px 12px; border-radius: 999px; text-transform: uppercase; display: inline-block; margin-bottom: 10px; }
                .title { font-size: 22px; font-weight: 900; margin: 0; }
                .content { padding: 30px; }
                .box { background-color: #f1f5f9; border-radius: 16px; padding: 20px; margin: 20px 0; border-left: 5px solid ${isVirtual ? '#3b82f6' : '#10b981'}; }
                .btn { display: inline-block; background-color: #0f172a; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 14px; font-weight: 800; font-size: 14px; margin-top: 15px; text-align: center; }
                .footer { padding: 20px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <span class="badge">Colaboratium • Registro Oficial BCRA Nº 40.015</span>
                    <h1 class="title">¡Tu lugar está confirmado, ${booking.nombre}!</h1>
                </div>
                <div class="content">
                    <p style="font-size:15px;line-height:1.6;">
                        Te confirmamos la reserva para tu sesión de inducción al <strong>Programa Oficial de Asesores Comerciales de Colaboratium</strong>.
                    </p>

                    <div class="box">
                        <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;">Detalles de la Cita</p>
                        <p style="margin:4px 0;font-size:16px;font-weight:800;color:#0f172a;">📅 Fecha: ${booking.fechaStr}</p>
                        <p style="margin:4px 0;font-size:16px;font-weight:800;color:#0f172a;">⏰ Horario: ${booking.horarioStr}</p>
                        <p style="margin:4px 0;font-size:14px;font-weight:700;color:#3b82f6;">Modalidad: ${isVirtual ? '💻 Webinar Virtual (Vía Google Meet)' : '🏢 Reunión Presencial'}</p>
                        
                        ${isVirtual ? `
                            <p style="margin:12px 0 4px 0;font-size:13px;color:#334155;">Enlace directo a Google Meet:</p>
                            <a href="${booking.meetLink}" class="btn">🚀 Ingresar a Google Meet</a>
                            <p style="margin-top:8px;font-size:11px;color:#64748b;">Link alternativo: <a href="${booking.meetLink}">${booking.meetLink}</a></p>
                        ` : `
                            <p style="margin:12px 0 4px 0;font-size:14px;font-weight:700;color:#0f172a;">📍 Ubicación de la Reunión:</p>
                            <p style="margin:4px 0;font-size:13px;color:#334155;">Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Provincia de Buenos Aires.</p>
                            <a href="https://maps.google.com/?q=Av.+del+Libertador+264,+Vicente+Lopez" class="btn" style="background-color:#10b981;">🗺️ Ver en Google Maps</a>
                        `}
                    </div>

                    <h3 style="font-size:14px;font-weight:800;color:#0f172a;margin-top:25px;">Temario de la Capacitación (40 min):</h3>
                    <ul style="font-size:13px;line-height:1.7;color:#475569;padding-left:20px;">
                        <li><strong>Esquema de Comisiones (4%, 5% y 6%):</strong> 3% inmediato al calce + residual en cuotas + 100% en reinversiones.</li>
                        <li><strong>Atribución de Leads:</strong> 100% en clientes propios (Caso Carlos Gómez) vs leads provistos por Colaboratium (Caso Juan Ramírez).</li>
                        <li><strong>Operatoria No Custodial BIND / Coinag:</strong> Costo cero para el inversor y marco normativo BCRA Nº 40.015.</li>
                        <li><strong>Consola del Asesor:</strong> Alta, precarga de clientes y seguimiento de comisiones en vivo.</li>
                    </ul>
                </div>
                <div class="footer">
                    Colaboratium (GLOBAL LOAN S.A.) • Registro BCRA Nº 40.015<br>
                    ¿Necesitas reprogramar? Respóndenos a este correo o al WhatsApp oficial.
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await mailer.sendMail({
            from: `"Colaboratium Asesores" <${fromEmail}>`,
            to: booking.email,
            subject: subject,
            html: htmlContent
        });

        console.log(`✅ [ADVISOR EMAIL] Confirmación enviada a ${booking.email} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [ADVISOR EMAIL ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Notifica a colaboratium@gmail.com que un asesor reservó fecha en el calendario
 */
async function sendWebinarNotificationToCompany(booking) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const targetEmail = 'colaboratium@gmail.com';

        const subject = `📢 NUEVO ASESOR INSCRIPTO: ${booking.nombre} • ${booking.modalidad} (${booking.fechaStr} ${booking.horarioStr})`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <body style="font-family:sans-serif;background-color:#0f172a;color:#f8fafc;padding:25px;">
            <div style="background-color:#1e293b;border-radius:16px;padding:24px;max-width:600px;margin:0 auto;border:1px solid #334155;">
                <h2 style="color:#f59e0b;margin-top:0;">Nuevo Asesor Registrado a Capacitación</h2>
                <hr style="border:0;border-top:1px solid #334155;margin:15px 0;">
                <p><strong>Nombre:</strong> ${booking.nombre}</p>
                <p><strong>Email:</strong> <a href="mailto:${booking.email}" style="color:#38bdf8;">${booking.email}</a></p>
                <p><strong>Teléfono WhatsApp:</strong> ${booking.telefono}</p>
                <p><strong>Modalidad:</strong> ${booking.modalidad === 'VIRTUAL' ? '💻 Virtual (Meet)' : '🏢 Presencial (Vicente López)'}</p>
                <p><strong>Fecha y Horario:</strong> ${booking.fechaStr} - ${booking.horarioStr}</p>
                ${booking.meetLink ? `<p><strong>Link Meet:</strong> <a href="${booking.meetLink}" style="color:#38bdf8;">${booking.meetLink}</a></p>` : ''}
                <p><strong>Ticket ID generado:</strong> #${booking.ticketId || '-'}</p>
                <div style="margin-top:20px;padding:12px;background:#0f172a;border-radius:10px;font-size:12px;color:#94a3b8;">
                    Ficha guardada automáticamente en la Agenda CRM y Helpdesk de Routh Agent.
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await mailer.sendMail({
            from: `"Routh Agent Notificador" <${fromEmail}>`,
            to: targetEmail,
            subject: subject,
            html: htmlContent
        });

        console.log(`✅ [COMPANY NOTIFICATION EMAIL] Enviada a ${targetEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [COMPANY NOTIFICATION ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    sendTicketEmail,
    sendWebinarConfirmationToAdvisor,
    sendWebinarNotificationToCompany
};
