-- ==========================================================
-- Migración 017 — PDF del recibo
--
-- Agrega a la clase Payroll/Receipt el método:
--
--   generarPdf   devuelve el recibo en PDF como base64
--
-- El PDF se genera en memoria con pdfkit y viaja por /execute, así que no
-- hay ruta nueva ni permiso nuevo por fuera del mapa de métodos. El filtro
-- de pertenencia (un Empleado solo descarga su recibo) lo aplica el BO.
--
-- Sin cambio de esquema. Sin opción de menú nueva: la descarga vive dentro
-- de las pantallas de recibos que ya existen.
--
-- Aplica sobre una base con 001–016. Idempotente.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Método de la clase Receipt
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('generarPdf', 'Genera el PDF de un recibo y lo devuelve en base64')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Receipt'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Permisos de método
-- ----------------------------------------------------------
-- Gestores: cualquier recibo. Empleado: el BO valida que sea el suyo.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Receipt'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre = 'generarPdf'
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario', 'Empleado')
ON CONFLICT DO NOTHING;

COMMIT;
