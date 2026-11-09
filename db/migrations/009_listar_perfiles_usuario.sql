-- ==========================================================
-- Migración 009 — Security/User/listarPerfilesUsuario
--
-- La vista de administración de perfiles necesita mostrar qué perfiles tiene
-- hoy un usuario antes de reemplazarlos. `establecerPerfilesUsuario` devuelve
-- el conjunto nuevo, pero no hay forma de leer el actual.
--
--   listarPerfilesUsuario → Superusuario, Administrador
--
-- Solo lectura; no cambia el esquema. Aplica sobre una base con 001–008.
-- Idempotente.
-- ==========================================================

BEGIN;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'listarPerfilesUsuario',
       'Lista los perfiles de un usuario con su estado'
FROM clase c
WHERE c.nombre = 'User'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN metodo m ON m.nombre = 'listarPerfilesUsuario'
JOIN clase c ON c.id = m.clase_id AND c.nombre = 'User'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE pf.nombre_perfil IN ('Superusuario', 'Administrador')
ON CONFLICT DO NOTHING;

-- Defensa ante un re-run del seed: la lectura queda solo en esos dos perfiles.
DELETE FROM permiso_metodo pm
USING metodo m, clase c, subsistema s, perfil pf
WHERE pm.metodo_id = m.id
  AND pm.perfil_id = pf.id
  AND c.id = m.clase_id
  AND s.id = c.subsistema_id
  AND s.nombre = 'Security'
  AND c.nombre = 'User'
  AND m.nombre = 'listarPerfilesUsuario'
  AND pf.nombre_perfil NOT IN ('Superusuario', 'Administrador');

COMMIT;
