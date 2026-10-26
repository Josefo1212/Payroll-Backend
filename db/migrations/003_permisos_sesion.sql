-- Permisos de sesión y menú que faltaban en la base con datos.
-- La base viva solo tenía permisos de Security/User/*, por lo que un usuario
-- recién registrado podía autenticarse (login es anónimo) pero la primera
-- llamada autenticada (getSession/getOptions) respondía 403.
BEGIN;

-- Empleado: sesión, menú y cambio de su propia clave.
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

-- RRHH: lo del Empleado más alta de usuarios y consulta de cargos/perfiles.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id IN (
       SELECT id FROM subsistema WHERE nombre IN ('Session', 'Security')
     )
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'RRHH'
  AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession', 'refresh',
                   'getOptions', 'cambiarClave', 'registrar', 'listarCargos',
                   'listarPerfiles')
ON CONFLICT DO NOTHING;

-- Administrador: sesión, menú, administración de seguridad y perfiles.
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
                   'getOptions', 'cambiarClave', 'listarPerfiles',
                   'reloadPermissions')
ON CONFLICT DO NOTHING;

-- Superusuario: todos los métodos de Session y Security.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id IN (
       SELECT id FROM subsistema WHERE nombre IN ('Session', 'Security')
     )
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Superusuario'
ON CONFLICT DO NOTHING;

COMMIT;
