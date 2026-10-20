-- 005: crea el perfil 'Usuario' con acceso limitado y lo asigna al usuario de
-- prueba (admin_prueba), que hoy solo tiene 'Superusuario'.
--
-- A diferencia de 'Superusuario' (acceso total), 'Usuario' puede autenticarse,
-- consultar su sesión y ver el menú, pero NO ejecuta tareas de administración:
--   - NO tiene User.registrar (alta de usuarios)
--   - NO tiene Admin.reloadPermissions (recarga de permisos)
-- Sí tiene User.cambiarClave: cada quien cambia su propia contraseña.
--
-- Los permisos son filas de Permiso_Metodo (no hay tabla Permiso). El menú se
-- controla con Permiso_Opcion; 'Usuario' no recibe las opciones de gestión
-- ('registrar', 'Usuarios', 'Perfiles').
--
-- Idempotente: se puede correr varias veces sin duplicar datos.

BEGIN;

INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Usuario', 'Acceso limitado: sesión y menú, sin administración')
ON CONFLICT (nombre_perfil) DO NOTHING;

-- Métodos permitidos: los mismos de sesión/menú que 'Publico' (login, logout,
-- sessionExist, getSession, getOptions) más cambiarClave. Quedan fuera, a
-- propósito, registrar y reloadPermissions.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security')
JOIN metodo m ON m.clase_id = c.id
WHERE pf.nombre_perfil = 'Usuario'
  AND (
    (c.nombre = 'Session' AND m.nombre IN ('login', 'logout', 'sessionExist', 'getSession'))
    OR (c.nombre = 'Menu' AND m.nombre = 'getOptions')
    OR (c.nombre = 'User' AND m.nombre = 'cambiarClave')
  )
ON CONFLICT DO NOTHING;

-- Asigna el perfil al usuario de prueba, además de 'Superusuario'.
INSERT INTO usuario_perfil (usuario_id, perfil_id)
SELECT u.id, pf.id
FROM usuario u
JOIN perfil pf ON pf.nombre_perfil = 'Usuario'
WHERE u.username = 'admin_prueba'
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

COMMIT;
