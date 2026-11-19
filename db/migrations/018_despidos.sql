-- ==========================================================
-- Migración 018 — Registro de personas y despidos
--
-- Agrega:
--   * enum motivo_despido
--   * tabla despido (un despido por contrato)
--   * clase Payroll/Employee con listar, ver, despedir, listarDespidos y
--     listarMotivos
--   * opciones de menú Personas y Despidos
--
-- El despido es transaccional: cierra el contrato, marca la persona como
-- INACTIVA, desactiva el usuario, revoca sus refresh tokens y borra sus
-- sesiones. El BO hace todo en una sola transacción; esta migración solo
-- prepara el esquema y los permisos.
--
-- Aplica sobre una base con 001–017. Idempotente.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Enum del motivo
-- ----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'motivo_despido') THEN
    CREATE TYPE motivo_despido AS ENUM (
      'RENUNCIA',
      'DESPIDO_JUSTIFICADO',
      'DESPIDO_INJUSTIFICADO',
      'FIN_DE_CONTRATO',
      'JUBILACION',
      'FALLECIMIENTO'
    );
  END IF;
END $$;

-- ----------------------------------------------------------
-- 2. Tabla despido
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS despido (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     uuid NOT NULL REFERENCES persona(id),
  contrato_id    uuid NOT NULL REFERENCES contrato(id),
  motivo         motivo_despido NOT NULL,
  fecha_despido  date NOT NULL,
  descripcion    varchar(250),
  registrado_por uuid REFERENCES usuario(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Un contrato se cierra una sola vez: el histórico queda enlazado.
  CONSTRAINT uq_despido_contrato UNIQUE (contrato_id)
);

CREATE INDEX IF NOT EXISTS idx_despido_persona
  ON despido (persona_id, fecha_despido DESC);

COMMENT ON TABLE despido IS
  'Cierre laboral de un contrato. La persona queda INACTIVA y el usuario desactivado en la misma transacción.';

-- ----------------------------------------------------------
-- 3. Clase Employee y sus métodos
-- ----------------------------------------------------------
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Employee', 'Registro de personas y despidos'
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('listar',        'Lista las personas con su contrato y su último despido'),
  ('ver',           'Devuelve una persona con sus contratos y despidos'),
  ('despedir',      'Cierra el contrato, inactiva la persona y desactiva su usuario'),
  ('listarDespidos','Lista el histórico de despidos'),
  ('listarMotivos', 'Devuelve los motivos de despido del enum')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Employee'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 4. Permisos de método (solo RRHH y Superusuario)
-- ----------------------------------------------------------
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Employee'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('listar', 'ver', 'despedir', 'listarDespidos', 'listarMotivos')
WHERE pf.nombre_perfil IN ('RRHH', 'Superusuario')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 5. Opciones de menú
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, o.nombre, o.descripcion, o.orden
FROM subsistema s
CROSS JOIN (VALUES
  ('Personas', 'Registro de personas y contratos', 11),
  ('Despidos', 'Histórico de despidos',            12)
) AS o(nombre, descripcion, orden)
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
 AND o.nombre IN ('Personas', 'Despidos')
WHERE pf.nombre_perfil IN ('RRHH', 'Superusuario')
ON CONFLICT DO NOTHING;

COMMIT;
