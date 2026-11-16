-- ==========================================================
-- Migración 015 — Sesiones en PostgreSQL
--
-- express-session venía usando MemoryStore: las sesiones vivían en la
-- memoria del proceso, se perdían en cada reinicio, no se podían invalidar
-- desde otro nodo y el mapa crecía sin límite (fuga de memoria). Esta
-- migración agrega la tabla `sesion`, que usa src/database/SessionStore.js.
--
-- `sess` es el JSON que serializa express-session (userID, perfiles,
-- banderas). Nunca guarda la contraseña ni su hash: el hash vive solo en
-- usuario.password_hash. `expira_en` se renueva en cada petición (touch) y
-- el store borra las filas vencidas cada 15 minutos.
--
-- No se toca db/init.sql: el esquema base sigue en v8 y este cambio entra
-- por migración. db/schema.dbml se actualiza en el mismo cambio.
--
-- Aplica sobre una base con 001–014. Idempotente.
-- ==========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sesion (
  sid       text PRIMARY KEY,
  sess      jsonb NOT NULL,
  expira_en timestamptz NOT NULL
);

-- El barrido de vencidas y la limpieza periódica filtran por esta columna.
CREATE INDEX IF NOT EXISTS idx_sesion_expira_en ON sesion (expira_en);

COMMENT ON TABLE sesion IS
  'Sesión de express-session (cookie connect.sid). La escribe SessionStore; los BO no la consultan.';

COMMIT;
