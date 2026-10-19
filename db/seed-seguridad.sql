-- ==========================================================
-- SEED T6: datos mínimos de seguridad para que
-- Seguridad/Usuario/registrar sea invocable por executeMethod.
-- Sin la fila de Metodo ni la de Permiso_Metodo, registrar
-- responde 403 aunque el BO exista.
--
-- Idempotente: se puede correr varias veces (ON CONFLICT).
-- Neon: crea un branch ANTES de correrla (es tu respaldo).
-- Requiere db/seed-superusuario.sql ya aplicado (perfil Superusuario).
-- ==========================================================

BEGIN;

-- Seguro: sin perfil Superusuario no tiene sentido el seed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM perfil WHERE nombre_perfil = 'Superusuario') THEN
    RAISE EXCEPTION 'Falta el perfil Superusuario. Corre antes db/seed-superusuario.sql.';
  END IF;
END $$;

-- 1. Subsistema (nombre alfanumérico, sin _: CHECK de la tabla).
INSERT INTO subsistema (nombre, descripcion)
VALUES ('Seguridad', 'Gestión de usuarios, perfiles y permisos')
ON CONFLICT (nombre) DO NOTHING;

-- 2. Clase Usuario dentro de Seguridad.
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Usuario', 'Objeto de negocio de usuarios del sistema'
FROM subsistema s
WHERE s.nombre = 'Seguridad'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

-- 3. Metodo registrar de la clase Usuario (obligatorio: sin esta fila,
--    executeMethod responde 403 aunque el método exista en el BO).
INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, 'registrar', 'Registra una persona y su usuario en una transacción'
FROM clase c
JOIN subsistema s ON s.id = c.subsistema_id
WHERE s.nombre = 'Seguridad' AND c.nombre = 'Usuario'
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- 4. Opcion registrar en Seguridad (lo que el usuario ve en el menú).
INSERT INTO opcion (subsistema_id, nombre, descripcion, orden)
SELECT s.id, 'registrar', 'Registrar un nuevo usuario', 1
FROM subsistema s
WHERE s.nombre = 'Seguridad'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

-- 5. Permiso_Metodo: Superusuario ↔ registrar.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
CROSS JOIN metodo m
JOIN clase c ON c.id = m.clase_id
JOIN subsistema s ON s.id = c.subsistema_id
WHERE pf.nombre_perfil = 'Superusuario'
  AND s.nombre = 'Seguridad'
  AND c.nombre = 'Usuario'
  AND m.nombre = 'registrar'
ON CONFLICT DO NOTHING;

-- 6. Permiso_Opcion: Superusuario ↔ registrar (menú).
INSERT INTO permiso_opcion (perfil_id, opcion_id)
SELECT pf.id, o.id
FROM perfil pf
CROSS JOIN opcion o
JOIN subsistema s ON s.id = o.subsistema_id
WHERE pf.nombre_perfil = 'Superusuario'
  AND s.nombre = 'Seguridad'
  AND o.nombre = 'registrar'
ON CONFLICT DO NOTHING;

COMMIT;
