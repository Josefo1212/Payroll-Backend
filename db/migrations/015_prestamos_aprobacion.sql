-- Migración 015: aprobación y rechazo de préstamos (Payroll/Loan).
-- Rechazar pasa el préstamo SOLICITADO a ANULADO (sin nuevo valor enum).
-- Idempotente.

BEGIN;

-- Clase Loan (ya existe por 004), asegurar y agregar métodos.
INSERT INTO clase (subsistema_id, nombre, descripcion)
SELECT s.id, 'Loan', 'Préstamos y cuotas'
FROM subsistema s
WHERE s.nombre = 'Payroll'
ON CONFLICT (subsistema_id, nombre) DO NOTHING;

INSERT INTO metodo (clase_id, nombre, descripcion)
SELECT c.id, m.nombre, m.descripcion
FROM clase c
CROSS JOIN (VALUES
  ('aprobar',  'Aprueba un préstamo solicitado'),
  ('rechazar', 'Rechaza un préstamo solicitado')
) AS m(nombre, descripcion)
WHERE c.nombre = 'Loan'
  AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
ON CONFLICT (clase_id, nombre) DO NOTHING;

-- Permisos: RRHH, GerenteRRHH, Administrador, Superusuario. Empleado no.
INSERT INTO permiso_metodo (perfil_id, metodo_id)
SELECT pf.id, m.id
FROM perfil pf
JOIN clase c
  ON c.nombre = 'Loan'
 AND c.subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Payroll')
JOIN metodo m
  ON m.clase_id = c.id
 AND m.nombre IN ('aprobar', 'rechazar')
WHERE pf.nombre_perfil IN ('RRHH', 'GerenteRRHH', 'Administrador', 'Superusuario')
ON CONFLICT DO NOTHING;

-- Defensa ante re-ejecución de 004: quitar aprobar/rechazar a Empleado si existiera.
DELETE FROM permiso_metodo pm
USING metodo m, clase c, subsistema s, perfil pf
WHERE pm.metodo_id = m.id
  AND m.clase_id = c.id
  AND c.subsistema_id = s.id
  AND pm.perfil_id = pf.id
  AND s.nombre = 'Payroll'
  AND c.nombre = 'Loan'
  AND m.nombre IN ('aprobar', 'rechazar')
  AND pf.nombre_perfil = 'Empleado';

COMMIT;
