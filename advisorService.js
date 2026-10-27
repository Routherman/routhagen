const db = require('./database');
const axios = require('axios');

async function sendWhatsAppMessage(to, text, phoneId, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
        const res = await axios.post(url, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: { preview_url: false, body: text }
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        return res.data?.messages?.[0]?.id || `sim_${Date.now()}`;
    } catch (err) {
        console.error('Error enviando WhatsApp en advisorService:', err.response?.data || err.message);
        return `err_${Date.now()}`;
    }
}

/**
 * Gestiona consultas operativas de Asesores Comerciales:
 * 1. Precarga de inversores no visibles: solicita datos (nombre, apellido, DNI, email), busca en CRM y si no está asignado abre ticket derivando al Líder.
 * 2. Reclamo de comisiones: abre ticket y deriva a su Líder.
 * 3. Regla general: la mayoría de las consultas operativas se derivan a su Líder.
 */
async function handleAdvisorDirectQuery(dbContacto, cleanMessage, empresa, accessToken, phoneId, history = []) {
    const userText = (cleanMessage.contenido || '').trim().toLowerCase();
    const codigoEmpresa = empresa.codigo || 'KRZMJI';
    const isAdvisor = dbContacto.rol_asignado?.toLowerCase() === 'asesores' || 
                      dbContacto.grupo?.toUpperCase() === 'ASESORES' ||
                      /asesor|comision|inversor cliente|precarga/i.test(userText);

    // Leer metadatos del contacto para saber si estábamos esperando datos del inversor
    let metadata = dbContacto.metadata_extra;
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch(e) { metadata = {}; }
    } else if (!metadata) {
        metadata = {};
    }

    const isWaitingForInvestorData = !!metadata.esperando_datos_inversor_reasignacion;

    // 1. CASO A: ASESOR PREGUNTA POR PRECARGA DE UN INVERSOR QUE NO VE EN SU LISTA
    const isPrecargaInquiry = /precarga|link de precarga|no (lo )?veo en mis inversores|no veo a mi inversor|inversor cliente mio|no me aparece el inversor|cargue un inversor/i.test(userText);

    if (isPrecargaInquiry && !isWaitingForInvestorData) {
        // Verificar si ya envió los datos en el mismo mensaje (ej: DNI o Email)
        const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(userText);
        const hasDni = /\b\d{7,9}\b/.test(userText);

        if (!hasEmail && !hasDni) {
            // Guardar flag de espera
            metadata.esperando_datos_inversor_reasignacion = true;
            await db.pool.query(
                'UPDATE contactos SET metadata_extra = ? WHERE id = ?',
                [JSON.stringify(metadata), dbContacto.id]
            );

            const reply = 'Por favor decime sus datos: *Nombre y Apellido, DNI y Correo Electrónico* que lo busco en la base de datos para verificar su asignación.';
            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, reply, phoneId, accessToken);
            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', reply);
            return true;
        }
    }

    // 2. CASO B: EL ASESOR ENVÍA LOS DATOS DEL INVERSOR (O ESTÁBAMOS ESPERÁNDOLOS)
    if (isWaitingForInvestorData || (isPrecargaInquiry && (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(userText) || /\b\d{7,9}\b/.test(userText)))) {
        // Extraer datos del inversor
        const emailMatch = userText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const dniMatch = userText.match(/\b\d{7,9}\b/);
        const detectedEmail = emailMatch ? emailMatch[0].toLowerCase() : null;
        const detectedDni = dniMatch ? dniMatch[0] : null;

        // Limpiar flag
        delete metadata.esperando_datos_inversor_reasignacion;
        await db.pool.query(
            'UPDATE contactos SET metadata_extra = ? WHERE id = ?',
            [JSON.stringify(metadata), dbContacto.id]
        );

        // Buscar en la base de datos de contactos
        let inversorEncontrado = null;
        try {
            if (detectedEmail || detectedDni) {
                const [rows] = await db.pool.query(
                    `SELECT * FROM contactos 
                     WHERE codigo_empresa = ? 
                       AND (
                         (? IS NOT NULL AND email = ?) 
                         OR (? IS NOT NULL AND dni = ?)
                       )
                     LIMIT 1`,
                    [codigoEmpresa, detectedEmail, detectedEmail, detectedDni, detectedDni]
                );
                if (rows && rows.length > 0) inversorEncontrado = rows[0];
            }
        } catch (searchErr) {
            console.error('Error buscando inversor en BD:', searchErr.message);
        }

        const isAssignedToThisAdvisor = inversorEncontrado && (
            inversorEncontrado.asesor_id === dbContacto.id || 
            inversorEncontrado.usuario_asignado_id === dbContacto.id ||
            inversorEncontrado.usuario_asignado_id === dbContacto.identificador_valor
        );

        if (inversorEncontrado && isAssignedToThisAdvisor) {
            // El inversor ya está asignado a este asesor
            const reply = `¡Encontré al inversor *${inversorEncontrado.nombre}*! Ya se encuentra correctamente asignado a tu cartera comercial. Podés visualizarlo ingresando a tu consola de asesor.`;
            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, reply, phoneId, accessToken);
            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', reply);
            return true;
        } else {
            // No está asignado a este asesor o no existe -> Crear ticket de Reasignación de Inversor y derivar a Líder
            const datosStr = inversorEncontrado 
                ? `${inversorEncontrado.nombre} (DNI ${inversorEncontrado.dni || 'S/D'}, ${inversorEncontrado.email || 'S/D'})` 
                : (cleanMessage.contenido.replace(/\n/g, ' '));

            let ticketId = null;
            try {
                ticketId = await db.crearTicket(
                    codigoEmpresa,
                    dbContacto.id,
                    cleanMessage.identificador.valor,
                    dbContacto.nombre || 'Asesor Comercial',
                    'open',
                    `Reasignación de Inversor: ${datosStr} - Solicitado por Asesor ${dbContacto.nombre || cleanMessage.remitente}`,
                    null,
                    'Líderes'
                );

                await db.registrarAuditLog({
                    codigo_empresa: codigoEmpresa,
                    usuario_id: dbContacto.id ? String(dbContacto.id) : null,
                    usuario_nombre: dbContacto.nombre || 'Asesor Comercial',
                    rol: 'Asesores',
                    accion: 'CREAR_TICKET_REASIGNACION',
                    entidad: 'tickets',
                    entidad_id: ticketId ? String(ticketId) : null,
                    detalles: `Ticket #${ticketId} de reasignación de inversor generado y derivado a Líder Comercial. Datos inversor: ${datosStr}`
                });
            } catch (tErr) {
                console.error('Error creando ticket de reasignación:', tErr.message);
            }

            // Derivar a humano líder y poner en PENDIENTE
            await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
            await db.actualizarAsignacionContacto(dbContacto.id, 'Lideres');

            const reply = `He verificado en la base de datos y el inversor no figura asignado a tu cuenta. He generado el *Ticket de Reasignación de Inversor #${ticketId || ''}* y lo derivé directamente a tu Líder Comercial para su verificación y asignación. En breve se comunicarán contigo.`;
            const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, reply, phoneId, accessToken);
            await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', reply);
            return true;
        }
    }

    // 3. CASO C: RECLAMO DE COMISIONES
    const isCommissionsComplaint = /no (me )?(pagaron|pago|pagan|liquidaron|acreditaron) comision|comisiones impagas|falta pago de comision|no cobre comision|no me liquidaron|cuando me pagan las comisiones/i.test(userText);
    if (isCommissionsComplaint) {
        let ticketId = null;
        try {
            ticketId = await db.crearTicket(
                codigoEmpresa,
                dbContacto.id,
                cleanMessage.identificador.valor,
                dbContacto.nombre || 'Asesor Comercial',
                'open',
                `Reclamo de Comisiones: Asesor ${dbContacto.nombre || cleanMessage.remitente} reclama pago/liquidación de comisiones`,
                null,
                'Líderes'
            );

            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: dbContacto.id ? String(dbContacto.id) : null,
                usuario_nombre: dbContacto.nombre || 'Asesor Comercial',
                rol: 'Asesores',
                accion: 'CREAR_TICKET_COMISIONES',
                entidad: 'tickets',
                entidad_id: ticketId ? String(ticketId) : null,
                detalles: `Ticket #${ticketId} de reclamo de comisiones generado y derivado a Líder Comercial.`
            });
        } catch (tErr) {
            console.error('Error creando ticket comisiones:', tErr.message);
        }

        await db.actualizarEstadoBot(dbContacto.id, 'HANDOFF');
        await db.actualizarAsignacionContacto(dbContacto.id, 'Lideres');

        const reply = `He registrado tu consulta sobre liquidación de comisiones. He generado el *Ticket #${ticketId || ''}* derivándolo directamente a tu Líder Comercial para su seguimiento y revisión con Administración. En breve se comunicará contigo.`;
        const outMetaId = await sendWhatsAppMessage(cleanMessage.identificador.valor, reply, phoneId, accessToken);
        await db.guardarMensaje(dbContacto.id, outMetaId, 'SALIENTE', 'text', reply);
        return true;
    }

    return false;
}

module.exports = {
    handleAdvisorDirectQuery
};
