-- Seguridad y sesión: dos subsistemas. 'Session' agrupa la autenticación
-- (clase Session); 'Security' agrupa Menu, Admin y User. Se siembran los
-- subsistemas, sus clases y métodos, y los perfiles con sus permisos.
--
-- Perfiles sembrados: Publico (visitante sin sesión), Empleado, GerenteRRHH,
-- Administrador y Superusuario. Los nombres van sin espacios para que sirvan
-- de llave del mapa en memoria (Subsistema_Clase_metodo_perfil).
--
-- Correr DESPUÉS de db/init.sql. Idempotente: se puede correr varias veces
-- sin duplicar filas.

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

-- Clase Token: refresco de tokens JWT. Va en el subsistema 'Session' porque
-- es una operación de sesión (como login), no de seguridad.
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Token', 'Refresco de tokens de sesión'
FROM subsistema s
WHERE s.nombre = 'Session'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'refresh', 'Rota el refresh token y emite un access token nuevo'
FROM clase c
WHERE c.nombre = 'Token'
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

-- Clase Admin: tareas de administración. Solo Administrador y Superusuario.
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

-- Clase User: alta de usuarios (Usuario.registrar) y cambio de la propia
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
-- Perfiles.
-- ---------------------------------------------------------------------------
-- Publico: lo usan los visitantes sin sesión (login, sessionExist y getSession
-- están en la lista blanca del esquema del profe). logout también va acá:
-- cerrar la propia sesión debe poder hacerlo cualquier perfil.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Publico', 'Permisos de cualquier visitante, con o sin sesión')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Empleado: usuario final. Solo entra al sistema y ve su menú; no administra.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Empleado', 'Usuario final: sesión y consulta, sin administración')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Gerente de Recursos Humanos: gestiona personas y usuarios (registrar), sin
-- tocar la administración de la seguridad (reloadPermissions).
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('GerenteRRHH', 'Gerente de Recursos Humanos: gestiona personas y usuarios')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Administrador: administra la seguridad (reloadPermissions) y los usuarios.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Administrador', 'Administra la seguridad y los usuarios del sistema')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Superusuario: acceso total. Perfil de máximo privilegio para pruebas.
INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Superusuario', 'Acceso total al sistema')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permisos de método por perfil.
-- ---------------------------------------------------------------------------

-- Publico: sesión completa (para entrar/salir) y las opciones del menú.
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

-- refresh es público: el cliente renueva tokens sin sesión previa (la
-- credencial es el propio refresh token). Va en 'Publico', como login.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Token'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Session')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Publico'
  AND m.nombre = 'refresh'
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

-- Empleado: sesión (entrar, salir, ver su sesión), menú y cambiar su clave.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id IN (
       SELECT id FROM subsistema WHERE nombre IN ('Session', 'Security')
     )
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Empleado'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession', 'refresh',
                   'getOptions', 'cambiarClave')
ON CONFLICT DO NOTHING;

-- GerenteRRHH: todo lo del Empleado más el alta de usuarios (registrar).
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id IN (
       SELECT id FROM subsistema WHERE nombre IN ('Session', 'Security')
     )
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'GerenteRRHH'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession', 'refresh',
                   'getOptions', 'cambiarClave', 'registrar')
ON CONFLICT DO NOTHING;

-- Administrador: sesión, menú, administración de seguridad y usuarios.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id IN (
       SELECT id FROM subsistema WHERE nombre IN ('Session', 'Security')
     )
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Administrador'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession', 'refresh',
                   'getOptions', 'cambiarClave', 'registrar',
                   'reloadPermissions')
ON CONFLICT DO NOTHING;

-- Superusuario: permiso a TODOS los métodos de Session y de Security.
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
-- Opciones de ejemplo del subsistema Security (lo que el menú muestra).
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

-- ---------------------------------------------------------------------------
-- Permisos de opción por perfil (lo que cada perfil ve en el menú).
-- ---------------------------------------------------------------------------

-- Administrador y Superusuario ven la gestión de usuarios y perfiles.
INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil IN ('Administrador', 'Superusuario')
ON CONFLICT DO NOTHING;

-- GerenteRRHH ve el alta de usuarios (registrar) y la gestión de usuarios.
INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
JOIN opcion o
  ON o.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
WHERE pf.nombre_perfil = 'GerenteRRHH'
  AND o.nombre IN ('registrar', 'Usuarios')
ON CONFLICT DO NOTHING;

COMMIT;
