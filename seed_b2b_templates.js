const db = require('./database');

async function seedColdEmailTemplates() {
    await db.initDB();
    const pool = db.pool;
    const codigoEmpresa = 'KRZMJI';

    const plantillaAContenido = `Hola {{First Name}}, ¿cómo estás?

Vi tu perfil público en el equipo de {{Office}} en {{City}} y te escribo porque en Colaboratium (Global Loan S.A. — Registro BCRA Nº 40.015) estamos incorporando agentes inmobiliarios con cartera activa a nuestra Red de Asesores Independientes.

Sabemos que en la operatoria inmobiliaria hablás todas las semanas con clientes que acaban de vender, que están esperando cerrar una operación o que tienen excedentes de liquidez y buscan una renta superadora al plazo fijo tradicional sin inmovilizar su capital a largo plazo.

¿Cómo funciona la alianza para vos y para tu cliente?

Para tu cliente inversor (Costo 0%): Invierte desde una plataforma 100% bancarizada (Banco BIND y Banco Coinag) operando desde su propio CVU, financiando créditos atomizados que pasan por un motor de Inteligencia Artificial que filtra solo entre el 5% y el 15% de los mejores perfiles crediticios (validando BCRA, Renaper, Nosis, Veraz y UIF). Al inversor jamás se le cobra comisión ni gasto administrativo (todo el costo lo absorbe el tomador del crédito).

Para vos como Asesor (Esquema similar a RE/MAX): Ya conocés la modalidad de agencia independiente. Por cada inversor que vincules con tu link propio desde nuestra consola, percibís comisiones directas del 4% (plazo 3 meses), 5% (6 meses) y 6% (12 meses) sobre el capital colocado, cobrando un 3% de forma inmediata al calce del crédito y el resto con las cuotas, más el 100% de comisión en cada reinversión futura de tu cliente. Además, podés recibir inversores captados por las campañas de marketing de Colaboratium.

Este {{1}} a las {{2}} hs vamos a dar una reunión informativa online de {{3}} exclusiva para profesionales independientes, donde mostramos la consola en vivo, la escala de comisiones y el respaldo normativo del BCRA.

👉 Podés reservar tu lugar sin costo acá: {{4}}

Si preferís conocer nuestras oficinas comerciales personalmente, estamos en Av. del Libertador 264, 1° Piso Contrafrente, Vicente López (podés responderme este correo o escribirme por WhatsApp y coordinamos un café de 15 minutos).

Te mando un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015 (Verificable en bcra.gob.ar)
Av. del Libertador 264, 1° Piso, Vicente López / Maipú 568, Piso 8°, CABA

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Te contactamos únicamente porque tu correo profesional figura publicado como contacto comercial en el directorio público de tu red en {{City}}. Según el Art. 27 de la Ley 25.326 y el Decreto 1558/2001, tenés derecho de acceso gratuito y de solicitar el retiro o bloqueo total de tu nombre y correo de nuestra base en cualquier momento haciendo clic en [este enlace de baja inmediata ({{5}})] o respondiendo este correo con la palabra "BAJA".`;

    const plantillaBContenido = `Hola {{First Name}}, ¿cómo estás?

Te contacto como Broker / Responsable de {{Office}} porque en Colaboratium (Global Loan S.A. — Primera plataforma Fintech de créditos entre particulares registrada en el BCRA bajo el Nº 40.015) estamos habilitando nodos de Líderes de Equipo para directores de oficinas inmobiliarias y redes comerciales.

Sabemos que ya liderás un equipo de agentes que trabajan bajo el modelo de contrato independiente. Nuestra propuesta te permite sumar una unidad de ingresos recurrentes para tu oficina, sin ningún costo para los clientes inversores de tu cartera:

Consola Jerárquica Propia (consola.colaboratium.com.ar): Dás de alta a los agentes de tu equipo bajo tu propio nodo. Ellos cobran entre el 4% y el 6% de comisión por ofrecer alternativas de inversión en pesos (100% bancarizadas vía BIND/Coinag y filtradas por IA) a sus clientes con liquidez.

10% de Overriding para vos como Líder: Percibís un 10% adicional sobre la bolsa total de comisiones que generen todos los agentes de tu equipo (sin descontárselo a ellos).

Derivación de Inversores del Marketing Central de Colaboratium: Los inversores que entran por la publicidad propia de Colaboratium se asignan a nuestros Líderes de Equipo para que vos o tus agentes gestionen su cartera y cobren las cuotas residuales y el 100% de cada reinversión futura.

Me gustaría invitarte este {{1}} a las {{2}} hs a nuestra presentación ejecutiva online de {{3}} (registrate sin cargo en {{4}}), o bien coordinar una reunión privada 1 a 1 por Zoom o en nuestras oficinas de Av. del Libertador 264, 1° Piso, Vicente López.

¿Te queda cómodo que coordinemos una breve llamada esta semana o preferís sumarte a la sesión del {{1}}?

Un cordial saludo,

Lic. Damián Feuermann
Presidente | Global Loan S.A. — Colaboratium
Registro BCRA PNFC Nº 40.015

Aviso Legal (Ley 25.326 y Disp. DNPDP 4/2009): Tus datos fueron relevados de tu perfil público profesional en el directorio de {{Office}}. Conforme al Art. 27 de la Ley 25.326, podés ejercer sin cargo tu derecho de acceso, retiro o bloqueo inmediato de nuestra base haciendo clic en [Darme de baja ({{5}})] o respondiendo con la palabra "BAJA".`;

    // 1. Plantilla A (Asesores)
    await pool.query(`
        INSERT INTO plantillas (codigo_empresa, tipo, nombre, categoria, asunto, contenido)
        VALUES (?, 'email', 'Prospección Fría: Agentes Inmobiliarios RE/MAX (Flujo 2)', 'asesores', ?, ?)
        ON DUPLICATE KEY UPDATE asunto = VALUES(asunto), contenido = VALUES(contenido)
    `, [
        codigoEmpresa,
        'Alianza comercial para tus operaciones en {{Office}}',
        plantillaAContenido
    ]);

    // 2. Plantilla B (Brokers / Líderes)
    await pool.query(`
        INSERT INTO plantillas (codigo_empresa, tipo, nombre, categoria, asunto, contenido)
        VALUES (?, 'email', 'Prospección Fría: Broker / Martillero RE/MAX (Flujo 3)', 'lideres', ?, ?)
        ON DUPLICATE KEY UPDATE asunto = VALUES(asunto), contenido = VALUES(contenido)
    `, [
        codigoEmpresa,
        'Unidad de negocio adicional para tu equipo en {{Office}}',
        plantillaBContenido
    ]);

    console.log('✅ Plantillas de Prospección Fría B2B (Asesores y Líderes) guardadas con éxito en DB.');
}

seedColdEmailTemplates().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
