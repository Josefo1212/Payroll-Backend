-- ==========================================================
-- Migración 008 — Administración de perfiles y asignación a usuarios
--
-- Agrega a Security/Admin los cuatro métodos de la vista de perfiles y a
-- Security/User el que reemplaza el conjunto de perfiles de un usuario.
--
-- Permisos:
--   listarPerfilesAdmin       → Superusuario, Administrador
--   crearPerfil               → Superusuario
--   editarPerfil              → Superusuario
--   cambiarEstadoPerfil       → Superusuario
--   establecerPerfilesUsuario → Superusuario
--
-- No crea opciones nuevas: la opción "Perfiles" ya existe desde la 007 y solo
-- se le corrige la descripción. No hay cambio de esquema.
--
-- Aplica sobre una base con 001–007. Idempotente.
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. Métodos de la clase Admin
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('listarPerfilesAdmin', 'Lista todos los perfiles con su uso y si están protegidos'),
  ('crearPerfil',         'Crea un perfil con sus permisos mínimos de sesión'),
  ('editarPerfil',        'Edita el nombre y la descripción de un perfil'),
  ('cambiarEstadoPerfil', 'Activa o desactiva un perfil y refresca los mapas')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Admin'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Método de la clase User
-- ----------------------------------------------------------
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'establecerPerfilesUsuario',
       'Reemplaza el conjunto de perfiles de un usuario en una transacción'
FROM clase c
WHERE c.nombre = 'User'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ----------------------------------------------------------
-- 3. Permisos de método
-- ----------------------------------------------------------
-- Lectura: también Administrador, que ya ve la opción "Perfiles".
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN metodo m ON m.nombre = 'listarPerfilesAdmin'
JOIN clase c ON c.id = m.clase_id AND c.nombre = 'Admin'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE pf.nombre_perfil IN ('Superusuario', 'Administrador')
ON CONFLICT DO NOTHING;

-- Mutaciones: solo Superusuario.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN metodo m
  ON m.nombre IN ('crearPerfil', 'editarPerfil', 'cambiarEstadoPerfil',
                  'establecerPerfilesUsuario')
JOIN clase c
  ON c.id = m.clase_id
 AND c.nombre IN ('Admin', 'User')
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 4. Descripción de la opción "Perfiles"
-- ----------------------------------------------------------
UPDATE opcion
   SET descripcion = 'Gestión de perfiles'
 WHERE nombre = 'Perfiles'
   AND subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security');

-- ----------------------------------------------------------
-- 5. Matriz determinista ante un re-run del seed
-- ----------------------------------------------------------
-- El seed concede a Superusuario todos los métodos de Security, pero no debe
-- conceder las mutaciones a ningún otro perfil. Si una corrida posterior las
-- agregara, se revierten acá.
DELETE FROM permiso_metodo pm
USING metodo m, clase c, subsistema s, perfil pf
WHERE pm.metodo_id = m.id
  AND pm.perfil_id = pf.id
  AND c.id = m.clase_id
  AND s.id = c.subsistema_id
  AND s.nombre = 'Security'
  AND m.nombre IN ('crearPerfil', 'editarPerfil', 'cambiarEstadoPerfil',
                   'establecerPerfilesUsuario')
  AND pf.nombre_perfil <> 'Superusuario';

COMMIT;
