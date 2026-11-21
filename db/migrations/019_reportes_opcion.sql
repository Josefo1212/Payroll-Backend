-- ==========================================================
-- Migración 019 — Opción de menú "Reportes"
--
-- Agrega una opción al subsistema Payroll para la pantalla que reúne el
-- resumen final de todos los períodos emitidos y un reporte por empleado.
-- No hay cambio de esquema ni métodos nuevos: la pantalla reutiliza
-- Period.listarConTotales, Period.resumen, Receipt.listarPorPeriodo y
-- Receipt.generarPdf, que ya existen y tienen permisos concedidos.
--
-- Aplica sobre una base con 001–018. Idempotente.
-- ==========================================================

BEGIN;

INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'Reportes', 'Resumen final y reportes por empleado', 13
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
 AND o.nombre = 'Reportes'
WHERE pf.nombre_perfil IN ('RRHH', 'Superusuario')
ON CONFLICT DO NOTHING;

-- El seed de seguridad concede todas las opciones de Payroll a otros perfiles.
-- Si se reejecuta, se revierte el acceso para que Reportes siga siendo solo
-- de RRHH y Superusuario, igual que Personas, Despidos y PreNomina.
DELETE FROM permiso_opcion po
USING opcion o, perfil pf
WHERE po.opcion_id = o.id
  AND po.perfil_id = pf.id
  AND o.nombre = 'Reportes'
  AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
  AND pf.nombre_perfil NOT IN ('RRHH', 'Superusuario');

COMMIT;
