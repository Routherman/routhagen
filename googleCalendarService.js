const fs = require('fs');
const path = require('path');
const db = require('./database');
const { sendWebinarConfirmationToAdvisor, sendWebinarNotificationToCompany } = require('./emailService');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Intento opcional de cargar googleapis
let google = null;
try {
    const g = require('googleapis');
    google = g.google;
} catch (e) {
    // googleapis opcional
}

/**
 * Eventos base obtenidos del Google Calendar oficial de Colaboratium (Damian Feuermann)
 * Mostrados en la consola y sincronizados con la captura de pantalla:
 * - Lunes 26 Oct: 10:30-12:00 (Virtual), 12:30-14:00 (Virtual), 14:30-16:00 (Virtual)
 * - Miércoles 28 Oct: 10:30-12:00 (Virtual), 14:30-16:00 (Presencial en oficinas)
 * - Viernes 30 Oct: 12:00-13:30 (Virtual)
 */
const DEFAULT_SLOTS = [
    {
        id: 1,
        titulo: 'Webinar Virtual de Capacitación',
        modalidad: 'VIRTUAL',
        fechaStr: 'Lunes 26 de Octubre',
        horarioStr: '10:30 a 12:00 hs',
        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
        ubicacion: 'Google Meet',
        cupos: 25
    },
    {
        id: 2,
        titulo: 'Webinar Virtual de Capacitación',
        modalidad: 'VIRTUAL',
        fechaStr: 'Lunes 26 de Octubre',
        horarioStr: '12:30 a 14:00 hs',
        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
        ubicacion: 'Google Meet',
        cupos: 25
    },
    {
        id: 3,
        titulo: 'Webinar Virtual de Capacitación',
        modalidad: 'VIRTUAL',
        fechaStr: 'Lunes 26 de Octubre',
        horarioStr: '14:30 a 16:00 hs',
        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
        ubicacion: 'Google Meet',
        cupos: 25
    },
    {
        id: 4,
        titulo: 'Webinar Virtual de Capacitación',
        modalidad: 'VIRTUAL',
        fechaStr: 'Miércoles 28 de Octubre',
        horarioStr: '10:30 a 12:00 hs',
        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
        ubicacion: 'Google Meet',
        cupos: 25
    },
    {
        id: 5,
        titulo: 'Reunión Presencial de Asesores',
        modalidad: 'PRESENCIAL',
        fechaStr: 'Miércoles 28 de Octubre',
        horarioStr: '14:30 a 16:00 hs',
        meetLink: null,
        ubicacion: 'Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires',
        cupos: 15
    },
    {
        id: 6,
        titulo: 'Webinar Virtual de Capacitación',
        modalidad: 'VIRTUAL',
        fechaStr: 'Viernes 30 de Octubre',
        horarioStr: '12:00 a 13:30 hs',
        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
        ubicacion: 'Google Meet',
        cupos: 25
    }
];

async function getAvailableWebinarSlots(codigoEmpresa = 'KRZMJI') {
    let rawSlots = [];

    // 1. Lectura en tiempo real desde la Dirección Secreta iCal de Google Calendar
    const icalUrl = process.env.GOOGLE_CALENDAR_ICAL_URL;
    if (icalUrl) {
        try {
            const ical = require('node-ical');
            const events = await ical.async.fromURL(icalUrl);
            const liveEvents = [];
            for (const k in events) {
                const ev = events[k];
                if (ev && ev.type === 'VEVENT') {
                    const summary = (ev.summary || '').toLowerCase();
                    if (summary.includes('webinar') || summary.includes('capacitacion') || summary.includes('asesor') || summary.includes('presencial')) {
                        liveEvents.push(ev);
                    }
                }
            }

            if (liveEvents.length > 0) {
                liveEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
                rawSlots = liveEvents.map((ev, index) => {
                    const isPresencial = (ev.summary || '').toLowerCase().includes('presencial');
                    const start = new Date(ev.start);
                    const end = new Date(ev.end);
                    const fechaStr = start.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
                    const horaInicio = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
                    const horaFin = end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

                    return {
                        id: index + 1,
                        uid: ev.uid,
                        titulo: ev.summary || (isPresencial ? 'Reunión Presencial de Asesores' : 'Webinar Virtual de Capacitación'),
                        modalidad: isPresencial ? 'PRESENCIAL' : 'VIRTUAL',
                        fechaStr: fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1),
                        horarioStr: `${horaInicio} a ${horaFin} hs`,
                        meetLink: 'https://meet.google.com/qmv-wqzk-hxo',
                        ubicacion: isPresencial ? 'Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires' : 'Google Meet',
                        cupos: isPresencial ? 15 : 25,
                        subscribers: []
                    };
                });
            }
        } catch (e) {
            console.error('⚠️ [GOOGLE CALENDAR ICAL]: Error al leer eventos iCal en vivo:', e.message);
        }
    }

    if (!rawSlots || rawSlots.length === 0) {
        rawSlots = JSON.parse(JSON.stringify(DEFAULT_SLOTS));
    }

    // 2. Asociar inscriptos reales desde la base de datos
    if (db && !db.pool) {
        try { await db.initDB(); } catch(e) {}
    }
    console.log(`[Google Calendar] Asociando inscriptos para empresa: ${codigoEmpresa}, db.pool activo: ${!!(db && db.pool)}`);
    if (codigoEmpresa && db && db.pool) {
        try {
            const [cRows] = await db.pool.query(
                `SELECT c.id, c.nombre, c.telefono, c.email, c.dni, c.direccion, c.cbu, c.alias, c.banco, c.grupo, c.creado_en, c.metadata_extra,
                        t.id as ticket_id, t.status as ticket_status, t.summary as ticket_summary
                 FROM contactos c
                 LEFT JOIN tickets t ON (t.contacto_id = c.id OR t.customer_number = c.telefono)
                 WHERE c.codigo_empresa = ? AND (c.grupo = 'ASESORES' OR c.metadata_extra IS NOT NULL)
                 ORDER BY c.creado_en DESC`,
                [codigoEmpresa]
            );
            console.log(`[Google Calendar] Inscriptos encontrados en BD: ${cRows ? cRows.length : 0}`);

            // Obtener conteo de mensajes por contacto
            const [mRows] = await db.pool.query(
                "SELECT contacto_id, COUNT(*) as total_mensajes FROM mensajes GROUP BY contacto_id"
            );
            const msgMap = {};
            (mRows || []).forEach(m => { msgMap[m.contacto_id] = m.total_mensajes; });

            const enrichedContacts = (cRows || []).map(c => {
                let meta = c.metadata_extra;
                if (typeof meta === 'string') {
                    try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                } else if (!meta) {
                    meta = {};
                }
                return {
                    id: c.id,
                    nombre: c.nombre || 'Asesor Candidato',
                    telefono: c.telefono,
                    email: c.email || 'No registrado',
                    dni: c.dni || 'Sin registrar',
                    direccion: c.direccion || 'Sin registrar',
                    cbu: c.cbu || '',
                    alias: c.alias || '',
                    banco: c.banco || '',
                    grupo: c.grupo || 'ASESORES',
                    creado_en: c.creado_en,
                    slot_id: meta.slot_id ? Number(meta.slot_id) : null,
                    inscripcion_str: meta.inscripcion || c.ticket_summary || '',
                    ticket_id: c.ticket_id,
                    ticket_status: c.ticket_status || 'pending_auth',
                    ticket_summary: c.ticket_summary,
                    total_mensajes: msgMap[c.id] || 0,
                    canal: 'WhatsApp'
                };
            });

            // Deduplicar contactos por ID para que cada persona aparezca una sola vez con su ticket más reciente
            const seenIds = new Set();
            const uniqueContacts = [];
            for (const c of enrichedContacts) {
                if (!seenIds.has(c.id)) {
                    seenIds.add(c.id);
                    uniqueContacts.push(c);
                }
            }

            function normalizeStr(text) {
                return String(text || '').toLowerCase().replace(/[,.:()\-]/g, ' ').replace(/\s+/g, ' ').trim();
            }

            // Distribuir inscriptos en sus respectivos turnos de manera unívoca
            rawSlots.forEach(s => {
                s.subscribers = uniqueContacts.filter(c => {
                    if (c.slot_id) {
                        return Number(c.slot_id) === Number(s.id);
                    }
                    if (c.inscripcion_str) {
                        const cleanStr = normalizeStr(c.inscripcion_str);
                        const cleanFecha = normalizeStr(s.fechaStr);
                        const cleanHora = normalizeStr(s.horarioStr).split(' a ')[0];

                        // Coincidencia exacta de fecha y hora
                        if (cleanStr.includes(cleanFecha) && (cleanStr.includes(cleanHora) || s.id === 1)) {
                            return true;
                        }

                        // Coincidencia por modalidad presencial
                        if (s.modalidad === 'PRESENCIAL' && cleanStr.includes('presencial')) {
                            return true;
                        }
                    }
                    return false;
                });
                s.inscriptosCount = s.subscribers.length;
                s.cuposDisponibles = Math.max(0, (s.cupos || 25) - s.inscriptosCount);
            });

            // Si hay contactos asesores no emparejados, asignarlos únicamente al primer turno
            const unassigned = uniqueContacts.filter(c => !rawSlots.some(s => s.subscribers.some(sub => sub.id === c.id)));
            if (unassigned.length > 0 && rawSlots.length > 0) {
                unassigned.forEach(u => {
                    rawSlots[0].subscribers.push(u);
                });
                rawSlots[0].inscriptosCount = rawSlots[0].subscribers.length;
                rawSlots[0].cuposDisponibles = Math.max(0, (rawSlots[0].cupos || 25) - rawSlots[0].inscriptosCount);
            }
        } catch (err) {
            console.error('Error enriqueciendo slots con inscriptos:', err.message);
        }
    }

    return rawSlots;
}

/**
 * Genera la estructura de formulario/lista interactiva nativa de WhatsApp (Interactive List)
 */
async function formatInteractiveCalendarList(codigoEmpresa = 'KRZMJI') {
    const slots = await getAvailableWebinarSlots(codigoEmpresa);
    const virtualSlots = slots.filter(s => s.modalidad === 'VIRTUAL');
    const presencialSlots = slots.filter(s => s.modalidad === 'PRESENCIAL');

    const sections = [];

    if (virtualSlots.length > 0) {
        sections.push({
            title: "💻 WEBINAR VIRTUAL (MEET)",
            rows: virtualSlots.map(s => {
                const shortDia = s.fechaStr.split(',')[0].trim();
                const shortHora = s.horarioStr.split(' a ')[0].replace(/\s*[a-z.]+/gi, '').trim();
                return {
                    id: `slot_${s.id}`,
                    title: `Opción ${s.id}: ${shortDia} ${shortHora}hs`.substring(0, 24),
                    description: `${s.fechaStr} • Google Meet`.substring(0, 72)
                };
            })
        });
    }

    if (presencialSlots.length > 0) {
        sections.push({
            title: "🏢 REUNIÓN PRESENCIAL",
            rows: presencialSlots.map(s => {
                const shortDia = s.fechaStr.split(',')[0].trim();
                const shortHora = s.horarioStr.split(' a ')[0].replace(/\s*[a-z.]+/gi, '').trim();
                return {
                    id: `slot_${s.id}`,
                    title: `Opción ${s.id}: Presencial ${shortHora}hs`.substring(0, 24),
                    description: `${shortDia} • Vicente López`.substring(0, 72)
                };
            })
        });
    }

    return {
        headerText: "Capacitación Colaboratium",
        bodyText: "📅 *FECHAS Y HORARIOS DISPONIBLES*\n\nSelecciona en el menú desplegable la opción que te quede más cómoda para participar del Webinar o la Reunión Presencial:",
        footerText: "Colaboratium • BCRA Nº 40.015",
        buttonText: "Elegir Horario 📅",
        sections
    };
}

/**
 * Genera el texto limpio para WhatsApp con las opciones de calendario (SIN tablas markdown)
 */
async function formatCalendarOptionsText(codigoEmpresa = 'KRZMJI') {
    const slots = await getAvailableWebinarSlots(codigoEmpresa);
    const virtualSlots = slots.filter(s => s.modalidad === 'VIRTUAL');
    const presencialSlots = slots.filter(s => s.modalidad === 'PRESENCIAL');

    let msg = `📅 *FECHAS Y HORARIOS DISPONIBLES DE CAPACITACIÓN*\n\n`;

    if (virtualSlots.length > 0) {
        msg += `💻 *WEBINAR VIRTUAL (Vía Google Meet)*:\n`;
        virtualSlots.forEach(s => {
            msg += `• *Opción ${s.id}:* ${s.fechaStr} (${s.horarioStr})\n`;
        });
        msg += `\n`;
    }

    if (presencialSlots.length > 0) {
        msg += `🏢 *REUNIÓN PRESENCIAL (Oficinas Comerciales)*:\n`;
        msg += `📍 *Av. del Libertador 264, 1° Piso Contrafrente, Vicente López*\n`;
        presencialSlots.forEach(s => {
            msg += `• *Opción ${s.id}:* ${s.fechaStr} (${s.horarioStr})\n`;
        });
        msg += `\n`;
    }

    msg += `👉 *¿Cuál opción te queda más cómoda?*\nResponde con el número de opción junto con tu *Nombre completo* y *Email* (ej. *1 Juan Ramón Valle damduff@gmail.com*) para reservarte el lugar.`;
    return msg;
}

/**
 * Obtiene el perfil completo de un inscripto con todo el historial de mensajes y resumen IA
 */
async function getSubscriberProfile(codigoEmpresa, contactId) {
    if (!db || !db.pool) return null;

    // 1. Datos completos del contacto
    const [cRows] = await db.pool.query(
        "SELECT * FROM contactos WHERE id = ? AND codigo_empresa = ?",
        [contactId, codigoEmpresa]
    );
    if (!cRows || cRows.length === 0) return null;
    const contacto = cRows[0];

    // 2. Ticket asociado
    const [tRows] = await db.pool.query(
        "SELECT * FROM tickets WHERE (contacto_id = ? OR customer_number = ?) AND codigo_empresa = ? ORDER BY creado_en DESC LIMIT 1",
        [contactId, contacto.telefono, codigoEmpresa]
    );
    const ticket = tRows && tRows.length > 0 ? tRows[0] : null;

    // 3. Historial de mensajes
    const [mensajes] = await db.pool.query(
        "SELECT id, direccion, tipo, contenido, estado_entrega, creado_en FROM mensajes WHERE contacto_id = ? ORDER BY creado_en ASC",
        [contactId]
    );

    // 4. Parsear metadatos
    let meta = contacto.metadata_extra;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
    } else if (!meta) {
        meta = {};
    }

    // 5. Generar o armar síntesis de respuestas
    const inboundMessages = (mensajes || []).filter(m => m.direccion === 'ENTRANTE').map(m => m.contenido);
    let resumenIa = "";

    if (inboundMessages.length > 0) {
        resumenIa = `El candidato ${contacto.nombre || 'Asesor'} se contactó a través de WhatsApp (${contacto.telefono}). ` +
            `Expresó interés en sumarse al equipo de Asesores Comerciales de Colaboratium y confirmó su participación a la capacitación: "${meta.inscripcion || ticket?.summary || 'Webinar de Capacitación'}". ` +
            `Ha registrado su correo electrónico "${contacto.email || 'No especificado'}" y cuenta con un ticket de seguimiento #${ticket?.id || 'N/A'} en estado "${ticket?.status || 'pending_auth'}".`;
    } else {
        resumenIa = `Contacto registrado como Asesor Comercial para "${meta.inscripcion || 'Capacitación oficial'}". Correo registrado: ${contacto.email || 'Pendiente'}.`;
    }

    return {
        contacto: {
            ...contacto,
            metadata_extra: meta
        },
        ticket,
        mensajes: mensajes || [],
        resumen_ia: resumenIa
    };
}

/**
 * Procesa la inscripción a un horario de capacitación
 */
async function processBooking({ slotChoice, customerName, customerEmail, customerPhone, codigoEmpresa = 'KRZMJI' }) {
    const slots = await getAvailableWebinarSlots(codigoEmpresa);

    // Identificar slot por número o coincidencia
    let chosenSlot = null;
    const choiceClean = String(slotChoice || '').replace('slot_', '').trim();
    const choiceNum = parseInt(choiceClean, 10);
    if (!isNaN(choiceNum)) {
        chosenSlot = slots.find(s => s.id === choiceNum);
    } else {
        const text = (slotChoice || '').toLowerCase();
        if (text.includes('presencial')) {
            chosenSlot = slots.find(s => s.modalidad === 'PRESENCIAL');
        } else if (text.includes('lunes')) {
            chosenSlot = slots.find(s => s.fechaStr.toLowerCase().includes('lunes'));
        } else if (text.includes('miercoles') || text.includes('miércoles')) {
            chosenSlot = slots.find(s => s.fechaStr.toLowerCase().includes('miércoles'));
        } else if (text.includes('viernes')) {
            chosenSlot = slots.find(s => s.fechaStr.toLowerCase().includes('viernes'));
        }
    }

    if (!chosenSlot) {
        chosenSlot = slots[0]; // fallback al primer turno
    }

    const isVirtual = chosenSlot.modalidad === 'VIRTUAL';
    const cleanPhone = (customerPhone || '').replace(/[^\d+]/g, '');

    // 1. Guardar o actualizar en Agenda CRM
    try {
        await db.crearContactoCRM(codigoEmpresa, {
            nombre: customerName || 'Asesor Candidato',
            telefono: cleanPhone,
            email: customerEmail,
            grupo: 'ASESORES',
            metadata_extra: {
                slot_id: chosenSlot.id,
                titulo: chosenSlot.titulo,
                fechaStr: chosenSlot.fechaStr,
                horarioStr: chosenSlot.horarioStr,
                modalidad: chosenSlot.modalidad,
                inscripcion: `Inscripto a ${chosenSlot.titulo} (${chosenSlot.fechaStr} ${chosenSlot.horarioStr})`
            }
        });
    } catch (e) {
        console.error('Error actualizando CRM:', e.message);
    }

    // 2. Crear Ticket Helpdesk
    let ticketId = null;
    try {
        ticketId = await db.crearTicket(
            codigoEmpresa,
            null,
            cleanPhone,
            customerName,
            'pending_auth',
            `Inscripción a ${chosenSlot.modalidad}: ${chosenSlot.titulo} - ${chosenSlot.fechaStr} ${chosenSlot.horarioStr}`,
            null,
            'Equipo Admisiones'
        );
    } catch (e) {
        console.error('Error creando ticket de capacitación:', e.message);
    }

    const bookingDetails = {
        ticketId,
        nombre: customerName,
        email: customerEmail,
        telefono: cleanPhone,
        modalidad: chosenSlot.modalidad,
        fechaStr: chosenSlot.fechaStr,
        horarioStr: chosenSlot.horarioStr,
        meetLink: isVirtual ? chosenSlot.meetLink : null,
        ubicacion: chosenSlot.ubicacion
    };

    // 3. Envío dual de emails
    await sendWebinarConfirmationToAdvisor(bookingDetails);
    await sendWebinarNotificationToCompany(bookingDetails);

    // 4. Mensaje de respuesta por WhatsApp
    let responseText = '';
    if (isVirtual) {
        responseText = `¡Excelente, *${customerName}*! 🎉 Tu lugar para el *Webinar Virtual de Capacitación* está confirmado.\n\n` +
            `📅 *Fecha:* ${chosenSlot.fechaStr}\n` +
            `⏰ *Horario:* ${chosenSlot.horarioStr}\n` +
            `💻 *Acceso Google Meet:* ${chosenSlot.meetLink}\n\n` +
            `📧 Te enviamos la confirmación con los accesos e invitación de calendario a *${customerEmail}*.\n` +
            `Cualquier consulta adicional antes de la sesión, estamos a tu disposición por este medio. ¡Nos vemos en el Webinar!`;
    } else {
        responseText = `¡Excelente, *${customerName}*! 🎉 Tu reunión presencial está confirmada.\n\n` +
            `📅 *Fecha:* ${chosenSlot.fechaStr}\n` +
            `⏰ *Horario:* ${chosenSlot.horarioStr}\n` +
            `🏢 *Lugar:* Av. del Libertador 264, 1° Piso Contrafrente, Vicente López, Buenos Aires.\n` +
            `📍 *Cómo llegar:* https://maps.google.com/?q=Av.+del+Libertador+264,+Vicente+Lopez\n\n` +
            `📧 Te enviamos todos los detalles y datos de recepción a *${customerEmail}*.\n` +
            `¡Te esperamos en nuestras oficinas comerciales!`;
    }

    return {
        success: true,
        ticketId,
        slot: chosenSlot,
        whatsappResponse: responseText
    };
}

module.exports = {
    getAvailableWebinarSlots,
    formatCalendarOptionsText,
    formatInteractiveCalendarList,
    getSubscriberProfile,
    processBooking,
    DEFAULT_SLOTS
};

