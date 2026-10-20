-- Perfil de superusuario y su asignación al usuario de prueba.
-- Correr DESPUÉS de db/migrations/002_esquema_seguridad.sql
-- (Usuario ya no tiene Perfil_id; los perfiles viven en Usuario_Perfil).
-- El usuario admin_prueba y su clave bcrypt los crea db/seed-login.sql.
-- Idempotente: se puede correr varias veces sin duplicar datos.
--
-- Nota: los permisos de métodos del perfil (Permiso_Metodo) se cargan con
-- db/seed-seguridad.sql, cuando existan los métodos de cada subsistema.

BEGIN;

INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('Superusuario', 'Acceso total al sistema')
ON CONFLICT (nombre_perfil) DO NOTHING;

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
