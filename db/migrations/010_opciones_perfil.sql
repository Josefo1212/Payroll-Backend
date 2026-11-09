-- ==========================================================
-- Migración 010 — Administración de opciones de menú por perfil
--
-- Agrega a Security/Admin los siete métodos de la spec 011, les concede
-- permiso SOLO a Superusuario y crea la opción de menú "Opciones", también
-- exclusiva de ese perfil.
--
-- El lado de métodos (spec 009) no se toca: sus cuatro métodos y la opción
-- "Permisos" ya existen desde la migración 006.
--
-- Aplica sobre una base con 001–009. Idempotente: se puede correr varias
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
  ('listarOpciones',       'Lista el catálogo de opciones de menú (activas e inactivas)'),
  ('crearOpcion',          'Crea una opción de menú en un subsistema'),
  ('editarOpcion',         'Edita nombre, descripción y orden de una opción'),
  ('cambiarEstadoOpcion',  'Activa o desactiva una opción y actualiza el mapa en memoria'),
  ('listarPermisosOpcion', 'Lista las opciones asignadas a un perfil'),
  ('asignarPermisoOpcion', 'Asigna una opción a un perfil y actualiza el mapa en memoria'),
  ('quitarPermisoOpcion',  'Quita una opción a un perfil y actualiza el mapa en memoria')
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
 AND m.nombre IN ('listarOpciones', 'crearOpcion', 'editarOpcion',
                  'cambiarEstadoOpcion', 'listarPermisosOpcion',
                  'asignarPermisoOpcion', 'quitarPermisoOpcion')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 3. Opción de menú "Opciones" (subsistema Security)
-- ----------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'Opciones', 'Asignación de opciones de menú a perfiles', 5
FROM subsistema s
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.nombre = 'Opciones'
 AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- El seed concede TODAS las opciones del subsistema Security a Administrador
-- y Superusuario. Si se reejecuta después de esta migración, "Opciones"
-- quedaría visible para Administrador; se revierte para que sea exclusiva.
DELETE FROM permiso_opcion po
USING opcion o, perfil pf
WHERE po.opcion_id = o.id
  AND po.perfil_id = pf.id
  AND o.nombre = 'Opciones'
  AND o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
  AND pf.nombre_perfil <> 'Superusuario';

COMMIT;
