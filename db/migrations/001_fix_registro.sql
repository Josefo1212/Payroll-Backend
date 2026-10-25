-- Dar permiso a Security/User/registrar a Superusuario, Administrador y RRHH
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre = 'User'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
JOIN metodo m ON m.clase_id = c.id AND m.nombre = 'registrar'
WHERE pf.nombre_perfil IN ('Superusuario', 'Administrador', 'RRHH')
ON CONFLICT DO NOTHING;

-- Actualizar nombre de perfil si aún existe
UPDATE perfil SET nombre_perfil = 'RRHH' WHERE nombre_perfil = 'GerenteRRHH';
