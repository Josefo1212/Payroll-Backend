-- ==========================================================
-- DATOS DE PRUEBA — personas, contratos, nómina y períodos
-- ==========================================================
-- SOLO PARA DESARROLLO. Siembra un equipo realista para probar el front:
--
--   - Personas: 10 activas con contrato, 1 inactiva sin contrato, 1 con
--     contrato FINALIZADO, María Ramírez (contrato de prueba por hora) y
--     admin_prueba (alta quincenal para probar sus propios recibos).
--   - Contratos con mezcla de SALARIO_FIJO / POR_HORA y de frecuencias
--     SEMANAL, QUINCENAL y MENSUAL.
--   - Bancos y cuenta principal (la usa `Period.pagar`).
--   - Afiliaciones de ley (SSO, paro forzoso, vivienda e INCES).
--   - Conceptos recurrentes, horas normales y extras (hasta dic-2026).
--   - Novedades APROBADA, PENDIENTE y RECHAZADA.
--   - Préstamos con cuotas y un préstamo SOLICITADO sin cuotas.
--   - 20 períodos (10 semanales, 6 quincenales y 4 mensuales): los nuevos
--     nacen en BORRADOR; los ya procesados se dejan intactos.
--   - 5 usuarios de prueba con clave 'Password123' (ver abajo).
--
-- Es IDEMPOTENTE: usa UUID fijos y ON CONFLICT, así que se puede correr
-- varias veces sin duplicar ni romper nada.
--
-- Orden obligatorio:
--   db/init.sql → db/migrations/*.sql → db/seed-seguridad.sql
--   → db/seed-usuario-prueba.sql → ESTE archivo
--
--   psql "$DATABASE_URL" -f db/seed-datos-prueba.sql
--   (o node .tmp-pg.mjs db/seed-datos-prueba.sql)
--
-- Usuarios de prueba (todos con clave 'Password123'):
--   admin_prueba      → ya existe: perfiles de seguridad y, además, contrato
--                       quincenal de empleado (Mis recibos).
--   luis_gomez        → Empleado (semanal, SALARIO_FIJO, con préstamo)
--   pedro_hernandez   → Empleado (semanal, POR_HORA, con horas extra)
--   rosa_vargas       → Empleado + RRHH (semanal, SALARIO_FIJO)
--   carmen_diaz       → Empleado (quincenal, SALARIO_FIJO, con préstamo)
-- ==========================================================

BEGIN;

-- `registrado_por` es NOT NULL y apunta a `usuario`: sin usuarios el seed no
-- puede sembrar horas ni novedades. Falla explícito en vez de dejar NULLs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuario) THEN
    RAISE EXCEPTION
      'No hay usuarios en la base: corre antes db/seed-usuario-prueba.sql';
  END IF;
END $$;

-- ----------------------------------------------------------
-- 1. Bancos
-- ----------------------------------------------------------
INSERT INTO banco (codigo, nombre) VALUES
  ('0102', 'Banco de Venezuela'),
  ('0105', 'Mercantil'),
  ('0108', 'BBVA Provincial'),
  ('0134', 'Banesco')
ON CONFLICT (codigo) DO NOTHING;

-- ----------------------------------------------------------
-- 2. Personas (UUID fijos para poder referenciarlas)
-- ----------------------------------------------------------
INSERT INTO persona
  (id, cedula, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
   fecha_nacimiento, sexo, estado_civil, nro_tlf, email, direccion, estado)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'V-14567890', 'Luis', 'Fernando', 'Gómez', 'Rivas',
   '1988-03-12', 'M', 'CASADO', '0414-1234567', 'luis.gomez@nomina.test', 'Av. Libertador, Caracas', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000002', 'V-16234567', 'Pedro', 'José', 'Hernández', 'Mora',
   '1992-07-25', 'M', 'SOLTERO', '0424-2345678', 'pedro.hernandez@nomina.test', 'Calle 5, Maracaibo', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000003', 'V-17987654', 'Rosa', 'Elena', 'Vargas', 'Ríos',
   '1985-11-02', 'F', 'DIVORCIADO', '0412-3456789', 'rosa.vargas@nomina.test', 'Urb. La California, Caracas', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000004', 'V-13456789', 'Carmen', 'Rosa', 'Díaz', 'Pérez',
   '1979-01-19', 'F', 'CASADO', '0416-4567890', 'carmen.diaz@nomina.test', 'Av. Bolívar, Valencia', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000005', 'V-19012345', 'Andrés', 'Felipe', 'Suárez', 'Molina',
   '1995-05-30', 'M', 'SOLTERO', '0426-5678901', 'andres.suarez@nomina.test', 'Calle 8, Barquisimeto', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000006', 'V-20876543', 'Miguel', 'Ángel', 'Rojas', 'Peña',
   '1990-09-14', 'M', 'CONCUBINO', '0414-6789012', 'miguel.rojas@nomina.test', 'Urb. El Paraíso, Caracas', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000007', 'V-15678901', 'Ana', 'María', 'Torres', 'Salas',
   '1987-12-08', 'F', 'CASADO', '0424-7890123', 'ana.torres@nomina.test', 'Av. Universidad, Caracas', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000008', 'V-22345678', 'Daniel', 'Eduardo', 'Castro', 'Lugo',
   '1993-04-21', 'M', 'SOLTERO', '0412-8901234', 'daniel.castro@nomina.test', 'Calle 12, Maracay', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000009', 'V-18456789', 'Yulimar', 'Andreína', 'Blanco', 'Paz',
   '1991-08-16', 'F', 'SOLTERO', '0416-9012345', 'yulimar.blanco@nomina.test', 'Urb. Cumbres, Maturín', 'ACTIVO'),
  ('d0000000-0000-4000-8000-000000000010', 'V-12345678', 'Rafael', 'Ignacio', 'Méndez', 'Ortega',
   '1975-02-27', 'M', 'CASADO', '0426-0123456', 'rafael.mendez@nomina.test', 'Av. Principal, Caracas', 'ACTIVO'),
  -- Persona INACTIVA sin contrato: sirve para probar los filtros de listado.
  ('d0000000-0000-4000-8000-000000000011', 'V-20111222', 'Yohana', NULL, 'Pérez', 'Arias',
   '1996-06-10', 'F', 'SOLTERO', '0414-1112233', 'yohana.perez@nomina.test', 'Calle 3, Mérida', 'INACTIVO'),
  -- Persona con contrato FINALIZADO: sirve para probar el historial.
  ('d0000000-0000-4000-8000-000000000012', 'V-11223344', 'José', 'Gregorio', 'Contreras', 'Luna',
   '1982-02-14', 'M', 'CASADO', '0424-4455667', 'jose.contreras@nomina.test', 'Av. Andrés Bello, Caracas', 'ACTIVO')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------
-- 3. Contratos (uno VIGENTE por persona; el EXCLUDE impide solapes)
--    POR_HORA: el monto de contrato_salario es la TARIFA POR HORA.
--    SALARIO_FIJO: el monto es el SUELDO MENSUAL.
-- ----------------------------------------------------------
INSERT INTO contrato
  (id, persona_id, cargo_id, fecha_inicio, fecha_fin, tipo_pago, frecuencia_pago, horas_semanales, estado)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 4, '2025-01-15', NULL, 'SALARIO_FIJO', 'SEMANAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 3, '2025-01-15', NULL, 'POR_HORA',     'SEMANAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 2, '2025-01-15', NULL, 'SALARIO_FIJO', 'SEMANAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 2, '2025-01-15', NULL, 'SALARIO_FIJO', 'QUINCENAL', 40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 3, '2025-01-15', NULL, 'SALARIO_FIJO', 'QUINCENAL', 40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000006', 4, '2025-01-15', NULL, 'POR_HORA',     'QUINCENAL', 40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000007', 3, '2025-01-15', NULL, 'SALARIO_FIJO', 'MENSUAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000008', 4, '2025-01-15', NULL, 'POR_HORA',     'MENSUAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000009', 2, '2025-01-15', NULL, 'SALARIO_FIJO', 'MENSUAL',   40, 'VIGENTE'),
  ('c0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000010', 1, '2025-01-15', NULL, 'SALARIO_FIJO', 'MENSUAL',   40, 'VIGENTE'),
  -- Contrato terminado: no entra en ninguna nómina nueva.
  ('c0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000012', 4, '2025-01-15', '2026-06-30', 'SALARIO_FIJO', 'SEMANAL', 40, 'FINALIZADO')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------
-- 4. Salario vigente de cada contrato
-- ----------------------------------------------------------
INSERT INTO contrato_salario (contrato_id, monto, vigente_desde, vigente_hasta, motivo)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 12000.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000002',    90.00, '2025-01-15', NULL, 'Tarifa por hora de prueba'),
  ('c0000000-0000-4000-8000-000000000003',  9500.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000004', 24000.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000005', 18000.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000006',   110.00, '2025-01-15', NULL, 'Tarifa por hora de prueba'),
  ('c0000000-0000-4000-8000-000000000007', 20000.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000008',    75.00, '2025-01-15', NULL, 'Tarifa por hora de prueba'),
  ('c0000000-0000-4000-8000-000000000009', 15500.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000010', 32000.00, '2025-01-15', NULL, 'Sueldo mensual de prueba'),
  ('c0000000-0000-4000-8000-000000000012',  8500.00, '2025-01-15', '2026-06-30', 'Sueldo del contrato finalizado')
ON CONFLICT (contrato_id, vigente_desde) DO NOTHING;

-- Coherencia del contrato de prueba que ya existía (Maria Ramirez, por hora).
-- 55240 por hora no es una tarifa realista; se deja en 95.00.
UPDATE contrato_salario cs
   SET monto = 95.00,
       motivo = 'Tarifa por hora (datos de prueba)'
  FROM contrato c
 WHERE c.id = cs.contrato_id
   AND c.persona_id = 'fca4d545-fe05-4621-9752-20d353ec67b8'
   AND cs.vigente_hasta IS NULL;

-- admin_prueba ya tenía el perfil Empleado pero no contrato: sin él no entra
-- en findContratosVigentesPorFrecuencia y Mis recibos queda vacío. El
-- persona_id se deriva del usuario porque seed-usuario-prueba.sql lo crea con
-- UUID aleatorio; el id del contrato sí es fijo para repetir el seed.
INSERT INTO contrato
  (id, persona_id, cargo_id, fecha_inicio, fecha_fin, tipo_pago,
   frecuencia_pago, horas_semanales, estado)
SELECT 'c0000000-0000-4000-8000-000000000013'::uuid, p.id, 2,
       DATE '2025-01-15', NULL, 'SALARIO_FIJO', 'QUINCENAL', 40, 'VIGENTE'
  FROM persona p
  JOIN usuario u ON u.persona_id = p.id
 WHERE u.username = 'admin_prueba'
   AND NOT EXISTS (
     SELECT 1 FROM contrato c
      WHERE c.persona_id = p.id AND c.estado = 'VIGENTE'
   )
ON CONFLICT (id) DO NOTHING;

INSERT INTO contrato_salario (contrato_id, monto, vigente_desde, vigente_hasta, motivo)
SELECT c.id, 15000.00, DATE '2025-01-15', NULL,
       'Sueldo mensual de prueba (admin_prueba)'
  FROM contrato c
  JOIN persona p ON p.id = c.persona_id
  JOIN usuario u ON u.persona_id = p.id
 WHERE u.username = 'admin_prueba'
   AND c.estado = 'VIGENTE'
   AND c.frecuencia_pago = 'QUINCENAL'
ON CONFLICT (contrato_id, vigente_desde) DO NOTHING;

-- ----------------------------------------------------------
-- 5. Cuenta bancaria principal de cada persona
-- ----------------------------------------------------------
INSERT INTO cuenta_bancaria (persona_id, banco_id, tipo_cuenta, nro_cuenta, es_principal, activa)
SELECT v.persona_id, b.id, v.tipo::tipo_cuenta, v.nro_cuenta, true, true
FROM (VALUES
  ('d0000000-0000-4000-8000-000000000001'::uuid, '0102', 'AHORRO',    '0102-0001-0001-0001'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, '0105', 'CORRIENTE', '0105-0002-0002-0002'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, '0108', 'AHORRO',    '0108-0003-0003-0003'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, '0134', 'AHORRO',    '0134-0004-0004-0004'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, '0102', 'CORRIENTE', '0102-0005-0005-0005'),
  ('d0000000-0000-4000-8000-000000000006'::uuid, '0105', 'AHORRO',    '0105-0006-0006-0006'),
  ('d0000000-0000-4000-8000-000000000007'::uuid, '0108', 'AHORRO',    '0108-0007-0007-0007'),
  ('d0000000-0000-4000-8000-000000000008'::uuid, '0134', 'CORRIENTE', '0134-0008-0008-0008'),
  ('d0000000-0000-4000-8000-000000000009'::uuid, '0102', 'AHORRO',    '0102-0009-0009-0009'),
  ('d0000000-0000-4000-8000-000000000010'::uuid, '0105', 'AHORRO',    '0105-0010-0010-0010'),
  ('d0000000-0000-4000-8000-000000000012'::uuid, '0134', 'AHORRO',    '0134-0012-0012-0012'),
  ('fca4d545-fe05-4621-9752-20d353ec67b8'::uuid, '0108', 'AHORRO',    '0108-0011-0011-0011')
) AS v(persona_id, codigo_banco, tipo, nro_cuenta)
JOIN banco b ON b.codigo = v.codigo_banco
ON CONFLICT (banco_id, nro_cuenta) DO NOTHING;

-- La cuenta principal tiene un índice único parcial, así que además del
-- conflicto por nro_cuenta se comprueba que admin_prueba no tenga ya una.
INSERT INTO cuenta_bancaria
  (persona_id, banco_id, tipo_cuenta, nro_cuenta, es_principal, activa)
SELECT p.id, b.id, 'AHORRO', '0102-0013-0013-0013', true, true
  FROM persona p
  JOIN usuario u ON u.persona_id = p.id
  JOIN banco b ON b.codigo = '0102'
 WHERE u.username = 'admin_prueba'
   AND NOT EXISTS (
     SELECT 1 FROM cuenta_bancaria cb
      WHERE cb.persona_id = p.id AND cb.es_principal AND cb.activa
   )
ON CONFLICT (banco_id, nro_cuenta) DO NOTHING;

-- ----------------------------------------------------------
-- 6. Afiliaciones de ley de cada persona con contrato vigente
--    (INCES solo tiene tasa patronal)
-- ----------------------------------------------------------
INSERT INTO afiliacion_ley (persona_id, tipo_aporte_id, nro_afiliacion, fecha_inscripcion, estado)
SELECT p.id,
       t.id,
       p.cedula || '-' || t.codigo,
       '2025-02-01',
       'ACTIVO'
FROM persona p
JOIN tipo_aporte_ley t ON t.codigo IN ('SSO', 'PARO_FORZOSO', 'VIVIENDA', 'INCES')
WHERE p.id IN (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000003',
  'd0000000-0000-4000-8000-000000000004',
  'd0000000-0000-4000-8000-000000000005',
  'd0000000-0000-4000-8000-000000000006',
  'd0000000-0000-4000-8000-000000000007',
  'd0000000-0000-4000-8000-000000000008',
  'd0000000-0000-4000-8000-000000000009',
  'd0000000-0000-4000-8000-000000000010',
  'fca4d545-fe05-4621-9752-20d353ec67b8'
)
ON CONFLICT (persona_id, tipo_aporte_id) DO NOTHING;

-- El mismo conjunto de aportes de ley para el nuevo empleado de prueba.
INSERT INTO afiliacion_ley
  (persona_id, tipo_aporte_id, nro_afiliacion, fecha_inscripcion, estado)
SELECT p.id, t.id, p.cedula || '-' || t.codigo, DATE '2025-02-01', 'ACTIVO'
  FROM persona p
  JOIN usuario u ON u.persona_id = p.id
  JOIN tipo_aporte_ley t ON t.codigo IN ('SSO', 'PARO_FORZOSO', 'VIVIENDA', 'INCES')
 WHERE u.username = 'admin_prueba'
ON CONFLICT (persona_id, tipo_aporte_id) DO NOTHING;

-- ----------------------------------------------------------
-- 7. Conceptos recurrentes (bonos y descuentos fijos por período)
--    Los montos son POR PERÍODO, no mensuales: un semanal cobra cada semana.
-- ----------------------------------------------------------
INSERT INTO concepto_persona
  (persona_id, concepto_id, tipo_valor, valor, vigente_desde, vigente_hasta, observacion)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 15, 'MONTO_FIJO',        250.0000, '2026-01-01', NULL, 'Bono de alimentación (semanal)'),
  ('d0000000-0000-4000-8000-000000000002', 19, 'MONTO_FIJO',         60.0000, '2026-01-01', NULL, 'Descuento por comedor (semanal)'),
  ('d0000000-0000-4000-8000-000000000003', 15, 'MONTO_FIJO',        150.0000, '2026-01-01', NULL, 'Bono de transporte (semanal)'),
  ('d0000000-0000-4000-8000-000000000004', 19, 'MONTO_FIJO',        150.0000, '2026-01-01', NULL, 'Descuento por estacionamiento'),
  ('d0000000-0000-4000-8000-000000000005', 15, 'MONTO_FIJO',        400.0000, '2026-01-01', NULL, 'Bono de alimentación (quincenal)'),
  ('d0000000-0000-4000-8000-000000000006', 19, 'MONTO_FIJO',         80.0000, '2026-01-01', NULL, 'Descuento por comedor (quincenal)'),
  ('d0000000-0000-4000-8000-000000000007', 15, 'PORCENTAJE_SALARIO',  0.0500, '2026-01-01', NULL, 'Bono de productividad (5 %)'),
  ('d0000000-0000-4000-8000-000000000008', 15, 'PORCENTAJE_SALARIO',  0.1000, '2026-01-01', NULL, 'Bono de disponibilidad (10 %)'),
  ('d0000000-0000-4000-8000-000000000009', 15, 'MONTO_FIJO',        300.0000, '2026-01-01', NULL, 'Bono de alimentación (mensual)'),
  ('d0000000-0000-4000-8000-000000000010', 19, 'MONTO_FIJO',        300.0000, '2026-01-01', NULL, 'Descuento por seguro médico')
ON CONFLICT (persona_id, concepto_id, vigente_desde) DO NOTHING;

-- Bono quincenal de admin_prueba: además del sueldo y de la ley, su recibo
-- lleva una línea recurrente como el del resto del personal.
INSERT INTO concepto_persona
  (persona_id, concepto_id, tipo_valor, valor, vigente_desde, vigente_hasta, observacion)
SELECT p.id, 15, 'MONTO_FIJO', 200.0000, DATE '2026-01-01', NULL,
       'Bono de alimentación (quincenal, admin_prueba)'
  FROM persona p
  JOIN usuario u ON u.persona_id = p.id
 WHERE u.username = 'admin_prueba'
ON CONFLICT (persona_id, concepto_id, vigente_desde) DO NOTHING;

-- ----------------------------------------------------------
-- 8. Horas normales de las personas POR_HORA (8 h por día hábil)
--    Solo ellos necesitan horas: el SALARIO_FIJO se prorratea por frecuencia.
-- ----------------------------------------------------------
-- Semanal: Pedro (p02), oct-dic 2026
INSERT INTO registro_horas (persona_id, fecha, horas_normales, horas_extra, registrado_por)
SELECT 'd0000000-0000-4000-8000-000000000002',
       d::date,
       8,
       0,
       (SELECT id FROM usuario WHERE username = 'admin_prueba')
FROM generate_series('2026-10-05'::date, '2026-12-13'::date, interval '1 day') d
WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
ON CONFLICT (persona_id, fecha) DO NOTHING;

-- Quincenal: Miguel (p06) y Maria (contrato de prueba), sep-dic 2026
INSERT INTO registro_horas (persona_id, fecha, horas_normales, horas_extra, registrado_por)
SELECT v.persona_id,
       d::date,
       8,
       0,
       (SELECT id FROM usuario WHERE username = 'admin_prueba')
FROM (VALUES
  ('d0000000-0000-4000-8000-000000000006'::uuid),
  ('fca4d545-fe05-4621-9752-20d353ec67b8'::uuid)
) AS v(persona_id)
CROSS JOIN generate_series('2026-09-16'::date, '2026-12-15'::date, interval '1 day') d
WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
ON CONFLICT (persona_id, fecha) DO NOTHING;

-- Mensual: Daniel (p08), sep-dic 2026
INSERT INTO registro_horas (persona_id, fecha, horas_normales, horas_extra, registrado_por)
SELECT 'd0000000-0000-4000-8000-000000000008',
       d::date,
       8,
       0,
       (SELECT id FROM usuario WHERE username = 'admin_prueba')
FROM generate_series('2026-09-01'::date, '2026-12-31'::date, interval '1 day') d
WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
ON CONFLICT (persona_id, fecha) DO NOTHING;

-- Horas extra puntuales. Upsert que SOLO toca `horas_extra`: si la fila del
-- día ya existe con horas normales, se conservan.
INSERT INTO registro_horas (persona_id, fecha, horas_normales, horas_extra, registrado_por)
VALUES
  ('d0000000-0000-4000-8000-000000000002', '2026-10-07', 8, 2, (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('d0000000-0000-4000-8000-000000000002', '2026-10-21', 8, 3, (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('d0000000-0000-4000-8000-000000000006', '2026-10-20', 8, 4, (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('d0000000-0000-4000-8000-000000000008', '2026-10-15', 8, 6, (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('fca4d545-fe05-4621-9752-20d353ec67b8', '2026-10-22', 8, 2, (SELECT id FROM usuario WHERE username = 'admin_prueba'))
ON CONFLICT (persona_id, fecha)
DO UPDATE SET horas_extra = EXCLUDED.horas_extra;

-- ----------------------------------------------------------
-- 9. Períodos de nómina (BORRADOR), con UUID fijo
-- ----------------------------------------------------------
INSERT INTO periodo_nomina (id, fecha_inicio, fecha_fin, frecuencia, estado, descripcion)
VALUES
  -- Semanales (lunes a domingo)
  ('b0000000-0000-4000-8000-000000000001', '2026-10-05', '2026-10-11', 'SEMANAL', 'BORRADOR', 'Semana 1 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000002', '2026-10-12', '2026-10-18', 'SEMANAL', 'BORRADOR', 'Semana 2 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000003', '2026-10-19', '2026-10-25', 'SEMANAL', 'BORRADOR', 'Semana 3 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000004', '2026-10-26', '2026-11-01', 'SEMANAL', 'BORRADOR', 'Semana 4 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000005', '2026-11-02', '2026-11-08', 'SEMANAL', 'BORRADOR', 'Semana 1 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000006', '2026-11-09', '2026-11-15', 'SEMANAL', 'BORRADOR', 'Semana 2 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000007', '2026-11-16', '2026-11-22', 'SEMANAL', 'BORRADOR', 'Semana 3 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000008', '2026-11-23', '2026-11-29', 'SEMANAL', 'BORRADOR', 'Semana 4 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000009', '2026-11-30', '2026-12-06', 'SEMANAL', 'BORRADOR', 'Semana 1 de diciembre 2026'),
  ('b0000000-0000-4000-8000-000000000010', '2026-12-07', '2026-12-13', 'SEMANAL', 'BORRADOR', 'Semana 2 de diciembre 2026'),
  -- Quincenales
  ('b0000000-0000-4000-8000-000000000011', '2026-09-16', '2026-09-30', 'QUINCENAL', 'BORRADOR', 'Quincena 2 de septiembre 2026'),
  ('b0000000-0000-4000-8000-000000000012', '2026-10-01', '2026-10-15', 'QUINCENAL', 'BORRADOR', 'Quincena 1 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000013', '2026-10-16', '2026-10-31', 'QUINCENAL', 'BORRADOR', 'Quincena 2 de octubre 2026'),
  ('b0000000-0000-4000-8000-000000000014', '2026-11-01', '2026-11-15', 'QUINCENAL', 'BORRADOR', 'Quincena 1 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000015', '2026-11-16', '2026-11-30', 'QUINCENAL', 'BORRADOR', 'Quincena 2 de noviembre 2026'),
  ('b0000000-0000-4000-8000-000000000016', '2026-12-01', '2026-12-15', 'QUINCENAL', 'BORRADOR', 'Quincena 1 de diciembre 2026'),
  -- Mensuales (noviembre ya existía sin descripción)
  ('b0000000-0000-4000-8000-000000000021', '2026-09-01', '2026-09-30', 'MENSUAL', 'BORRADOR', 'Septiembre 2026'),
  ('b0000000-0000-4000-8000-000000000022', '2026-10-01', '2026-10-31', 'MENSUAL', 'BORRADOR', 'Octubre 2026'),
  ('b0000000-0000-4000-8000-000000000023', '2026-12-01', '2026-12-31', 'MENSUAL', 'BORRADOR', 'Diciembre 2026')
ON CONFLICT (id) DO NOTHING;

UPDATE periodo_nomina
   SET descripcion = 'Noviembre 2026'
 WHERE frecuencia = 'MENSUAL'
   AND fecha_inicio = '2026-11-01'
   AND descripcion IS NULL;

-- ----------------------------------------------------------
-- 10. Novedades
--     APROBADA entra al generar; PENDIENTE se aprueba desde la pantalla;
--     RECHAZADA existe para probar el filtro.
-- ----------------------------------------------------------
INSERT INTO novedad
  (id, persona_id, concepto_id, periodo_nomina_id, fecha, cantidad, monto, estado,
   observacion, registrado_por, aprobado_por)
VALUES
  -- Octubre mensual (aprobadas)
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000007', 15,
   'b0000000-0000-4000-8000-000000000022', '2026-10-20', NULL, 800.00, 'APROBADA',
   'Bono por cierre de proyecto', (SELECT id FROM usuario WHERE username = 'admin_prueba'),
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000008', 15,
   'b0000000-0000-4000-8000-000000000022', '2026-10-15', NULL, 600.00, 'APROBADA',
   'Bono puntual por inventario', (SELECT id FROM usuario WHERE username = 'admin_prueba'),
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000010', 19,
   'b0000000-0000-4000-8000-000000000022', '2026-10-28', NULL, 250.00, 'APROBADA',
   'Descuento puntual por adelanto', (SELECT id FROM usuario WHERE username = 'admin_prueba'),
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  -- Quincena 1 de noviembre (aprobada): se puede generar la pre-nómina ya
  ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000006', 15,
   'b0000000-0000-4000-8000-000000000014', '2026-11-05', NULL, 450.00, 'APROBADA',
   'Bono por turno nocturno', (SELECT id FROM usuario WHERE username = 'admin_prueba'),
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  -- Noviembre mensual (pendientes de aprobar)
  ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000009', 15,
   (SELECT id FROM periodo_nomina WHERE frecuencia = 'MENSUAL' AND fecha_inicio = '2026-11-01'),
   '2026-11-10', NULL, 400.00, 'PENDIENTE',
   'Bono por desempeño', (SELECT id FROM usuario WHERE username = 'admin_prueba'), NULL),
  ('e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000007', 15,
   (SELECT id FROM periodo_nomina WHERE frecuencia = 'MENSUAL' AND fecha_inicio = '2026-11-01'),
   '2026-11-12', NULL, 350.00, 'PENDIENTE',
   'Bono por asistencia perfecta', (SELECT id FROM usuario WHERE username = 'admin_prueba'), NULL),
  -- Semana 2 de noviembre (pendiente) y semana 1 (rechazada)
  ('e0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001', 15,
   'b0000000-0000-4000-8000-000000000006', '2026-11-10', NULL, 200.00, 'PENDIENTE',
   'Bono por guardia del sábado', (SELECT id FROM usuario WHERE username = 'admin_prueba'), NULL),
  ('e0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000002', 15,
   'b0000000-0000-4000-8000-000000000005', '2026-11-04', NULL, 150.00, 'RECHAZADA',
   'Bono sin autorización previa', (SELECT id FROM usuario WHERE username = 'admin_prueba'), NULL),
  -- Quincena 2 de noviembre (aprobada): el recibo nuevo de admin_prueba lleva
  -- también una línea de novedad.
  ('e0000000-0000-4000-8000-000000000009',
   (SELECT p.id FROM persona p JOIN usuario u ON u.persona_id = p.id WHERE u.username = 'admin_prueba'),
   15, 'b0000000-0000-4000-8000-000000000015', '2026-11-20', NULL, 150.00, 'APROBADA',
   'Bono puntual de prueba para admin_prueba',
   (SELECT id FROM usuario WHERE username = 'admin_prueba'),
   (SELECT id FROM usuario WHERE username = 'admin_prueba'))
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------
-- 11. Préstamos y cuotas
-- ----------------------------------------------------------
INSERT INTO prestamo
  (id, persona_id, fecha_otorgamiento, monto_total, nro_cuotas, cuota_periodica,
   tasa_interes, estado, aprobado_por)
VALUES
  -- Carmen (quincenal): 6.000 al 10 %, 6 cuotas de 1.100,00
  ('f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004',
   '2026-09-15', 6000.00, 6, 1100.00, 0.1000, 'ACTIVO',
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  -- Daniel (mensual): 3.000 al 5 %, 3 cuotas de 1.050,00
  ('f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000008',
   '2026-09-01', 3000.00, 3, 1050.00, 0.0500, 'ACTIVO',
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  -- Luis (semanal): 1.200 sin interés, 4 cuotas de 300,00
  ('f0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
   '2026-09-28', 1200.00, 4, 300.00, 0.0000, 'ACTIVO',
   (SELECT id FROM usuario WHERE username = 'admin_prueba')),
  -- Yulimar: solicitud sin aprobar y sin cuotas (para probar la aprobación)
  ('f0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000009',
   '2026-11-10', 2000.00, 4, 500.00, 0.0000, 'SOLICITADO', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cuota_prestamo
  (prestamo_id, nro_cuota, fecha_vencimiento, monto_capital, monto_interes, monto_cuota, estado)
VALUES
  -- Carmen
  ('f0000000-0000-4000-8000-000000000001', 1, '2026-09-30', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000001', 2, '2026-10-15', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000001', 3, '2026-10-31', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000001', 4, '2026-11-15', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000001', 5, '2026-11-30', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000001', 6, '2026-12-15', 1000.00, 100.00, 1100.00, 'PENDIENTE'),
  -- Daniel
  ('f0000000-0000-4000-8000-000000000002', 1, '2026-09-30', 1000.00,  50.00, 1050.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000002', 2, '2026-10-31', 1000.00,  50.00, 1050.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000002', 3, '2026-11-30', 1000.00,  50.00, 1050.00, 'PENDIENTE'),
  -- Luis
  ('f0000000-0000-4000-8000-000000000003', 1, '2026-10-11',  300.00,   0.00,  300.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000003', 2, '2026-10-18',  300.00,   0.00,  300.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000003', 3, '2026-10-25',  300.00,   0.00,  300.00, 'PENDIENTE'),
  ('f0000000-0000-4000-8000-000000000003', 4, '2026-11-01',  300.00,   0.00,  300.00, 'PENDIENTE')
ON CONFLICT (prestamo_id, nro_cuota) DO NOTHING;

-- ----------------------------------------------------------
-- 12. Usuarios de prueba (clave 'Password123', hash bcrypt cost 12)
--     Mismo hash que db/seed-usuario-prueba.sql.
-- ----------------------------------------------------------
INSERT INTO usuario (persona_id, username, password_hash, debe_cambiar_clave)
SELECT v.persona_id, v.username,
       '$2b$12$JGKlv0la5OFqyhJKfLFRWe3KseJEqNEbrEQJPPcfY1F/sqEgpRRg2', false
FROM (VALUES
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'luis_gomez'),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'pedro_hernandez'),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'rosa_vargas'),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'carmen_diaz')
) AS v(persona_id, username)
ON CONFLICT (username) DO NOTHING;

-- Perfiles: los tres primeros son Empleado (ven sus recibos); Rosa además es
-- RRHH para probar las pantallas de gestión sin el perfil Superusuario.
INSERT INTO usuario_perfil (usuario_id, perfil_id)
SELECT u.id, pf.id
FROM usuario u
JOIN perfil pf ON pf.nombre_perfil = 'Empleado'
WHERE u.username IN ('luis_gomez', 'pedro_hernandez', 'rosa_vargas', 'carmen_diaz')
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

INSERT INTO usuario_perfil (usuario_id, perfil_id)
SELECT u.id, pf.id
FROM usuario u
JOIN perfil pf ON pf.nombre_perfil = 'RRHH'
WHERE u.username = 'rosa_vargas'
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

COMMIT;
