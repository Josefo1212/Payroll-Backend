-- Usuario temporal para probar el login por POST /api/execute
-- (subsystem "Seguridad", class "Sesion", method "login").
-- La clave se guarda con bcrypt (hash cost 12 de "Password123"): el login usa
-- bcrypt.compare, así que no puede quedar en texto plano. Regenerar con:
--   node scripts/hash-password.js "Password123"
--
-- Idempotente. Requiere db/migrations/002_esquema_seguridad.sql aplicada
-- (Usuario ya no tiene Perfil_id; los perfiles viven en Usuario_Perfil y los
-- asigna db/seed-superusuario.sql).
--
-- Datos para probar: username admin_prueba / password Password123

BEGIN;

INSERT INTO persona (cedula, primer_nombre, primer_apellido, email)
VALUES ('TEST-LOGIN-001', 'Usuario', 'Prueba', 'usuario.prueba@local.test')
ON CONFLICT (cedula) DO NOTHING;

INSERT INTO usuario (persona_id, username, password_hash)
SELECT p.id, 'admin_prueba', '$2b$12$GqShTrQm552qyROnu2.0PeIGFY04MZngsnfsOyitCmp99L4gIEx2e'
FROM persona p
WHERE p.cedula = 'TEST-LOGIN-001'
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

COMMIT;
