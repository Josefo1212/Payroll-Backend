-- Método listarCargos en la clase User
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'listarCargos', 'Lista los cargos activos'
FROM clase c
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
WHERE c.nombre = 'User'
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Permiso listarCargos para Superusuario y RRHH
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre = 'User'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
JOIN metodo m ON m.clase_id = c.id AND m.nombre = 'listarCargos'
WHERE pf.nombre_perfil IN ('Superusuario', 'RRHH')
ON CONFLICT DO NOTHING;

-- Asegurar registrar solo para Superusuario y RRHH
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c ON c.nombre = 'User'
JOIN subsistema s ON s.id = c.subsistema_id AND s.nombre = 'Security'
JOIN metodo m ON m.clase_id = c.id AND m.nombre = 'registrar'
WHERE pf.nombre_perfil IN ('Superusuario', 'RRHH')
ON CONFLICT DO NOTHING;

-- Sembrar cargos
INSERT INTO cargo (nombre, descripcion) VALUES
  ('Gerente de RRHH', 'Cargo de RRHH'),
  ('Contador', 'Cargo de Contador'),
  ('Analista de Nómina', 'Cargo de Analista de Nómina'),
  ('Asistente Administrativo', 'Cargo de Asistente Administrativo')
ON CONFLICT (nombre) DO NOTHING;
