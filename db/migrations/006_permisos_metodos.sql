-- ==========================================================
-- Migración 006 — Administración de permisos de método por perfil
--
-- Agrega a Security/Admin los cuatro métodos que usa la vista de
-- Superusuario, les concede permiso SOLO a ese perfil y crea la opción de
-- menú "Permisos", también exclusiva de Superusuario.
--
-- Aplica sobre una base con 001–005. Idempotente: se puede correr varias
-- veces sin duplicar filas.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Métodos de la clase Admin
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('listarMetodos',        'Lista los métodos activos por subsistema y clase'),
  ('listarPermisosMetodo', 'Lista los métodos asignados a un perfil'),
  ('asignarPermisoMetodo', 'Asigna un método a un perfil y actualiza el mapa en memoria'),
  ('quitarPermisoMetodo',  'Quita un método a un perfil y actualiza el mapa en memoria')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Admin'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Permisos de método: solo Superusuario
-- ----------------------------------------------------------
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Admin'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('listarMetodos', 'listarPermisosMetodo',
                  'asignarPermisoMetodo', 'quitarPermisoMetodo')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 3. Opción de menú "Permisos" (subsistema Security)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'Permisos', 'Asignación de métodos a perfiles', 4
FROM subsistema s
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'Permisos'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- El seed concede TODAS las opciones del subsistema Security a Administrador
-- y Superusuario. Si se reejecuta después de esta migración, "Permisos"
-- quedaría visible para Administrador; se revierte para que sea exclusiva.
DELETE FROM permiso_opcion po
USING opcion o, perfil pf
WHERE po.opcion_id = o.id
  AND po.perfil_id = pf.id
  AND o.nombre = 'Permisos'
  AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
  AND pf.nombre_perfil <> 'Superusuario';

COMMIT;
