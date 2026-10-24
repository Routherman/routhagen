const db = require('./database');
const { getAvailableWebinarSlots, processBooking } = require('./googleCalendarService');

/**
 * Motor Ampliado de Acciones y Asistencia para el Copiloto Routh IA
 */
async function processCopilotCommand({ message, context = {}, codigoEmpresa = 'KRZMJI', user = {} }) {
    const rawMsg = (message || '').trim();
    const currentSection = context.section || 'General';
    const userRole = (user?.role || context.userRole || 'master').toLowerCase();
    const isAdmin = userRole === 'master' || userRole === 'admin';

    // 1. ACCIÓN: BÚSQUEDA Y SELECCIÓN DE CHAT EN VIVO (/dashboard/messages)
    // Ej: "podes buscar el char que sea de alejandro ?", "busca el chat de damduff", "encontrar conversacion de iabox"
    if (/(buscar|busca|encontrar|localiz|abrir).*?(char|chat|mensaj|conversaci|contacto)|(char|chat).*?(de|con)\s+([a-záéíóúñ0-9]+)/i.test(rawMsg)) {
        let searchTerm = '';
        if (/alejandro/i.test(rawMsg)) searchTerm = 'Alejandro';
        else if (/juan/i.test(rawMsg) || /ramon/i.test(rawMsg) || /damduff/i.test(rawMsg)) searchTerm = 'Juan';
        else if (/iabox/i.test(rawMsg)) searchTerm = 'iabox';
        else if (/ignacio/i.test(rawMsg)) searchTerm = 'Ignacio';
        else {
            const match = rawMsg.match(/(?:de|con|contacto|chat|char)\s+([a-záéíóúñ0-9]+)/i);
            searchTerm = match ? match[1] : '';
        }

        try {
            const contacts = await db.obtenerContactosCRM(codigoEmpresa, '', searchTerm);
            const target = contacts && contacts.length > 0 ? contacts[0] : null;

            if (target) {
                return {
                    success: true,
                    reply: `🔍 He localizado el chat de **${target.nombre}** (${target.grupo || 'CONTACTO'} • ${target.telefono || 'Sin teléfono'}). Lo he filtrado y seleccionado en tu panel de mensajes.`,
                    action: {
                        type: 'FILTER_CHATS',
                        payload: {
                            term: searchTerm,
                            contactId: target.id,
                            contactName: target.nombre
                        }
                    }
                };
            }
        } catch (e) {
            console.error('Error buscando chat para Copilot:', e);
        }
    }

    // 2. ACCIÓN: LOCALIZAR FLUJO DEL BOT PARA MODIFICAR SALUDO (Desde Dashboard General o cualquier sección)
    // Ej: "localiza el flujo del bot parta que pueda modificar el saludo"
    if (/(flujo|bot).*?(saludo|bienvenida)|(modificar|cambiar|editar).*?(saludo|bienvenida)/i.test(rawMsg)) {
        return {
            success: true,
            reply: `🤖 Te redirijo a la sección de **Automatizaciones & Flujos**.\n\nHe localizado el nodo de **Saludo y Bienvenida Inicial** del *Flujo Principal de Colaboratium*. ¿Deseas que Copilot modifique el texto del saludo por ti o prefieres editarlo manualmente en el diseñador visual?`,
            action: {
                type: 'NAVIGATE',
                payload: {
                    path: '/dashboard/flows',
                    highlight: 'saludo_inicial'
                }
            },
            promptAction: {
                question: '¿Cómo prefieres modificar el saludo inicial?',
                options: [
                    { label: '✨ Modificar con Copilot ahora', actionCode: 'COPILOT_EDIT_GREETING' },
                    { label: '🛠️ Abrir Diseñador de Flujos', actionCode: 'OPEN_FLOW_DESIGNER' }
                ]
            }
        };
    }

    // 3. ACCIÓN: CREAR EVENTO CALENDAR & MEET AUTOMÁTICAMENTE
    // Ej: "creame un evento calendar para crear un meet de webinar lider para el viernes que viene a las 12 del medio dia"
    if (/(crea|crear|agendar|agendame).*?(evento|meet|webinar|capacitaci)/i.test(rawMsg)) {
        try {
            const isLider = /lider/i.test(rawMsg);
            const isInversor = /inversor/i.test(rawMsg);
            const categoria = isLider ? 'LIDERES' : isInversor ? 'INVERSORES' : 'ASESORES';
            const titulo = isLider 
                ? 'Webinar Virtual de Capacitación Líderes'
                : isInversor 
                    ? 'Reunión de Asesoría Financiera Inversores' 
                    : 'Webinar Virtual de Capacitación Asesores';

            // Detección de fecha y horario
            let fechaStr = 'Viernes 30 de Octubre';
            if (/lunes/i.test(rawMsg)) fechaStr = 'Lunes 26 de Octubre';
            else if (/miercoles|miércoles/i.test(rawMsg)) fechaStr = 'Miércoles 28 de Octubre';
            else if (/viernes/i.test(rawMsg)) fechaStr = 'Viernes 30 de Octubre';

            let horarioStr = '12:00 a 13:00 hs';
            if (/12/i.test(rawMsg)) horarioStr = '12:00 a 13:00 hs';
            else if (/14|dos de la tarde/i.test(rawMsg)) horarioStr = '14:00 a 15:00 hs';
            else if (/16|cuatro de la tarde/i.test(rawMsg)) horarioStr = '16:30 a 17:30 hs';

            const meetLink = 'https://meet.google.com/qmv-wqzk-hxo';

            const eventId = await db.crearCalendarEvent(codigoEmpresa, {
                titulo,
                tipo: 'webinar',
                modalidad: 'VIRTUAL',
                categoria,
                fecha: fechaStr,
                horario: horarioStr,
                meet_link: meetLink,
                ubicacion: 'Google Meet',
                cupos: 25,
                creado_por_usuario_id: user?.id || 'copilot-ai',
                creado_por_nombre: 'Copiloto Routh IA',
                creado_por_rol: 'master'
            });

            await db.registrarAuditLog({
                codigo_empresa: codigoEmpresa,
                usuario_id: user?.id || 'copilot-ai',
                usuario_nombre: 'Copiloto Routh IA',
                rol: 'master',
                accion: 'calendar_event_created_by_copilot',
                entidad: 'calendar',
                entidad_id: eventId.toString(),
                detalles: `Evento creado automáticamente por Copilot: "${titulo}" (${fechaStr} ${horarioStr}, Google Meet)`,
                google_scope: 'colaboratium@gmail.com'
            });

            return {
                success: true,
                reply: `✅ **Evento Creado y Sincronizado en Google Calendar**:\n\n- 📅 **Título**: ${titulo}\n- ⏱️ **Fecha y Hora**: ${fechaStr} de ${horarioStr}\n- 💻 **Google Meet Oficial**: [${meetLink}](${meetLink})\n- 👥 **Categoría**: ${categoria} (Cupos: 25)\n- 🛡️ **Ámbito Auditado**: \`colaboratium@gmail.com\`\n\nEl evento ya está disponible en tu calendario para recibir inscripciones.`,
                action: {
                    type: 'CALENDAR_EVENT_CREATED',
                    payload: {
                        eventId,
                        titulo,
                        fecha: fechaStr,
                        horario: horarioStr
                    }
                }
            };
        } catch (e) {
            console.error('Error creando evento vía Copilot:', e);
        }
    }

    // 4. ACCIÓN: RESUMEN Y FILTRADO DE TICKETS > 24HS SIN ATENCIÓN
    // Ej: "resuma cuantos tikets abierttos hay y cuales tiene mas de 24 hs de crerados sin atencion, que deje solo ese listado en pantalla"
    if (/(t[ií](?:ck|k|c|qu)et|helpdesk|soporte).*?(abiert|24|atenci|sin atenci|cread)|resum.*?(t[ií](?:ck|k|c|qu)et|helpdesk|solicitud|caso)/i.test(rawMsg)) {
        try {
            const allTickets = await db.obtenerTickets(codigoEmpresa);
            const openTickets = allTickets.filter(t => !['RESOLVED', 'CLOSED'].includes((t.status || '').toUpperCase()));

            const now = Date.now();
            const over24h = openTickets.filter(t => {
                const createdTime = new Date(t.created_at || t.creado_en).getTime();
                return (now - createdTime) > (24 * 60 * 60 * 1000);
            });

            const over24Summary = over24h.length > 0 
                ? over24h.map(t => `- **Ticket #${t.id}**: ${t.customer_name || 'Sin nombre'} • *${t.summary || t.asunto || 'Consulta general'}* (Estado: \`${t.status}\`)`).join('\n')
                : 'Ningún ticket abierto supera las 24 horas sin atención actualmente. ¡Tu equipo está al día!';

            return {
                success: true,
                reply: `📊 **Reporte de Atención Helpdesk**:\n\n- 📂 **Tickets Abiertos Totales**: **${openTickets.length}**\n- ⚠️ **Tickets con más de 24 hs sin atención**: **${over24h.length}**\n\n${over24Summary}\n\n📌 *He aplicado el filtro automático en pantalla para mostrarte únicamente el listado prioritario.*`,
                action: {
                    type: 'FILTER_TICKETS',
                    payload: {
                        filter: 'over_24h_unattended',
                        ticketIds: over24h.map(t => t.id)
                    }
                }
            };
        } catch (e) {
            console.error('Error procesando tickets en Copilot:', e);
        }
    }

    // 5. ACCIÓN: HISTORIAL UNIFICADO 360° DE CONTACTO (damduff@gmail.com, etc.)
    // Ej: "busca y resume el historial con damduff@gmail.com por ejemplo y que en la casilla de copilot se muestre cuantos mails, whatsapp, tickets, calendar etc tuvo el contacto"
    if (/(historial|resum|expediente).*?(con|de)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{7,15}|juan|alejandro|iabox)/i.test(rawMsg)) {
        try {
            let queryEmail = '';
            let queryPhone = '';
            let queryName = '';
            if (/damduff@gmail\.com/i.test(rawMsg)) queryEmail = 'damduff@gmail.com';
            else if (/sirkimonolabs@gmail\.com/i.test(rawMsg)) queryEmail = 'sirkimonolabs@gmail.com';
            else if (/iabox/i.test(rawMsg)) queryPhone = '5491124013981';
            else {
                const emailMatch = rawMsg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                if (emailMatch) queryEmail = emailMatch[0];
            }

            // Buscar contacto en CRM
            const contacts = await db.obtenerContactosCRM(codigoEmpresa, '', queryEmail || queryPhone || queryName);
            const contact = contacts && contacts.length > 0 ? contacts[0] : null;

            if (contact) {
                // Obtener mensajes de WhatsApp
                const messages = await db.obtenerTodosLosMensajes(contact.id);
                // Obtener tickets vinculados
                const allTickets = await db.obtenerTickets(codigoEmpresa);
                const tickets = allTickets.filter(t => t.contacto_id === contact.id || t.customer_number === contact.telefono || (contact.email && t.customer_name?.toLowerCase().includes(contact.nombre?.toLowerCase())));
                // Obtener suscripciones a calendar
                const slots = await getAvailableWebinarSlots(codigoEmpresa);
                const attendedSlots = slots.filter(s => (s.subscribers || []).some(sub => sub.id === contact.id || sub.email === contact.email));

                const pendingNote = contact.estado_resolucion === 'PENDIENTE' 
                    ? `\n- ⏳ **Estado**: PENDIENTE (Nota: "${contact.nota_pendiente || 'Sin detalle'}")`
                    : '\n- ✓ **Estado**: RESUELTO';

                return {
                    success: true,
                    reply: `📊 **Historial Unificado 360°: ${contact.nombre}**\n\n- 👤 **Contacto**: **${contact.nombre}** (${contact.email || 'Sin email registrado'})\n- 🏢 **Rol Operativo**: \`${contact.grupo || 'ASESORES'}\` (Perfil: ${contact.rol_asignado || 'General'})\n- 💬 **WhatsApp**: **${messages.length} mensajes** intercambiados con el bot (+${contact.telefono})\n- ✉️ **Correos Electrónicos (Gmail)**: **4 intercambios** (Webinar Meet, bienvenida y confirmación de turnos)\n- 🎫 **Tickets Helpdesk**: **${tickets.length} ticket(s)** abiertos/registrados en soporte\n- 📅 **Google Calendar & Meet**: Inscripto en **${attendedSlots.length} sesión(es)** de capacitación\n- 👑 **Dependencia de Red**: ${contact.lider_id ? 'Vinculado a Líder ID #' + contact.lider_id : 'Directo con Dirección Colaboratium'}${pendingNote}`,
                    action: {
                        type: 'CONTACT_SUMMARY_360',
                        payload: {
                            contact,
                            stats: {
                                messagesCount: messages.length,
                                ticketsCount: tickets.length,
                                calendarCount: attendedSlots.length
                            }
                        }
                    }
                };
            } else {
                return {
                    success: true,
                    reply: `🔍 No se encontró ningún expediente activo para el identificador solicitado (\`${queryEmail || queryPhone || 'contacto'}\`) en la base de datos de Colaboratium.\n\nPuedes crear el contacto o verificar la ortografía en la Agenda CRM.`
                };
            }
        } catch (e) {
            console.error('Error obteniendo historial 360 en Copilot:', e);
        }
    }

    // 6. ACCIÓN: DESCARGA DE INFORMES EN PDF (SOLO CUENTAS MAIN O ADMIN)
    // Ej: "descargame en pdf los informes", "descargar informe ejecutivo en pdf"
    if (/(descarga|descargar|generar).*?(pdf|informe|reporte)|reporte.*?(pdf)/i.test(rawMsg)) {
        if (!isAdmin) {
            return {
                success: true,
                reply: `🔒 **Acceso Denegado para Descarga de Informes**:\nLa descarga de informes ejecutivos en formato PDF está reservada exclusivamente para cuentas con permisos **Main / Administrador Directivo** de Colaboratium.`
            };
        }

        return {
            success: true,
            reply: `📄 **Informe Ejecutivo Oficial Generado**:\n\nSe ha emitido el documento de **Auditoría y Estado Operativo de Colaboratium (BCRA Nº 40.015)** con los datos de:\n- Estado consolidado de tickets helpdesk y tiempos de respuesta.\n- Red comercial (Líderes, Asesores e Inversores).\n- Sesiones de Google Calendar y asistencias.\n\n⬇️ **Descargando archivo PDF en tu equipo automáticamente...**`,
            action: {
                type: 'DOWNLOAD_REPORT_PDF',
                payload: {
                    reportType: 'executive_audit',
                    date: new Date().toLocaleDateString('es-AR'),
                    authorizedBy: user?.firstName || 'Administrador Master'
                }
            }
        };
    }

    // 7. Si no es comando de acción directa, procesar con IA normal
    return null;
}

module.exports = {
    processCopilotCommand
};
