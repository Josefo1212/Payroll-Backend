-- ==========================================================
-- Migración 005 — Security/User/listarPersonas
-- RRHH necesita el id de la persona para cargar horas, conceptos,
-- afiliaciones y préstamos. Aplica sobre una base con 001–004.
-- Idempotente.
-- ==========================================================

BEGIN;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'listarPersonas', 'Lista personas activas con su contrato vigente'
FROM clase c
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE c.nombre = 'User'
ON CONFLICT (clase_id, nombre) DO NOTHING;

INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN metodo m ON m.nombre = 'listarPersonas'
JOIN clase c ON c.id = m.clase_id AND c.nombre = 'User'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario')
ON CONFLICT DO NOTHING;

COMMIT;
