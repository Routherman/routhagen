const db = require('./database');

async function initRoles() {
  await db.initDB();

  const allPrivs = {
    view_dashboard: true,
    view_messages: true,
    view_inbox: true,
    view_calendar: true,
    view_tickets: true,
    view_crm: true,
    view_models: true,
    view_campaigns: true,
    view_flows: true,
    view_roles: true,
    view_settings: true,
    manage_calendar_webinar: true,
    manage_calendar_meet: true,
    manage_contacts: true,
    manage_tickets: true,
    can_manage_roles: true,
    can_manage_users: true,
    can_edit_company: true,
    can_manage_social: true,
    can_access_support_chats: true,
    can_access_sales_chats: true
  };

  await db.pool.query(
    "UPDATE roles SET privilegios = ? WHERE LOWER(nombre) IN ('master', 'main')",
    [JSON.stringify(allPrivs)]
  );
  console.log('✅ Master y Main actualizados con acceso total.');

  const liderPrivs = {
    view_dashboard: true,
    view_messages: true,
    view_calendar: true,
    view_tickets: true,
    view_crm: true,
    view_inbox: false,
    view_models: false,
    view_campaigns: false,
    view_flows: false,
    view_roles: false,
    view_settings: false,
    manage_calendar_webinar: true,
    manage_calendar_meet: false,
    manage_contacts: true,
    manage_tickets: true
  };
  await db.pool.query(
    "UPDATE roles SET privilegios = ? WHERE LOWER(nombre) = 'lideres'",
    [JSON.stringify(liderPrivs)]
  );

  const asesorPrivs = {
    view_dashboard: true,
    view_messages: true,
    view_calendar: true,
    view_tickets: true,
    view_crm: true,
    view_inbox: false,
    view_models: false,
    view_campaigns: false,
    view_flows: false,
    view_roles: false,
    view_settings: false,
    manage_calendar_webinar: false,
    manage_calendar_meet: true,
    manage_contacts: true,
    manage_tickets: false
  };
  await db.pool.query(
    "UPDATE roles SET privilegios = ? WHERE LOWER(nombre) = 'asesores'",
    [JSON.stringify(asesorPrivs)]
  );

  console.log('✅ Roles Líderes y Asesores inicializados con alcance específico.');
  process.exit(0);
}

initRoles().catch(e => {
  console.error(e);
  process.exit(1);
});
