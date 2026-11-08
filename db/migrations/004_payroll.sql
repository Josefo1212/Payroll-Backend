-- ==========================================================
-- Migración 004 — Subsistema Payroll (nómina)
-- Aplica sobre una base que ya tiene db/init.sql y los seeds.
-- Idempotente: se puede correr varias veces sin duplicar.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Registro de horas trabajadas (una fila por persona y día)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_horas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id      uuid NOT NULL REFERENCES persona(id),
  fecha           date NOT NULL,
  horas_normales  decimal(5,2) NOT NULL DEFAULT 0,
  horas_extra     decimal(5,2) NOT NULL DEFAULT 0,
  observacion     varchar(200),
  registrado_por  uuid NOT NULL REFERENCES usuario(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, fecha),
  CONSTRAINT chk_registro_horas_no_negativas CHECK (horas_normales >= 0 AND horas_extra >= 0),
  CONSTRAINT chk_registro_horas_con_horas CHECK (horas_normales + horas_extra > 0)
);
CREATE INDEX IF NOT EXISTS idx_registro_horas_persona_fecha ON registro_horas (persona_id, fecha);

-- ----------------------------------------------------------
-- 2. Tarifa base sugerida por cargo (el valor real vive en contrato_salario)
-- ----------------------------------------------------------
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS valor_hora_base decimal(12,2);
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS chk_cargo_valor_hora_base;
ALTER TABLE cargo ADD CONSTRAINT chk_cargo_valor_hora_base
  CHECK (valor_hora_base IS NULL OR valor_hora_base >= 0);

-- ----------------------------------------------------------
-- 3. Conceptos base del sistema
-- ----------------------------------------------------------
INSERT INTO concepto
  (codigo, nombre_concepto, tipo_concepto, categoria, unidad, afecta_base_ley)
VALUES
  ('SUELDO_BASE',           'Sueldo base',                          'ASIGNACION',      'AJUSTE',    'MONTO', true),
  ('HORA_EXTRA',            'Horas extra',                          'ASIGNACION',      'HORA_EXTRA','HORAS', true),
  ('BONO',                  'Bono',                                 'ASIGNACION',      'BONO',      'MONTO', true),
  ('SSO',                   'Seguro Social Obligatorio (empleado)', 'DEDUCCION',       'LEY',       'MONTO', false),
  ('PARO_FORZOSO',          'Paro forzoso (empleado)',              'DEDUCCION',       'LEY',       'MONTO', false),
  ('FAOV',                  'Vivienda FAOV (empleado)',             'DEDUCCION',       'LEY',       'MONTO', false),
  ('DESCUENTO_OPCIONAL',    'Descuento opcional',                   'DEDUCCION',       'OPCIONAL',  'MONTO', false),
  ('CUOTA_PRESTAMO',        'Cuota de préstamo',                    'DEDUCCION',       'PRESTAMO',  'MONTO', false),
  ('SSO_PATRONAL',          'Seguro Social Obligatorio (patrono)',  'APORTE_PATRONAL', 'LEY',       'MONTO', false),
  ('PARO_FORZOSO_PATRONAL', 'Paro forzoso (patrono)',              'APORTE_PATRONAL', 'LEY',       'MONTO', false),
  ('FAOV_PATRONAL',         'Vivienda FAOV (patrono)',              'APORTE_PATRONAL', 'LEY',       'MONTO', false),
  ('INCES',                 'INCES (patrono)',                      'APORTE_PATRONAL', 'LEY',       'MONTO', false)
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------
-- 4. Tipos de aporte de ley y parámetros de ejemplo
--    (las tasas viven en la BD: se cierran y se crean nuevas)
-- ----------------------------------------------------------
INSERT INTO tipo_aporte_ley (codigo, nombre, entidad, concepto_deduccion_id, concepto_patronal_id)
SELECT t.codigo, t.nombre, t.entidad,
       (SELECT id FROM concepto WHERE codigo = t.codigo_deduccion),
       (SELECT id FROM concepto WHERE codigo = t.codigo_patronal)
FROM (VALUES
  ('SSO',          'Seguro Social Obligatorio', 'IVSS',                          'SSO',          'SSO_PATRONAL'),
  ('PARO_FORZOSO', 'Paro forzoso',              'Régimen Prestacional de Empleo', 'PARO_FORZOSO', 'PARO_FORZOSO_PATRONAL'),
  ('VIVIENDA',     'Vivienda y hábitat (FAOV)', 'BANAVIH',                        'FAOV',         'FAOV_PATRONAL'),
  ('INCES',        'INCES',                     'INCES',                          NULL,           'INCES')
) AS t(codigo, nombre, entidad, codigo_deduccion, codigo_patronal)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO parametro_aporte_ley
  (tipo_aporte_id, tasa_empleado, tasa_patronal, tope_base, piso_base,
   vigente_desde, vigente_hasta, base_legal)
-- Los NULL de un VALUES sin tipo se resuelven como text: hay que castear
-- explícitamente para que coincidan con decimal(12,2) en la tabla.
SELECT t.id, v.tasa_empleado::numeric(6,4), v.tasa_patronal::numeric(6,4),
       v.tope_base::numeric(12,2), v.piso_base::numeric(12,2),
       DATE '2000-01-01', NULL, v.base_legal
FROM (VALUES
  ('SSO',          0.0400, 0.0900, NULL, NULL, 'Ley del Seguro Social'),
  ('PARO_FORZOSO', 0.0050, 0.0200, NULL, NULL, 'Ley del Régimen Prestacional de Empleo'),
  ('VIVIENDA',     0.0100, 0.0200, NULL, NULL, 'Ley del Régimen Prestacional de Vivienda y Hábitat'),
  ('INCES',        0.0000, 0.0200, NULL, NULL, 'Ley del INCES')
) AS v(codigo, tasa_empleado, tasa_patronal, tope_base, piso_base, base_legal)
JOIN tipo_aporte_ley t ON t.codigo = v.codigo
ON CONFLICT (tipo_aporte_id, vigente_desde) DO NOTHING;

-- ----------------------------------------------------------
-- 5. Subsistema Payroll, clases y métodos
-- ----------------------------------------------------------
INSERT INTO subsistema (nombre, descripcion)
VALUES ('Payroll', 'Cálculo y pago de nómina')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, c.nombre, c.descripcion
FROM subsistema s
CROSS JOIN (VALUES
  ('Cargo',       'Tarifas sugeridas por cargo'),
  ('Hours',       'Registro de horas trabajadas'),
  ('Concept',     'Conceptos y asignaciones recurrentes'),
  ('Novedad',     'Novedades puntuales del período'),
  ('Loan',        'Préstamos y cuotas'),
  ('Period',      'Períodos de nómina'),
  ('Receipt',     'Recibos de pago'),
  ('Affiliation', 'Afiliaciones a aportes de ley')
) AS c(nombre, descripcion)
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Payroll'
JOIN (VALUES
  ('Cargo',   'actualizarValorHora', 'Asigna la tarifa hora base de un cargo'),
  ('Cargo',   'listarCargosTarifa',  'Lista cargos activos con su tarifa base'),
  ('Hours',   'registrar',           'Registra horas normales y extra de un día'),
  ('Hours',   'listarPorPersona',    'Lista las horas de una persona en un rango'),
  ('Hours',   'listarPorPeriodo',    'Lista las horas de un período'),
  ('Hours',   'misHoras',            'Devuelve las horas del usuario autenticado'),
  ('Hours',   'eliminar',            'Elimina un registro de horas en período borrador'),
  ('Concept', 'listar',              'Lista los conceptos activos'),
  ('Concept', 'asignarRecurrente',   'Asigna un concepto recurrente a una persona'),
  ('Concept', 'quitarRecurrente',    'Cierra la vigencia de un concepto recurrente'),
  ('Concept', 'listarRecurrentes',   'Lista los conceptos recurrentes de una persona'),
  ('Novedad', 'registrar',           'Registra una novedad puntual'),
  ('Novedad', 'aprobar',             'Aprueba una novedad pendiente'),
  ('Novedad', 'rechazar',            'Rechaza una novedad pendiente'),
  ('Novedad', 'listarPorPeriodo',    'Lista las novedades de un período'),
  ('Loan',    'crear',               'Crea un préstamo y sus cuotas'),
  ('Loan',    'listar',              'Lista los préstamos de una persona'),
  ('Loan',    'saldos',              'Calcula el saldo pendiente de un préstamo'),
  ('Loan',    'anular',              'Anula un préstamo sin cuotas descontadas'),
  ('Loan',    'misPrestamos',        'Devuelve los préstamos del usuario autenticado'),
  ('Period',  'crear',               'Crea un período de nómina en borrador'),
  ('Period',  'procesar',            'Calcula y genera los recibos del período'),
  ('Period',  'pagar',               'Marca los recibos y el período como pagados'),
  ('Period',  'anular',              'Anula un período procesado y revierte sus efectos'),
  ('Period',  'listar',              'Lista los períodos de nómina'),
  ('Period',  'ver',                 'Devuelve un período con sus recibos'),
  ('Receipt', 'ver',                 'Devuelve un recibo con su desglose'),
  ('Receipt', 'listarPorPeriodo',    'Lista los recibos de un período'),
  ('Receipt', 'misRecibos',          'Lista los recibos del usuario autenticado'),
  ('Receipt', 'miDesglose',          'Devuelve el desglose de un recibo propio'),
  ('Affiliation', 'registrar',       'Registra la afiliación de una persona a un aporte de ley'),
  ('Affiliation', 'listar',          'Lista las afiliaciones de ley de una persona'),
  ('Affiliation', 'darDeBaja',       'Da de baja una afiliación de ley')
) AS m(clase, nombre, descripcion)
  ON m.clase = c.nombre
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 6. Permisos de método
-- ----------------------------------------------------------
-- RRHH (y GerenteRRHH por compatibilidad), Administrador y Superusuario:
-- todos los métodos de Payroll.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario')
ON CONFLICT DO NOTHING;

-- Empleado: solo lectura de lo propio.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Empleado'
  AND m.nombre IN ('misHoras', 'misRecibos', 'miDesglose', 'misPrestamos')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 7. Opciones de menú (lo que se ve)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, o.nombre, o.descripcion, o.orden
FROM subsistema s
CROSS JOIN (VALUES
  ('Periodos',    'Gestión de períodos de nómina', 1),
  ('Horas',       'Registro de horas trabajadas',  2),
  ('Novedades',   'Novedades puntuales',           3),
  ('Prestamos',   'Gestión de préstamos',          4),
  ('Conceptos',   'Conceptos y recurrentes',       5),
  ('Cargos',      'Tarifas por cargo',             6),
  ('Afiliaciones','Afiliaciones a aportes de ley', 7),
  ('MisRecibos',  'Recibos del empleado',          8)
) AS o(nombre, descripcion, orden)
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario')
  AND o.nombre <> 'MisRecibos'
ON CONFLICT DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
WHERE pf.nombre_perfil = 'Empleado'
  AND o.nombre = 'MisRecibos'
ON CONFLICT DO NOTHING;

COMMIT;
