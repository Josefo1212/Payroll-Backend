-- ==========================================================
-- Migración 016 — Resumen de nómina
--
-- Agrega a la clase Payroll/Period dos métodos de solo lectura:
--
--   resumen            totales y desglose por concepto de un período
--   listarConTotales   histórico de períodos con sus totales
--
-- Los totales salen de recibo_pago (sin los recibos ANULADO). El aporte
-- patronal se suma desde detalle_recibo: no es columna de recibo_pago y no
-- forma parte del neto, solo del costo total.
--
-- Sin cambio de esquema. No hay opción de menú nueva: el resumen vive dentro
-- de la pantalla de períodos. Permisos para los mismos perfiles que ya operan
-- Period (RRHH, GerenteRRHH, Administrador y Superusuario).
--
-- Aplica sobre una base con 001–015. Idempotente.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Métodos de la clase Period
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('resumen',          'Devuelve los totales y el desglose por concepto de un período'),
  ('listarConTotales', 'Lista los períodos con sus totales agregados')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Period'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Permisos de método
-- ----------------------------------------------------------
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Period'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('resumen', 'listarConTotales')
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario')
ON CONFLICT DO NOTHING;

COMMIT;
