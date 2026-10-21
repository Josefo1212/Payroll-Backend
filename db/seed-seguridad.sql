-- Sesión y seguridad: dos subsistemas. 'Session' agrupa la autenticación
-- (clase Session); 'Security' agrupa Menu, Admin y User. Se siembran sus
-- métodos y los perfiles 'Publico' y 'Superusuario' con sus permisos.
-- Correr DESPUÉS de db/migrations/006_subsistema_sesion.sql.
-- Idempotente: se puede correr varias veces sin duplicar datos.
-- Crea por sí mismo el perfil 'Superusuario' (no depende de
-- db/seed-superusuario.sql, que solo asigna el usuario de prueba).
--
-- Contraseña del hash de seed-login.sql: Password123
-- (regenerar con: node scripts/hash-password.js "Password123")

BEGIN;

INSERT INTO subsistema (nombre, descripcion)
VALUES ('Security', 'Permisos, menú y administración')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO subsistema (nombre, descripcion)
VALUES ('Session', 'Autenticación y sesiones')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Clase Session: autenticación como objeto de negocio. Subsistema 'Session'.
-- ---------------------------------------------------------------------------
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Session', 'Objeto de negocio de autenticación'
FROM subsistema s
WHERE s.nombre = 'Session'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
    ('login', 'Autentica usuario y crea la sesión'),
    ('logout', 'Destruye la sesión'),
    ('getSession', 'Devuelve los datos de la sesión activa'),
    ('sessionExist', 'Indica si hay una sesión vigente')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Session'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Session')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Clase Menu: las opciones visibles del usuario. Se autoriza a 'Publico'
-- porque el filtrado real por perfil lo hace getOptions() con los perfiles de
-- la sesión; sin sesión devuelve [].
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Menu', 'Opciones visibles del usuario'
FROM subsistema s
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'getOptions', 'Devuelve las opciones visibles para la sesión'
FROM clase c
WHERE c.nombre = 'Menu'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Clase Admin: tareas de administración. Solo Superusuario.
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Admin', 'Administración de la seguridad'
FROM subsistema s
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'reloadPermissions', 'Recarga los permisos en memoria sin reiniciar'
FROM clase c
WHERE c.nombre = 'Admin'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Clase Usuario: alta de usuarios (Usuario.registrar) y cambio de la propia
-- contraseña (Usuario.cambiarClave).
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'User', 'Objeto de negocio de usuarios del sistema'
FROM subsistema s
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
    ('registrar', 'Registra una persona y su usuario en una transacción'),
    ('cambiarClave', 'Cambia la contraseña del usuario autenticado')
) AS m(nombre, descripcion)
WHERE c.nombre = 'User'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Perfiles y sus permisos.
-- ---------------------------------------------------------------------------

-- Perfil público: lo usan los visitantes sin sesión (login, sessionExist y
-- getSession están en la lista blanca del esquema del profe). logout también
-- va acá: cerrar la propia sesión debe poder hacerlo cualquier perfil, no
-- solo Superusuario.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Publico', 'Permisos de cualquier visitante, con o sin sesión')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Superusuario: acceso total. Se crea acá para que este seed sea autónomo
-- (db/seed-superusuario.sql solo asigna el usuario de prueba a este perfil).
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Superusuario', 'Acceso total al sistema')
ON CONFLICT (nombre_perfil) DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Session'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Session')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession')
ON CONFLICT DO NOTHING;

-- getOptions es público: sin sesión devuelve []; con sesión, el propio BO
-- filtra por los perfiles.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Menu'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre = 'getOptions'
ON CONFLICT DO NOTHING;

-- cambiarClave es público como permiso de método, pero el BO exige sesión:
-- cualquier usuario autenticado puede cambiar su propia clave.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'User'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre = 'cambiarClave'
ON CONFLICT DO NOTHING;

-- Superusuario: permiso a TODOS los métodos de Session y de Security
-- (logout, admin y usuario incluidos).
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Session')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre IN ('Menu', 'Admin', 'User')
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Opciones de ejemplo del subsistema Seguridad (lo que el menú muestra). Sus
-- permisos se asignan a Superusuario para que Menu.getOptions no devuelva []
-- tras el login de admin_prueba.
-- ---------------------------------------------------------------------------
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, o.nombre, o.descripcion, o.orden
FROM subsistema s
CROSS JOIN (VALUES
    ('registrar', 'Registrar un nuevo usuario', 1),
    ('Usuarios', 'Gestión de usuarios', 2),
    ('Perfiles', 'Gestión de perfiles y permisos', 3)
) AS o(nombre, descripcion, orden)
WHERE s.nombre = 'Security'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

COMMIT;
