const db = require('./database');

async function seed() {
  await db.initDB();
  const nombre = 'Reunión Informativa Asesores (WhatsApp)';
  const contenido = `Hace un tiempo recibimos tus datos a partir de tu interés en formar parte del equipo comercial de Colaboratium.

Hoy queremos retomar ese contacto e invitarte a conocer más sobre nuestro proyecto y las oportunidades de desarrollo que estamos construyendo.

Estamos organizando una reunión informativa para futuros asesores comerciales, en la que compartiremos nuestra propuesta de trabajo, el funcionamiento de Colaboratium y los próximos pasos para quienes estén interesados en sumarse.

Detalles del encuentro

- Fecha: {{1}}
- Horario: {{2}} (Argentina)
- Modalidad: Virtual
- Duración estimada: {{3}}

Para participar, simplemente confirmá tu asistencia a través del siguiente enlace:

"RESERVAR MI LUGAR EN LA REUNIÓN" ({{4}})

Una vez que te registres, recibirás la confirmación y los detalles necesarios para participar, junto con la invitación para agregar el encuentro a tu calendario.

Nos entusiasma la posibilidad de conocerte y compartir esta nueva etapa de Colaboratium.

¡Te esperamos!

Equipo de Colaboratium
Global Loan S.A.

---

Recibís este mensaje porque anteriormente manifestaste interés en oportunidades dentro de Colaboratium. Si preferís no recibir nuevas convocatorias, podés indicárnoslo aquí: ({{5}}).`;

  const [existing] = await db.pool.query('SELECT id FROM plantillas WHERE nombre = ? AND tipo = ?', [nombre, 'whatsapp']);
  if (existing && existing.length > 0) {
    await db.pool.query('UPDATE plantillas SET contenido = ?, categoria = ? WHERE id = ?', [contenido, 'asesores', existing[0].id]);
    console.log('✅ Template updated with ID:', existing[0].id);
  } else {
    const [ins] = await db.pool.query(
      'INSERT INTO plantillas (codigo_empresa, tipo, nombre, categoria, asunto, contenido, archivos_adjuntos) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['KRZMJI', 'whatsapp', nombre, 'asesores', 'Convocatoria y Reunión Informativa Asesores', contenido, JSON.stringify([])]
    );
    console.log('✅ Template inserted with ID:', ins.insertId);
  }
  process.exit(0);
}

seed().catch(err => {
  console.error('Error seeding template:', err);
  process.exit(1);
});
