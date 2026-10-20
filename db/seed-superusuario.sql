-- Asigna el usuario de prueba (admin_prueba, creado por db/seed-login.sql) al
-- perfil 'Superusuario'.
-- Correr DESPUÉS de db/migrations/002_esquema_seguridad.sql y de
-- db/seed-seguridad.sql (que crea el perfil 'Superusuario').
-- Idempotente: se puede correr varias veces sin duplicar datos.
--
-- Nota: los permisos de métodos del perfil (Permiso_Metodo) se cargan con
-- db/seed-seguridad.sql, cuando existan los métodos de cada subsistema.

BEGIN;

-- El perfil temporal de prueba deja de aplicar: el usuario de prueba pasa a
-- ser superusuario. La sesión todavía guarda un solo perfil, así que se quita
-- el vínculo viejo para que el login resuelva a 'Superusuario'.
DELETE FROM usuario_perfil up
USING usuario u, perfil pf
WHERE up.usuario_id = u.id
  AND up.perfil_id = pf.id
  AND u.username = 'admin_prueba'
  AND pf.nombre_perfil = 'PRUEBA_LOGIN';

INSERT INTO usuario_perfil (usuario_id, perfil_id)
SELECT u.id, pf.id
FROM usuario u
JOIN perfil pf ON pf.nombre_perfil = 'Superusuario'
WHERE u.username = 'admin_prueba'
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

COMMIT;
