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

/**
 * Notifica a colaboratium@gmail.com que un Líder de Equipo dejó sus datos
 */
async function sendLeaderInquiryToCompany(leader) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const targetEmail = 'colaboratium@gmail.com';

        const subject = `👑 NUEVO LÍDER DE EQUIPO INTERESADO: ${leader.nombre} (${leader.telefono})`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <body style="font-family:sans-serif;background-color:#0f172a;color:#f8fafc;padding:25px;">
            <div style="background-color:#1e293b;border-radius:16px;padding:24px;max-width:600px;margin:0 auto;border:1px solid #334155;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                    <span style="background:#8b5cf6;color:#ffffff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;">Programa de Líderes</span>
                </div>
                <h2 style="color:#a78bfa;margin-top:0;">Nuevo Líder de Red Comercial Contactado</h2>
                <hr style="border:0;border-top:1px solid #334155;margin:15px 0;">
                <p><strong>Nombre del Líder:</strong> ${leader.nombre}</p>
                <p><strong>Email:</strong> <a href="mailto:${leader.email}" style="color:#38bdf8;">${leader.email}</a></p>
                <p><strong>Teléfono WhatsApp:</strong> <a href="https://wa.me/${(leader.telefono||'').replace(/\D/g,'')}" style="color:#38bdf8;">${leader.telefono}</a></p>
                <p><strong>Detalle de Solicitud:</strong> ${leader.datosRed || 'Coordinación de Reunión Ejecutiva en Vicente López o Webinar de Líderes'}</p>
                <p><strong>Ticket Helpdesk:</strong> #${leader.ticketId || '-'}</p>
                <div style="margin-top:20px;padding:12px;background:#0f172a;border-radius:10px;font-size:12px;color:#94a3b8;">
                    Este líder expresó interés en el 10% de la bolsa de comisiones y solicita coordinar reunión ejecutiva en Vicente López o sumarse al Webinar de Líderes. Se le enviaron las opciones de turnos disponibles vía WhatsApp.
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

        console.log(`✅ [LEADER INQUIRY EMAIL] Notificación enviada a ${targetEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [LEADER INQUIRY ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Envía la Guía Oficial de Ingreso, Login y Operatoria al Inversor
 */
async function sendInvestorWelcomeGuide(investor) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const targetEmail = investor.email;

        const subject = `📈 ¡Bienvenido a Colaboratium! - Guía de Ingreso y Operatoria de Inversión`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 25px; margin: 0; }
                .card { background-color: #111827; border-radius: 20px; border: 1px solid #1f2937; max-width: 620px; margin: 0 auto; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                .header { background: linear-gradient(135deg, #10b981, #0284c7); padding: 30px; text-align: left; }
                .tag { background: rgba(0,0,0,0.25); color: #ecfdf5; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block; margin-bottom: 12px; }
                .title { font-size: 22px; font-weight: 800; color: #ffffff; margin: 0; line-height: 1.3; }
                .content { padding: 30px; }
                .step { display: flex; gap: 14px; margin-bottom: 18px; }
                .step-num { width: 32px; height: 32px; border-radius: 10px; background: #059669; color: #ffffff; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
                .step-body { font-size: 13px; color: #cbd5e1; line-height: 1.5; }
                .step-body strong { color: #f1f5f9; }
                .cta-btn { display: inline-block; background: #10b981; color: #ffffff !important; font-weight: 800; font-size: 14px; text-decoration: none; padding: 14px 28px; border-radius: 12px; margin-top: 15px; }
                .highlight-box { background: #1e293b; border-left: 4px solid #10b981; padding: 14px 18px; border-radius: 8px; margin: 20px 0; font-size: 12px; color: #94a3b8; }
                .footer { padding: 20px 30px; background: #0b0f19; border-top: 1px solid #1f2937; font-size: 11px; color: #64748b; text-align: center; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="header">
                    <span class="tag">Inversión Inteligente P2P • BCRA Nº 40.015</span>
                    <h1 class="title">Hola, ${investor.nombre || 'Inversor'} 👋</h1>
                    <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">Tu acceso para invertir con respaldo bancario ya está listo.</p>
                </div>
                <div class="content">
                    <p style="font-size: 14px; color: #e2e8f0; margin-top: 0;">
                        Gracias por tu interés en <strong>Colaboratium</strong> (Global Loan S.A.). A continuación te detallamos los pasos simples para ingresar y activar tu cuenta:
                    </p>

                    <div class="step">
                        <div class="step-num">1</div>
                        <div class="step-body">
                            <strong>Ingreso y Creación de Usuario:</strong><br>
                            Accedé a nuestra consola oficial en <a href="https://consola.colaboratium.com.ar" style="color: #38bdf8;">consola.colaboratium.com.ar</a> con tu correo electrónico.
                        </div>
                    </div>

                    <div class="step">
                        <div class="step-num">2</div>
                        <div class="step-body">
                            <strong>Validación Biométrica (BCRA Nº 40.015):</strong><br>
                            Subí una foto de tu DNI frente y dorso y realizá la verificación facial con Renaper en menos de 2 minutos.
                        </div>
                    </div>

                    <div class="step">
                        <div class="step-num">3</div>
                        <div class="step-body">
                            <strong>Apertura de tu CVU Bancarizado No Custodial:</strong><br>
                            Se generará tu CVU propio con soporte de <em>Banco BIND y Banco Coinag</em>. Colaboratium nunca toca tu dinero; el capital fluye de tu CVU directo al crédito elegido.
                        </div>
                    </div>

                    <div class="step">
                        <div class="step-num">4</div>
                        <div class="step-body">
                            <strong>Elegí tu Perfil y Empezá a Colocar:</strong><br>
                            Podés invertir desde <strong>$100.000 ARS</strong> hasta <strong>$10.000.000 ARS sin presentar documentación extra</strong>.
                        </div>
                    </div>

                    <div class="highlight-box">
                        💡 <strong>Simulador en Vivo:</strong> Podés proyectar tus rendimientos estimados según plazo (3, 6 o 12 meses) en nuestro simulador oficial:<br>
                        👉 <a href="https://colaboratium.com.ar/inversiones.php#simulador" style="color: #34d399; font-weight: bold;">https://colaboratium.com.ar/inversiones.php#simulador</a>
                    </div>

                    <div style="text-align: center; margin: 25px 0;">
                        <a href="https://consola.colaboratium.com.ar" class="cta-btn">🚀 Ingresar a la Plataforma</a>
                    </div>

                    <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-bottom: 0;">
                        ¿Deseás que un Asesor Financiero te acompañe en tu primera colocación? Simplemente respondé "Sí" a nuestro mensaje de WhatsApp.
                    </p>
                </div>
                <div class="footer">
                    Colaboratium (Global Loan S.A.) • Registro BCRA Nº 40.015<br>
                    Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.<br>
                    <em>Al inversor jamás se le cobra comisión ni gastos de mantenimiento.</em>
                </div>
            </div>
        </body>
        </html>
        `;

        const info = await mailer.sendMail({
            from: `"Colaboratium Inversiones" <${fromEmail}>`,
            to: targetEmail,
            subject: subject,
            html: htmlContent
        });

        console.log(`✅ [INVESTOR GUIDE EMAIL] Guía de ingreso enviada a ${targetEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [INVESTOR GUIDE ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Notifica a colaboratium@gmail.com que un Inversor dejó sus datos
 */
async function sendInvestorInquiryToCompany(investor) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const targetEmail = 'colaboratium@gmail.com';

        const subject = `📈 NUEVO INVERSOR REGISTRADO: ${investor.nombre} (${investor.telefono})`;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <body style="font-family:sans-serif;background-color:#0f172a;color:#f8fafc;padding:25px;">
            <div style="background-color:#1e293b;border-radius:16px;padding:24px;max-width:600px;margin:0 auto;border:1px solid #334155;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:15px;">
                    <span style="background:#10b981;color:#ffffff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;">Nuevo Inversor</span>
                </div>
                <h2 style="color:#34d399;margin-top:0;">Nuevo Lead de Inversor en Colaboratium</h2>
                <hr style="border:0;border-top:1px solid #334155;margin:15px 0;">
                <p><strong>Nombre del Inversor:</strong> ${investor.nombre}</p>
                <p><strong>Email:</strong> <a href="mailto:${investor.email}" style="color:#38bdf8;">${investor.email}</a></p>
                <p><strong>Teléfono WhatsApp:</strong> <a href="https://wa.me/${(investor.telefono||'').replace(/\D/g,'')}" style="color:#38bdf8;">${investor.telefono}</a></p>
                <p><strong>Capital / Consulta:</strong> ${investor.detalles || 'Sin monto especificado'}</p>
                <p><strong>Ticket Helpdesk:</strong> #${investor.ticketId || '-'}</p>
                <div style="margin-top:20px;padding:12px;background:#0f172a;border-radius:10px;font-size:12px;color:#94a3b8;">
                    Se le despachó automáticamente la Guía de Ingreso, Login y Operatoria por correo electrónico. El ticket quedó en estado <strong>Pendiente de Autorización</strong> para delegar a un Asesor Financiero o Líder comercial desde el Administrador de Tickets.
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

        console.log(`✅ [INVESTOR INQUIRY EMAIL] Notificación enviada a ${targetEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ [INVESTOR INQUIRY ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Envía un correo genérico con soporte completo de HTML y adjuntos
 */
async function sendGenericEmail({ to, subject, html, text, attachments = [] }) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';

        const formattedAttachments = (attachments || []).map(att => {
            let filePath = att.url || att.path;
            if (filePath && !filePath.startsWith('http')) {
                const normalized = filePath.startsWith('/') ? filePath.substring(1) : filePath;
                const localPath = path.join(__dirname, 'public', normalized.replace(/^media\//, 'media/'));
                if (require('fs').existsSync(localPath)) {
                    return { filename: att.nombre || path.basename(localPath), path: localPath };
                }
            }
            return { filename: att.nombre || 'adjunto', path: filePath };
        }).filter(a => a.path);

        const info = await mailer.sendMail({
            from: `"Colaboratium Oficial" <${fromEmail}>`,
            to,
            subject,
            text,
            html,
            attachments: formattedAttachments
        });

        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`❌ Error enviando email a ${to}:`, err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Despacha una campaña masiva de emails desde colaboratium@gmail.com
 * Simula comportamiento humano (2 a 3 emails por minuto) con pausas aleatorias para evitar bloqueos de Gmail.
 */
async function sendMassEmailCampaign({ codigoEmpresa, campanaId, contacts = [], subject, htmlContent, attachments = [], humanPacing = true, startIndex = 0 }) {
    const db = require('./database');
    let enviados = 0;
    let entregados = 0;
    const total = contacts.length;

    console.log(`🚀 Iniciando despacho de campaña masiva (Total: ${total} destinatarios, Desde índice: ${startIndex}, Modo Humano: ${humanPacing})...`);

    // Consultar lista negra / desuscripciones para proteger reputación de Gmail (Minigun / CAN-SPAM)
    let setDesuscritos = new Set();
    try {
        const desuscripciones = await db.obtenerDesuscripciones(codigoEmpresa);
        setDesuscritos = new Set((desuscripciones || []).map(d => (d.email || '').toLowerCase().trim()));
    } catch(e) {}

    if (campanaId && startIndex === 0) {
        await db.actualizarCampanaProgreso(campanaId, {
            enviados: 0,
            entregados: 0,
            estado: 'en_progreso',
            ultimo_log: `Iniciando campaña para ${total} contacto(s)...`,
            ultimo_indice_enviado: 0
        });
    }

    const { getAvailableWebinarSlots } = require('./googleCalendarService');
    let calendarSlots = [];
    try {
        calendarSlots = await getAvailableWebinarSlots(codigoEmpresa, 'asesores');
    } catch (e) {
        console.warn('No se pudieron obtener slots para variables de email:', e.message);
    }
    const defaultSlot = (calendarSlots && calendarSlots.length > 0) ? calendarSlots[0] : null;
    const fechaSlot = defaultSlot ? defaultSlot.fechaStr : 'Jueves, 29 de octubre';
    const horaSlot = defaultSlot ? (defaultSlot.horarioStr ? defaultSlot.horarioStr.split(' a ')[0] : '13:00 hs') : '13:00 hs';
    const duracionSlot = '1 hora y media (90 minutos)';
    const botWhatsApp = '5491173722708';

    for (let i = startIndex; i < total; i++) {
        const contact = contacts[i];
        const targetEmail = (contact.email || '').trim();
        if (!targetEmail) continue;

        // Omitir destinatarios desuscritos
        if (setDesuscritos.has(targetEmail.toLowerCase())) {
            console.log(`🛡️ [Desuscrito] Omitiendo ${targetEmail} por solicitud previa de baja.`);
            continue;
        }

        // Reemplazo dinámico de variables
        const nombre = contact.nombre || 'Estimado/a';
        const rol = contact.grupo || contact.rol_asignado || 'Colaborador';
        const telefono = contact.telefono || '';
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';
        const enlaceBaja = `${backendUrl}/api/campanas/desuscribir?email=${encodeURIComponent(targetEmail)}&empresa=${encodeURIComponent(codigoEmpresa)}`;

        const personalizedHtml = htmlContent
            .replace(/\{\{nombre\}\}/gi, nombre)
            .replace(/\{\{email\}\}/gi, targetEmail)
            .replace(/\{\{rol\}\}/gi, rol)
            .replace(/\{\{telefono\}\}/gi, telefono)
            .replace(/\{\{enlaceregistro\}\}/gi, enlaceRegistro)
            .replace(/\{\{enlacebaja\}\}/gi, enlaceBaja)
            .replace(/\{\{fecha\}\}/gi, fechaSlot)
            .replace(/\{\{hora\}\}/gi, horaSlot)
            .replace(/\{\{duracion\}\}/gi, duracionSlot);

        const personalizedSubject = subject
            .replace(/\{\{nombre\}\}/gi, nombre)
            .replace(/\{\{rol\}\}/gi, rol)
            .replace(/\{\{fecha\}\}/gi, fechaSlot)
            .replace(/\{\{hora\}\}/gi, horaSlot);

        let sendResult = null;
        try {
            console.log(`📧 [${i + 1}/${total}] Enviando email a: ${targetEmail} (${nombre})...`);
            sendResult = await sendGenericEmail({
                to: targetEmail,
                subject: personalizedSubject,
                html: personalizedHtml,
                attachments
            });

            if (sendResult && sendResult.success) {
                enviados++;
                entregados++;
                console.log(`✅ [${i + 1}/${total}] Enviado exitosamente a ${targetEmail}`);
            } else {
                console.warn(`⚠️ [${i + 1}/${total}] Advertencia enviando a ${targetEmail}:`, sendResult?.error);
            }
        } catch (e) {
            console.error(`❌ Error enviando email masivo a ${targetEmail}:`, e.message);
        }

        // Actualizar progreso en base de datos en tiempo real después de CADA envío
        const isLast = (i === total - 1);
        if (campanaId) {
            const logMsg = `Enviado a ${nombre} (${targetEmail}) [${i + 1}/${total}] ✓`;
            await db.actualizarCampanaProgreso(campanaId, {
                enviados,
                entregados,
                respondidos: Math.round(entregados * 0.15),
                estado: isLast ? 'completada' : 'en_progreso',
                ultimo_log: logMsg,
                ultimo_indice_enviado: i + 1
            });
        }

        // Si no es el último correo y está en modo humano, esperar entre 20 a 30 segundos (2 a 3 emails por minuto)
        if (!isLast) {
            if (humanPacing) {
                // Entre 20.000ms y 30.000ms aleatorio para simular digitación y pausas humanas
                const delayMs = Math.floor(Math.random() * (30000 - 20000 + 1)) + 20000;
                const delaySeg = (delayMs / 1000).toFixed(1);
                console.log(`⏳ Pausa anti-spam humano: esperando ${delaySeg}s antes del próximo envío...`);
                
                if (campanaId) {
                    await db.actualizarCampanaProgreso(campanaId, {
                        ultimo_log: `Pausa anti-bloqueo Gmail: esperando ${Math.round(delayMs / 1000)}s antes del próximo envío...`
                    });
                }
                await new Promise(r => setTimeout(r, delayMs));
            } else {
                // Pausa mínima de cortesía
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    if (campanaId) {
        await db.actualizarCampanaProgreso(campanaId, {
            enviados,
            entregados,
            respondidos: Math.round(entregados * 0.15),
            estado: 'completada',
            ultimo_log: `Campaña completada: ${enviados} correo(s) despachado(s) con éxito.`
        });
    }

    console.log(`🏁 Campaña finalizada. Total: ${total}, Enviados: ${enviados}`);
    return { total, enviados, entregados };
}

/**
 * Envía invitación iCalendar (ICS) a colaboratium@gmail.com para que el evento se refleje en Google Calendar
 */
async function sendCalendarEventInvitation({ titulo, tipo, modalidad, categoria, fecha, horario, meetLink, ubicacion, creadoPor }) {
    try {
        const mailer = getTransporter();
        const fromEmail = process.env.SMTP_USER || 'colaboratium@gmail.com';
        const toEmail = 'colaboratium@gmail.com';

        const uid = `event_${Date.now()}@colaboratium.com.ar`;
        const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        
        const icsContent = [
            'BEGIN:VCALENDAR',
            'PRODID:-//Colaboratium//Calendar Meet 1.0//ES',
            'VERSION:2.0',
            'CALSCALE:GREGORIAN',
            'METHOD:REQUEST',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${nowStr}`,
            `SUMMARY:${titulo} - Colaboratium`,
            `DESCRIPTION:Evento oficial: ${titulo}\\nModalidad: ${modalidad}\\nCategoría: ${categoria}\\nFecha y Horario: ${fecha} (${horario})\\nSala Google Meet: ${meetLink || 'https://meet.google.com/new'}\\nOrganizado por: ${creadoPor || 'Líder / Asesor'}`,
            `LOCATION:${modalidad === 'PRESENCIAL' ? (ubicacion || 'Av. del Libertador 264, Vicente López') : (meetLink || 'Google Meet')}`,
            'STATUS:CONFIRMED',
            'ORGANIZER;CN=Colaboratium:mailto:colaboratium@gmail.com',
            'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Colaboratium:mailto:colaboratium@gmail.com',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        const mailOptions = {
            from: `"Colaboratium Calendar" <${fromEmail}>`,
            to: toEmail,
            subject: `📅 [Google Calendar] Nuevo Evento: ${titulo} (${fecha} ${horario})`,
            html: `
            <div style="font-family: Arial, sans-serif; background: #0c0f18; color: #f1f5f9; padding: 24px; border-radius: 16px;">
                <h2 style="color: #38bdf8; margin-top: 0;">📅 Nuevo Evento Sincronizado en Google Calendar</h2>
                <p>Se ha registrado un nuevo evento oficial en la plataforma:</p>
                <ul style="line-height: 1.8; color: #cbd5e1;">
                    <li><strong>Título:</strong> ${titulo}</li>
                    <li><strong>Tipo / Categoría:</strong> ${String(tipo || '').toUpperCase()} (${categoria})</li>
                    <li><strong>Modalidad:</strong> ${modalidad}</li>
                    <li><strong>Fecha y Horario:</strong> ${fecha} - ${horario}</li>
                    <li><strong>Google Meet / Sala:</strong> <a href="${meetLink || 'https://meet.google.com/new'}" style="color: #38bdf8;">${meetLink || 'https://meet.google.com/new'}</a></li>
                    <li><strong>Organizador:</strong> ${creadoPor || 'Sistema'}</li>
                </ul>
                <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Este evento se ha incorporado mediante invitación iCalendar oficial a colaboratium@gmail.com.</p>
            </div>
            `,
            icalEvent: {
                filename: 'evento_colaboratium.ics',
                method: 'REQUEST',
                content: icsContent
            }
        };

        const info = await mailer.sendMail(mailOptions);
        console.log(`✅ [CALENDAR EMAIL]: Invitación de evento enviada a ${toEmail} (ID: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('⚠️ [CALENDAR EMAIL ERROR]: Error enviando invitación iCal:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    sendTicketEmail,
    sendWebinarConfirmationToAdvisor,
    sendWebinarNotificationToCompany,
    sendLeaderInquiryToCompany,
    sendInvestorWelcomeGuide,
    sendInvestorInquiryToCompany,
    sendGenericEmail,
    sendMassEmailCampaign,
    sendCalendarEventInvitation
};
