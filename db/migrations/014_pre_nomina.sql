-- ==========================================================
-- Migración 014 — Pre-nómina: borrador editable de la nómina
--
-- Agrega el subsistema Payroll la clase PreNomina con sus cinco métodos
-- (generar, ver, guardar, eliminar, confirmar), el enum origen_linea y las
-- tres tablas del borrador:
--
--   pre_nomina          cabecera (una por período, UNIQUE)
--   pre_nomina_recibo   una fila por persona/contrato
--   pre_nomina_detalle  líneas, espejo de detalle_recibo + origen/editada
--
-- Los métodos y la opción de menú "PreNomina" se conceden SOLO a RRHH y
-- Superusuario. Administrador opera el resto de Payroll pero queda fuera de
-- la pre-nómina; Empleado tampoco la ve.
--
-- No se toca db/init.sql: el esquema base sigue en v8 y este cambio entra
-- por migración. db/schema.dbml se actualiza en el mismo cambio.
--
-- Aplica sobre una base con 001–013. Idempotente: se puede correr varias
-- veces sin duplicar filas ni romper por el enum.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Enum origen_linea
-- ----------------------------------------------------------
-- CREATE TYPE no admite IF NOT EXISTS; el DO block lo hace idempotente.
DO $$
BEGIN
  CREATE TYPE origen_linea AS ENUM (
    'CALCULADA',   -- sueldo base y horas extra de registro_horas
    'RECURRENTE',  -- concepto_persona vigente
    'NOVEDAD',     -- novedad APROBADA del período
    'PRESTAMO',    -- cuota pendiente
    'LEY',         -- deducción o aporte patronal de una afiliación
    'MANUAL'       -- línea agregada por RRHH en el borrador
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ----------------------------------------------------------
-- 2. Tablas del borrador
-- ----------------------------------------------------------
-- No hay columna de estado: una fila ES un borrador (existe o no existe).
-- Al confirmar se borra en cascada.
CREATE TABLE IF NOT EXISTS pre_nomina (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_nomina_id    uuid NOT NULL UNIQUE REFERENCES periodo_nomina(id),
  version              integer NOT NULL DEFAULT 1,
  generado_por         uuid NOT NULL REFERENCES usuario(id),
  fecha_generacion     timestamptz NOT NULL DEFAULT now(),
  actualizado_por      uuid REFERENCES usuario(id),
  fecha_actualizacion  timestamptz
);

CREATE TABLE IF NOT EXISTS pre_nomina_recibo (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_nomina_id       uuid NOT NULL REFERENCES pre_nomina(id) ON DELETE CASCADE,
  persona_id          uuid NOT NULL REFERENCES persona(id),
  contrato_id         uuid REFERENCES contrato(id),
  total_asignaciones  decimal(12,2) NOT NULL DEFAULT 0,
  total_deducciones   decimal(12,2) NOT NULL DEFAULT 0,
  monto_total         decimal(12,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pre_nomina_id, persona_id)
);

CREATE TABLE IF NOT EXISTS pre_nomina_detalle (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_nomina_recibo_id uuid NOT NULL REFERENCES pre_nomina_recibo(id) ON DELETE CASCADE,
  concepto_id          int  NOT NULL REFERENCES concepto(id),
  origen               origen_linea NOT NULL,
  cuota_prestamo_id    uuid UNIQUE REFERENCES cuota_prestamo(id),
  novedad_id           uuid REFERENCES novedad(id),
  concepto_persona_id  uuid REFERENCES concepto_persona(id),
  parametro_aporte_id  int  REFERENCES parametro_aporte_ley(id),
  base_calculo         decimal(12,2),
  tasa_aplicada        decimal(6,4),
  cantidad_unidades    decimal(8,2),
  monto                decimal(12,2) NOT NULL,
  editada              boolean NOT NULL DEFAULT false,
  -- Mismo criterio que detalle_recibo: como máximo UNA FK de origen.
  CONSTRAINT chk_pre_nomina_origen_unico CHECK (
    (cuota_prestamo_id   IS NOT NULL)::int +
    (novedad_id          IS NOT NULL)::int +
    (concepto_persona_id IS NOT NULL)::int +
    (parametro_aporte_id IS NOT NULL)::int <= 1
  ),
  -- El constructor omite las líneas en cero; una manual en cero no tiene
  -- sentido y rompería el neto. El recálculo de ley borra la que baja a 0.
  CONSTRAINT chk_pre_nomina_monto_positivo CHECK (monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_pre_nomina_recibo_pre_nomina
  ON pre_nomina_recibo (pre_nomina_id);
CREATE INDEX IF NOT EXISTS idx_pre_nomina_detalle_recibo
  ON pre_nomina_detalle (pre_nomina_recibo_id);
CREATE INDEX IF NOT EXISTS idx_pre_nomina_detalle_concepto
  ON pre_nomina_detalle (concepto_id);

-- ----------------------------------------------------------
-- 3. Clase PreNomina en el subsistema Payroll
-- ----------------------------------------------------------
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'PreNomina', 'Borrador editable de la nómina del período'
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 4. Métodos de la clase PreNomina
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('generar',   'Genera el borrador de un período BORRADOR sin efectos secundarios'),
  ('ver',       'Devuelve el borrador con sus recibos y líneas'),
  ('guardar',   'Guarda las líneas editables con bloqueo optimista por versión'),
  ('eliminar',  'Elimina el borrador sin tocar el período'),
  ('confirmar', 'Escribe la nómina final, aplica novedades y cuotas y borra el borrador')
) AS m(nombre, descripcion)
WHERE c.nombre = 'PreNomina'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 5. Permisos de método: solo RRHH y Superusuario
-- ----------------------------------------------------------
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'PreNomina'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('generar', 'ver', 'guardar', 'eliminar', 'confirmar')
WHERE pf.nombre_perfil IN ('RRHH', 'Superusuario')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 6. Opción de menú "PreNomina" (subsistema Payroll, orden 10)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'PreNomina', 'Borrador editable de la nómina del período', 10
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'PreNomina'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
WHERE pf.nombre_perfil IN ('RRHH', 'Superusuario')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 7. Defensa ante la 004 re-ejecutada
-- ----------------------------------------------------------
-- La 004 concede TODOS los métodos y opciones de Payroll a RRHH, GerenteRRHH,
-- Administrador y Superusuario. Si se vuelve a correr después de esta
-- migración, PreNomina quedaría visible/ejecutable para Administrador. Se
-- revierte para que la pre-nómina sea solo de RRHH y Superusuario.
DELETE FROM permiso_metodo pm
USING metodo m, clase c, subsistema s, perfil pf
WHERE pm.metodo_id = m.id
  AND m.clase_id = c.id
  AND c.subsistema_id = s.id
  AND pm.perfil_id = pf.id
  AND s.nombre = 'Payroll'
  AND c.nombre = 'PreNomina'
  AND m.nombre IN ('generar', 'ver', 'guardar', 'eliminar', 'confirmar')
  AND pf.nombre_perfil NOT IN ('RRHH', 'Superusuario');

DELETE FROM permiso_opcion po
USING opcion o, subsistema s, perfil pf
WHERE po.opcion_id = o.id
  AND o.subsistema_id = s.id
  AND po.perfil_id = pf.id
  AND s.nombre = 'Payroll'
  AND o.nombre = 'PreNomina'
  AND pf.nombre_perfil NOT IN ('RRHH', 'Superusuario');

COMMIT;
