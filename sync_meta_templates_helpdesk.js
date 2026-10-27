const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./database');
const { sendGenericEmail } = require('./emailService');

async function syncMetaTemplatesAndCreateHelpdeskEvents() {
    await db.initDB();
    const codigoEmpresa = 'KRZMJI';
    const wabaId = process.env.WAPP_BUSINESS_ACCOUNT_ID;
    const token = process.env.WAPP_ACCESS_TOKEN;

    console.log('================================================================');
    console.log('🔍 CONSULTANDO ESTADO DE PLANTILLAS EN META CLOUD API...');
    console.log(`📱 WABA ID: ${wabaId}`);
    console.log('================================================================');

    const res = await axios.get(`https://graph.facebook.com/v19.0/${wabaId}/message_templates?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const templates = res.data?.data || [];
    console.log(`✅ Total de plantillas recuperadas de Meta: ${templates.length}\n`);

    const colaboratiumTemplates = [
        'bienvenida_asesores_colaboratium',
        'convocatoria_lideres_de_equipo',
        'simulador_y_propuesta_inversores',
        'reunion_informativa_asesores'
    ];

    const results = [];

    for (const t of templates) {
        const isColaboratium = colaboratiumTemplates.includes(t.name);
        console.log(`📋 Plantilla: "${t.name}" (ID: ${t.id})`);
        console.log(`   • Estado en Meta: ${t.status}`);
        console.log(`   • Categoría: ${t.category}`);
        console.log(`   • Idioma: ${t.language}`);

        if (isColaboratium || t.status === 'APPROVED') {
            // Verificar si ya existe ticket de evento en Helpdesk para esta plantilla
            const [existingTickets] = await db.pool.query(
                `SELECT id, status, summary FROM tickets 
                 WHERE codigo_empresa = ? AND (customer_number = ? OR summary LIKE ?)`,
                [codigoEmpresa, String(t.id), `%${t.name}%`]
            );

            let ticketId = null;
            if (existingTickets.length === 0) {
                const summary = t.status === 'APPROVED'
                    ? `🎉 Plantilla WhatsApp Aprobada por Meta: ${t.name} (Meta ID: ${t.id}) - Lista para Envíos Masivos`
                    : `⚠️ Plantilla WhatsApp ${t.status} por Meta: ${t.name} (Meta ID: ${t.id})`;

                ticketId = await db.crearTicket(
                    codigoEmpresa,
                    null,
                    String(t.id),
                    'Meta Cloud API',
                    t.status === 'APPROVED' ? 'resolved' : 'open',
                    summary,
                    null,
                    'Soporte'
                );

                // Asignar prioridad alta y categoría Meta
                await db.pool.query(
                    `UPDATE tickets SET priority = 'alta', category = 'Meta WhatsApp', internal_notes = ? WHERE id = ?`,
                    [`Aprobada por Meta Graph API v19.0 el ${new Date().toLocaleString('es-AR')}. Categoría: ${t.category}.`, ticketId]
                );

                console.log(`   🎟️ [HELPDESK] Ticket #${ticketId} creado exitosamente.`);

                // Registrar en Auditoría
                try {
                    await db.registrarAuditLog({
                        codigo_empresa: codigoEmpresa,
                        usuario_email: 'meta-cloud@routhagent.com',
                        usuario_nombre: 'Meta Cloud API',
                        rol: 'Sistema',
                        accion: `PLANTILLA_META_${t.status}`,
                        entidad: 'whatsapp_template',
                        entidad_id: String(t.id),
                        detalles: `Plantilla "${t.name}" verificada en Meta con estado ${t.status}. Ticket Helpdesk #${ticketId}.`,
                        google_scope: 'colaboratium@gmail.com'
                    });
                    console.log(`   📑 [AUDIT LOG] Registrado en historial.`);
                } catch(e) {}
            } else {
                ticketId = existingTickets[0].id;
                console.log(`   ℹ️ [HELPDESK] Ticket existente: #${ticketId} (${existingTickets[0].summary})`);
            }

            results.push({
                name: t.name,
                id: t.id,
                status: t.status,
                category: t.category,
                ticketId
            });
        }
        console.log('----------------------------------------------------------------');
    }

    // Enviar notificación consolidada por email a la casilla oficial colaboratium@gmail.com
    try {
        const approvedCount = results.filter(r => r.status === 'APPROVED').length;
        await sendGenericEmail({
            to: 'colaboratium@gmail.com',
            subject: `📢 [Helpdesk Routh Agent] ${approvedCount} Plantillas de WhatsApp Aprobadas por Meta`,
            text: `Estimado equipo de Colaboratium:\n\nLes confirmamos que Meta Cloud API ha aprobado las siguientes plantillas oficiales de WhatsApp para Colaboratium:\n\n` +
                results.map(r => `• ${r.name} (ID: ${r.id}) -> Estado: ${r.status} (Ticket Helpdesk #${r.ticketId})`).join('\n') +
                `\n\nYa están disponibles en el Dashboard de Campañas para envíos masivos y conversaciones directas.`,
            html: `<h3>📢 Notificación de Helpdesk: Plantillas de WhatsApp Aprobadas</h3>
                <p>Estimado equipo de <b>Colaboratium</b>:</p>
                <p>Les confirmamos que Meta Cloud API ha aprobado las plantillas oficiales de WhatsApp:</p>
                <ul>
                ${results.map(r => `<li><b>${r.name}</b> (ID: <code>${r.id}</code>) &rarr; <span style="color: green; font-weight: bold;">${r.status}</span> (Ticket Helpdesk #${r.ticketId})</li>`).join('')}
                </ul>
                <p>Ya pueden utilizarlas en el <a href="http://localhost:3000/dashboard/campaigns">Dashboard de Campañas</a> para envíos masivos o individuales.</p>`
        });
        console.log(`📧 [EMAIL] Notificación enviada a colaboratium@gmail.com`);
    } catch(e) {
        console.error('Error enviando email consolidado:', e.message);
    }

    console.log('\n================================================================');
    console.log('🎉 SINCRONIZACIÓN DE PLANTILLAS Y EVENTOS HELPDESK COMPLETADA');
    console.log('================================================================');
    process.exit(0);
}

syncMetaTemplatesAndCreateHelpdeskEvents().catch(err => {
    console.error('❌ Error en sincronización:', err);
    process.exit(1);
});
