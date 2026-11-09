-- ==========================================================
-- Migración 007 — Permisos de las opciones de menú de Security
--
-- La base viva tenía las opciones registrar/Usuarios/Perfiles sin ningún
-- permiso_opcion: el seed no llegó a aplicarse completo. Esta migración las
-- concede según lo que cada perfil PUEDE EJECUTAR hoy (no según el seed
-- viejo, que le daba "registrar" a Administrador aunque la 003 le quitó ese
-- método):
--
--   registrar → Superusuario, RRHH, GerenteRRHH
--   Usuarios  → Superusuario, Administrador, RRHH, GerenteRRHH
--   Perfiles  → Superusuario, Administrador
--
-- La opción Permisos (migración 006) sigue exclusiva de Superusuario y no se
-- toca acá.
--
-- Aplica sobre una base con 001–006. Idempotente.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Asegurar que las opciones existen (mismo orden del seed)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, o.nombre, o.descripcion, o.orden
FROM subsistema s
CROSS JOIN (VALUES
  ('registrar', 'Registrar un nuevo usuario', 1),
  ('Usuarios',  'Gestión de usuarios', 2),
  ('Perfiles',  'Gestión de perfiles y permisos', 3)
) AS o(nombre, descripcion, orden)
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Conceder cada opción a los perfiles que la pueden usar
-- ----------------------------------------------------------
INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'registrar'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil IN ('Superusuario', 'RRHH', 'GerenteRRHH')
ON CONFLICT DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'Usuarios'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil IN ('Superusuario', 'Administrador', 'RRHH', 'GerenteRRHH')
ON CONFLICT DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'Perfiles'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil IN ('Superusuario', 'Administrador')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 3. Dejar la matriz determinista ante un re-run del seed
-- ----------------------------------------------------------
-- El seed concede TODAS las opciones de Security a Administrador y
-- Superusuario. Si se reejecuta después de esta migración, hay que volver a
-- quitar los grants que no corresponden a lo que el perfil puede ejecutar.
DELETE FROM permiso_opcion po
USING opcion o, perfil pf, subsistema s
WHERE po.opcion_id = o.id
  AND po.perfil_id = pf.id
  AND o.subsistema_id = s.id
  AND s.nombre = 'Security'
  AND (
    (o.nombre = 'registrar'
      AND pf.nombre_perfil NOT IN ('Superusuario', 'RRHH', 'GerenteRRHH'))
    OR (o.nombre = 'Usuarios'
      AND pf.nombre_perfil NOT IN ('Superusuario', 'Administrador', 'RRHH', 'GerenteRRHH'))
    OR (o.nombre = 'Perfiles'
      AND pf.nombre_perfil NOT IN ('Superusuario', 'Administrador'))
  );

COMMIT;
