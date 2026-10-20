-- Seguridad: subsistema, clases Sesion, Menu y Admin, sus métodos y los
-- perfiles 'Publico' y 'Superusuario' con sus permisos de método.
-- Correr DESPUÉS de db/migrations/002_esquema_seguridad.sql.
-- Idempotente: se puede correr varias veces sin duplicar datos.
--
-- Contraseña del hash de seed-login.sql: Password123
-- (regenerar con: node scripts/hash-password.js "Password123")

BEGIN;

INSERT INTO subsistema (nombre, descripcion)
VALUES ('Seguridad', 'Autenticación, sesiones y permisos')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Sesion', 'Objeto de negocio de autenticación'
FROM subsistema s
WHERE s.nombre = 'Seguridad'
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
WHERE c.nombre = 'Sesion'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Seguridad')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Clase Menu: las opciones visibles del usuario. Se autoriza a 'Publico'
-- porque el filtrado real por perfil lo hace getOptions() con los perfiles de
-- la sesión; sin sesión devuelve [].
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Menu', 'Opciones visibles del usuario'
FROM subsistema s
WHERE s.nombre = 'Seguridad'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'getOptions', 'Devuelve las opciones visibles para la sesión'
FROM clase c
WHERE c.nombre = 'Menu'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Seguridad')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Clase Admin: tareas de administración. Solo Superusuario.
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Admin', 'Administración de la seguridad'
FROM subsistema s
WHERE s.nombre = 'Seguridad'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'reloadPermissions', 'Recarga los permisos en memoria sin reiniciar'
FROM clase c
WHERE c.nombre = 'Admin'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Seguridad')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Perfil público: lo usan los visitantes sin sesión (login, sessionExist y
-- getSession están en la lista blanca del esquema del profe). logout también
-- va acá: cerrar la propia sesión debe poder hacerlo cualquier perfil, no
-- solo Superusuario.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Publico', 'Permisos de cualquier visitante, con o sin sesión')
ON CONFLICT (nombre_perfil) DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre = 'Sesion'
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession')
ON CONFLICT DO NOTHING;

-- getOptions es público: sin sesión devuelve []; con sesión, el propio BO
-- filtra por los perfiles.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre = 'Menu'
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre = 'getOptions'
ON CONFLICT DO NOTHING;

-- Superusuario: permiso a TODOS los métodos (logout y admin incluidos).
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre IN ('Sesion', 'Menu', 'Admin')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

COMMIT;
