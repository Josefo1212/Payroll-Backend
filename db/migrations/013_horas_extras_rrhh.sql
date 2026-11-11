-- ==========================================================
-- Migración 013 — Horas extras también para RRHH
--
-- La 012 dejó la pantalla de horas extras exclusiva de Superusuario. Esta
-- migración concede los tres métodos de Payroll/Hours y la opción de menú
-- "HorasExtras" también a RRHH (y GerenteRRHH por compatibilidad), que es
-- quien registra las horas del personal.
--
-- No hay cambio de esquema: solo filas de permiso_metodo y permiso_opcion.
-- Aplica sobre una base con 001–012. Idempotente.
--
-- Nota de orden: debe correr DESPUÉS de la 012. La 012 revierte "HorasExtras"
-- a los perfiles distintos de Superusuario para deshacer lo que sembró la
-- 004; volver a ejecutar la 012 sobre una base con la 013 quitaría el acceso
-- a RRHH y habría que reaplicar esta migración.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Métodos de la clase Hours
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
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 2. Opción de menú "HorasExtras"
-- ----------------------------------------------------------
INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'HorasExtras'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH')
ON CONFLICT DO NOTHING;

COMMIT;
