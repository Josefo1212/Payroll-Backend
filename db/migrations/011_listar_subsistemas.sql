-- ==========================================================
-- Migración 011 — Listado de subsistemas para el catálogo de opciones
--
-- El formulario de "crear opción" necesita elegir un subsistema. Hasta ahora
-- los ids solo se podían deducir de las opciones existentes, así que un
-- subsistema sin opciones (p. ej. Session) no aparecía.
--
-- Agrega Security/Admin/listarSubsistemas y lo concede SOLO a Superusuario.
-- Aplica sobre una base con 001–010. Idempotente.
-- ==========================================================

BEGIN;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'listarSubsistemas',
       'Lista los subsistemas con su id para crear opciones de menú'
FROM clase c
WHERE c.nombre = 'Admin'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Admin'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre = 'listarSubsistemas'
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

COMMIT;
