-- 003: instantes de seguridad con zona horaria.
--
-- Bloqueado_hasta y Ultimo_acceso se guardaban como TIMESTAMP (sin zona).
-- Neon corre la sesión en GMT y Node en America/Caracas (UTC-4): al leerlas,
-- node-pg interpretaba la hora UTC como hora local y el vencimiento del
-- bloqueo quedaba corrido ~4 h. Los instantes van en TIMESTAMPTZ.
--
-- Los valores existentes se escribieron con NOW() (un instante) en sesión
-- GMT, así que quedaron como hora UTC sin zona: se reinterpretan como UTC
-- para conservar el momento real.

BEGIN;

ALTER TABLE Usuario
  ALTER COLUMN Bloqueado_hasta TYPE TIMESTAMPTZ
  USING Bloqueado_hasta AT TIME ZONE 'UTC';

ALTER TABLE Usuario
  ALTER COLUMN Ultimo_acceso TYPE TIMESTAMPTZ
  USING Ultimo_acceso AT TIME ZONE 'UTC';

COMMIT;
