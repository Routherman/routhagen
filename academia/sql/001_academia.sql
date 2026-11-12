-- ============================================================================
-- Módulo de Academia: capacitación interna con seguimiento real.
--
-- MySQL 8.0.19 o más nuevo (InnoDB, utf8mb4). Se usa:
--   · CHECK, que MySQL respeta desde la 8.0.16 (antes los ignoraba en silencio).
--   · INSERT ... AS nuevo ON DUPLICATE KEY UPDATE, desde la 8.0.19
--     (reemplaza a VALUES(), que está deprecado).
--
-- Los ids de usuario y de equipo son VARCHAR(64): vienen del sistema que monta
-- el módulo (pueden ser enteros, UUID o lo que sea) y acá no se asume nada.
--
-- Las tablas NO traen datos. El catálogo de ejemplo de más abajo está
-- comentado.
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------------------------------------------------------
-- 1. Catálogo: cursos → módulos → clases
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_cursos (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(120)    NOT NULL,
  nombre          VARCHAR(200)    NOT NULL,
  descripcion     TEXT            NULL,
  portada_url     VARCHAR(500)    NULL,
  -- Los cursos en borrador no se muestran a nadie: se arma el curso entero y
  -- recién después se publica.
  estado          ENUM('borrador','publicado') NOT NULL DEFAULT 'borrador',
  orden           INT             NOT NULL DEFAULT 0,
  creado_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_academia_cursos_slug (slug),
  KEY ix_academia_cursos_estado_orden (estado, orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS academia_modulos (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  curso_id  BIGINT UNSIGNED NOT NULL,
  nombre    VARCHAR(200)    NOT NULL,
  orden     INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_academia_modulos_curso (curso_id, orden),
  CONSTRAINT fk_academia_modulos_curso FOREIGN KEY (curso_id)
    REFERENCES academia_cursos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS academia_clases (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  modulo_id    BIGINT UNSIGNED NOT NULL,
  nombre       VARCHAR(200)    NOT NULL,
  descripcion  TEXT            NULL,

  -- De dónde sale el video. `drive` se acepta pero NO se puede medir: Google
  -- Drive embebido no expone ni el estado ni la posición del reproductor. Esas
  -- clases solo registran "abierta" y "marcada".
  proveedor    ENUM('youtube','bunny','mux','directo','drive') NOT NULL,

  -- youtube: id de 11 caracteres (o el link, el backend lo normaliza)
  -- bunny:   GUID del video en la librería (la librería va por variable de entorno)
  -- mux:     playback id
  -- directo: URL https a un .mp4 / .webm / .m3u8
  -- drive:   id del archivo (o el link de compartir)
  video_ref    VARCHAR(512)    NOT NULL,

  -- En segundos y como NÚMERO. Es la duración en la que se confía para decir
  -- si una clase se completó: la que manda el navegador solo se usa si esta
  -- está vacía (un cliente modificado podría decir que un video de 30 minutos
  -- dura 10 segundos).
  duracion_s   INT UNSIGNED    NULL,
  orden        INT             NOT NULL DEFAULT 0,

  -- Video obligatorio: hay que verlo entero UNA vez. Subir la versión obliga a
  -- todos a verlo de nuevo (las vistas viejas quedan como historial).
  obligatoria_clave    VARCHAR(64)  NULL,
  obligatoria_version  INT UNSIGNED NOT NULL DEFAULT 1,

  creado_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_academia_clases_modulo (modulo_id, orden),
  UNIQUE KEY uq_academia_clases_obligatoria (obligatoria_clave),
  CONSTRAINT fk_academia_clases_modulo FOREIGN KEY (modulo_id)
    REFERENCES academia_modulos (id) ON DELETE CASCADE,
  CONSTRAINT ck_academia_clases_duracion CHECK (duracion_s IS NULL OR duracion_s > 0),
  -- Un obligatorio se verifica contra la duración: sin duración del catálogo
  -- no hay contra qué comparar, y con Drive no hay forma de medir nada.
  CONSTRAINT ck_academia_clases_obligatoria CHECK (
    obligatoria_clave IS NULL OR (duracion_s IS NOT NULL AND proveedor <> 'drive')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- 2. Personas y equipos
--
-- La academia se mide por USUARIO (el id que sale del login), no por ficha de
-- empleado: mezclar las dos claves obliga a un join para contestar "¿cuánto
-- lleva esta persona?".
--
-- `academia_personas` se completa sola: el backend hace un upsert cada vez
-- que alguien entra con su sesión (nombre y equipo salen del adaptador de
-- login). Pero para que el tablero muestre TAMBIÉN a quien nunca entró —que es
-- justo lo que el líder viene a mirar— conviene cargarla desde la tabla de
-- usuarios del sistema (ver README, "Cargar las personas").
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_equipos (
  id                VARCHAR(64)  NOT NULL,
  nombre            VARCHAR(200) NOT NULL,
  -- Quién lo lidera. Si el login ya dice de qué equipos es líder cada uno
  -- (`liderDe` en el adaptador), esta columna no hace falta.
  lider_usuario_id  VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY ix_academia_equipos_lider (lider_usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS academia_personas (
  usuario_id      VARCHAR(64)  NOT NULL,
  -- El nombre tiene que salir de la fuente que de verdad lo tiene cargado. Si
  -- el tablero muestra "Sin nombre" para todos, el adaptador lo está leyendo
  -- de un campo vacío.
  nombre          VARCHAR(200) NULL,
  -- Sin clave foránea a academia_equipos a propósito: el equipo puede venir
  -- del login antes de que exista acá, y eso no puede impedirle a nadie entrar.
  equipo_id       VARCHAR(64)  NULL,
  -- A quién se le mide. Los que ya sabían el trabajo antes de que existiera la
  -- academia no tienen por qué capacitarse, y reclamárselo no dice nada: se
  -- ponen en 0 y el tablero los esconde (se pueden ver con un filtro). Sumar o
  -- sacar a alguien es un UPDATE, no un cambio de código.
  en_seguimiento  TINYINT(1)   NOT NULL DEFAULT 1,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  creado_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id),
  KEY ix_academia_personas_equipo (equipo_id, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- 3. Progreso: UNA fila por persona y clase
--
-- Junta las señales, que no significan lo mismo y por eso se guardan
-- separadas, nunca fusionadas en un solo número:
--   · MARCADA  — la persona tildó la clase. Lo que DICE haber hecho.
--   · ABIERTA  — el servidor le entregó el video. Que la ABRIÓ.
--   · MIRADO   — segundos de reproducción real, con la pestaña visible,
--                acotados por el servidor. Lo que de verdad se reprodujo.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_progreso (
  usuario_id          VARCHAR(64)     NOT NULL,
  clase_id            BIGINT UNSIGNED NOT NULL,

  marcada_at          DATETIME(3)     NULL,  -- NULL = no marcada (desmarcar la vuelve a NULL)

  aperturas           INT UNSIGNED    NOT NULL DEFAULT 0,
  primera_apertura_at DATETIME(3)     NULL,
  ultima_apertura_at  DATETIME(3)     NULL,

  segundos_mirados    INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Hasta dónde llegó ALGUNA VEZ. Nunca baja: si vuelve a mirar desde el
  -- principio, lo que importa es hasta dónde llegó.
  posicion_max        INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Dónde quedó la última vez, para retomar.
  ultima_posicion     INT UNSIGNED    NOT NULL DEFAULT 0,
  -- La que informó el reproductor. Solo se escribe si vino un número > 0: al
  -- arrancar el video manda 0, y pisar una duración conocida con nada dejaba
  -- la fila sin duración para siempre.
  duracion_detectada  INT UNSIGNED    NULL,
  -- Cuándo cumplió por primera vez: llegó al 90 % y miró al menos el 80 %.
  completada_at       DATETIME(3)     NULL,

  actualizado_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id, clase_id),
  KEY ix_academia_progreso_clase (clase_id),
  CONSTRAINT fk_academia_progreso_persona FOREIGN KEY (usuario_id)
    REFERENCES academia_personas (usuario_id) ON DELETE CASCADE,
  CONSTRAINT fk_academia_progreso_clase FOREIGN KEY (clase_id)
    REFERENCES academia_clases (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- 4. Sesiones de reproducción
--
-- Cada vez que alguien abre una clase nace una sesión con un token secreto de
-- vida corta. Los latidos se autentican con ESE token (por eso funcionan con
-- navigator.sendBeacon, que no puede mandar el header del JWT) y el servidor
-- valida cada latido contra el reloj de la sesión.
--
-- Una fila por apertura: también es el registro de "abrió la clase".
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_sesiones (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Se guarda el SHA-256 del token, no el token: si alguien lee la tabla no
  -- puede mandar latidos a nombre de otro.
  token_hash           CHAR(64)        NOT NULL,
  usuario_id           VARCHAR(64)     NOT NULL,
  clase_id             BIGINT UNSIGNED NOT NULL,
  iniciada_at          DATETIME(3)     NOT NULL,
  ultimo_latido_at     DATETIME(3)     NOT NULL,
  latidos              INT UNSIGNED    NOT NULL DEFAULT 0,
  segundos_aceptados   INT UNSIGNED    NOT NULL DEFAULT 0,
  -- Lo que el navegador pidió y el servidor no aceptó. En uso normal queda en
  -- 0 o casi; un número alto es un cliente tocado o dos pestañas a la vez.
  segundos_rechazados  INT UNSIGNED    NOT NULL DEFAULT 0,
  ultima_posicion      INT UNSIGNED    NOT NULL DEFAULT 0,
  user_agent           VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academia_sesiones_token (token_hash),
  KEY ix_academia_sesiones_usuario (usuario_id, iniciada_at),
  KEY ix_academia_sesiones_clase (clase_id),
  CONSTRAINT fk_academia_sesiones_persona FOREIGN KEY (usuario_id)
    REFERENCES academia_personas (usuario_id) ON DELETE CASCADE,
  CONSTRAINT fk_academia_sesiones_clase FOREIGN KEY (clase_id)
    REFERENCES academia_clases (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- El reloj de cada persona: hasta qué momento ya se le acreditó tiempo.
-- Es lo que impide que dos pestañas (o dos videos a la vez) sumen el doble:
-- una persona no puede mirar más segundos que los que pasaron en el reloj.
CREATE TABLE IF NOT EXISTS academia_reloj_usuario (
  usuario_id     VARCHAR(64) NOT NULL,
  credito_hasta  DATETIME(3) NOT NULL,
  PRIMARY KEY (usuario_id),
  CONSTRAINT fk_academia_reloj_persona FOREIGN KEY (usuario_id)
    REFERENCES academia_personas (usuario_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- 5. Videos obligatorios vistos
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_obligatorios_vistos (
  usuario_id  VARCHAR(64)     NOT NULL,
  clave       VARCHAR(64)     NOT NULL,
  version     INT UNSIGNED    NOT NULL,
  sesion_id   BIGINT UNSIGNED NULL,
  segundos    INT UNSIGNED    NOT NULL,
  visto_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id, clave, version),
  CONSTRAINT fk_academia_oblig_persona FOREIGN KEY (usuario_id)
    REFERENCES academia_personas (usuario_id) ON DELETE CASCADE,
  CONSTRAINT fk_academia_oblig_sesion FOREIGN KEY (sesion_id)
    REFERENCES academia_sesiones (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- 6. Prácticas: ejercicios con entrega y corrección
--
-- El enunciado vive en el código (backend/src/enunciados.ts), no acá: es texto
-- que se corrige y se reescribe, y no amerita una migración por cada coma.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academia_practicas (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  usuario_id     VARCHAR(64)       NOT NULL,
  ejercicio      SMALLINT UNSIGNED NOT NULL,
  -- Puntero al trabajo hecho en la herramienta REAL del sistema (marcado como
  -- práctica), no una copia. Si ese trabajo se borra, la entrega vuelve a
  -- 'pendiente' y conserva la devolución (ver trabajoDePracticaBorrado()).
  trabajo_ref    VARCHAR(191)      NULL,
  -- El porqué. Es la mitad del ejercicio.
  explicacion    TEXT              NULL,
  -- pendiente = arrancó (borrador guardado o trabajo enganchado). Cuenta como
  -- "a medias", NO como "sin empezar".
  estado         ENUM('pendiente','entregado','aprobado','rehacer') NOT NULL DEFAULT 'pendiente',
  devolucion     TEXT              NULL,
  revisado_por   VARCHAR(64)       NULL,
  revisado_at    DATETIME(3)       NULL,
  entregado_at   DATETIME(3)       NULL,
  creado_at      DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_at DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Una entrega por persona y ejercicio: rehacer PISA la anterior en vez de
  -- apilar intentos. Importa el trabajo final.
  UNIQUE KEY uq_academia_practicas_persona_ejercicio (usuario_id, ejercicio),
  KEY ix_academia_practicas_estado (estado, entregado_at),
  KEY ix_academia_practicas_trabajo (trabajo_ref),
  CONSTRAINT fk_academia_practicas_persona FOREIGN KEY (usuario_id)
    REFERENCES academia_personas (usuario_id) ON DELETE CASCADE,
  -- No se manda a rehacer sin decir por qué. La regla está también en el
  -- backend (con mensaje claro); acá es la red por si alguien escribe a mano.
  CONSTRAINT ck_academia_practicas_rehacer CHECK (
    estado <> 'rehacer' OR CHAR_LENGTH(TRIM(COALESCE(devolucion, ''))) >= 20
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- Catálogo de ejemplo (comentado). Descomentar para probar en local.
-- ============================================================================
--
-- INSERT INTO academia_cursos (slug, nombre, descripcion, estado, orden)
-- VALUES ('primeros-pasos', 'Primeros pasos', 'Cómo usar el sistema de punta a punta', 'publicado', 1);
--
-- INSERT INTO academia_modulos (curso_id, nombre, orden)
-- VALUES (LAST_INSERT_ID(), 'Introducción', 1);
--
-- INSERT INTO academia_clases (modulo_id, nombre, proveedor, video_ref, duracion_s, orden)
-- VALUES
--   (LAST_INSERT_ID(), 'Bienvenida',            'youtube', 'https://youtu.be/XXXXXXXXXXX', 312, 1),
--   (LAST_INSERT_ID(), 'El tablero principal',  'bunny',   '00000000-0000-0000-0000-000000000000', 540, 2),
--   (LAST_INSERT_ID(), 'Material de lectura',   'drive',   'https://drive.google.com/file/d/XXXXXXXXXXXXXXXXXXXXXXXXX/view', NULL, 3);
--
-- Video obligatorio (se dispara desde el flujo de trabajo, no desde el catálogo):
-- UPDATE academia_clases SET obligatoria_clave = 'bienvenida' WHERE id = ...;
-- Para obligar a todos a verlo de nuevo cuando cambia el video:
-- UPDATE academia_clases SET obligatoria_version = obligatoria_version + 1 WHERE obligatoria_clave = 'bienvenida';
