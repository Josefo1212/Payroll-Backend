-- Usuario temporal para probar el login por POST /api/execute
-- (subsystem "Seguridad", class "Sesion", method "login").
-- La contraseña va como hash bcrypt (cost 12), generado con:
--   node scripts/hash-password.js "Password123"

BEGIN;

INSERT INTO perfil (nombre_perfil, descripcion)
VALUES ('PRUEBA_LOGIN', 'Perfil temporal para probar el inicio de sesión')
ON CONFLICT (nombre_perfil) DO NOTHING;

INSERT INTO persona (
    cedula,
    primer_nombre,
    primer_apellido,
    email
)
VALUES (
    'TEST-LOGIN-001',
    'Usuario',
    'Prueba',
    'usuario.prueba@local.test'
)
ON CONFLICT (cedula) DO NOTHING;

INSERT INTO usuario (
    persona_id,
    username,
    password_hash
)
SELECT
    p.id,
    'admin_prueba',
    '$2b$12$GqShTrQm552qyROnu2.0PeIGFY04MZngsnfsOyitCmp99L4gIEx2e'
FROM persona p
WHERE p.cedula = 'TEST-LOGIN-001'
ON CONFLICT (username) DO NOTHING;

COMMIT;

-- Datos para probar:
-- username: admin_prueba
-- password: Password123
