-- Usuario de prueba para POST /api/login.
-- La clave se guarda con bcrypt (hash de "Password123"): el login usa
-- bcrypt.compare, así que no puede quedar en texto plano.
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
SELECT p.id, 'admin_prueba', '$2b$10$93.QVTRjE/YqitiDABUWjOPptF8ttvayvbVFEWz3AGBuyeVVydxg2'
FROM persona p
WHERE p.cedula = 'TEST-LOGIN-001'
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

COMMIT;
