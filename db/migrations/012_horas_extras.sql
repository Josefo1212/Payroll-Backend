-- ==========================================================
-- Migración 012 — Registro de horas extras (solo Superusuario)
--
-- Agrega a Payroll/Hours los tres métodos de la pantalla de horas extras:
-- registrarExtra, listarExtrasPorPeriodo y quitarExtra. Les concede permiso
-- SOLO a Superusuario y crea la opción de menú "HorasExtras", también
-- exclusiva de ese perfil.
--
-- No hay cambio de esquema: la extra se guarda en la columna
-- registro_horas.horas_extra que ya existe desde la migración 004. La
-- pantalla actual "Horas" (RRHH y Superusuario) se mantiene igual.
--
-- Aplica sobre una base con 001–011. Idempotente: se puede correr varias
-- veces sin duplicar filas.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Métodos de la clase Hours
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('registrarExtra',        'Registra o suma horas extra de una persona en una fecha'),
  ('listarExtrasPorPeriodo', 'Lista los registros con horas extra de un período'),
  ('quitarExtra',           'Quita las horas extra sin borrar las horas normales')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Hours'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Permisos de método: solo Superusuario
-- ----------------------------------------------------------
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Hours'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('registrarExtra', 'listarExtrasPorPeriodo', 'quitarExtra')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 3. Opción de menú "HorasExtras" (subsistema Payroll)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'HorasExtras', 'Registro de horas extras (solo Superusuario)', 9
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'HorasExtras'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- La 004 concede todas las opciones de Payroll a RRHH/GerenteRRHH/
-- Administrador/Superusuario. Si se reejecuta después de esta migración,
-- "HorasExtras" quedaría visible para esos perfiles; se revierte para que
-- sea exclusiva de Superusuario.
DELETE FROM permiso_opcion po
USING opcion o, perfil pf
WHERE po.opcion_id = o.id
  AND po.perfil_id = pf.id
  AND o.nombre = 'HorasExtras'
  AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
  AND pf.nombre_perfil <> 'Superusuario';

COMMIT;
