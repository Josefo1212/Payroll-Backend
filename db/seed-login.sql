-- Usuario temporal para probar POST /api/login.
-- La contraseña está en texto plano solo para pruebas locales.

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
    perfil_id,
    username,
    password_hash
)
SELECT
    p.id,
    pf.id,
    'admin_prueba',
    'Password123'
FROM persona p
JOIN perfil pf ON pf.nombre_perfil = 'PRUEBA_LOGIN'
WHERE p.cedula = 'TEST-LOGIN-001'
ON CONFLICT (username) DO NOTHING;

COMMIT;

-- Datos para probar:
-- username: admin_prueba
-- password: Password123
