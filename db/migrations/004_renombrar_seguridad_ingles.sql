-- 004: renombra en inglés el subsistema y las clases del módulo de seguridad
-- del profesor, para que la llave de reflexión del código
-- (src/bo/<Subsistema>/<Clase>.js) coincida con la fila de la base.
--
-- Renombra EN SU LUGAR (conserva los ids), así Permiso_Metodo, Permiso_Opcion,
-- Metodo y Opcion siguen apuntando a las mismas filas. Sembrar un subsistema
-- nuevo con el nombre en inglés dejaría las filas viejas huérfanas.
--
-- Es idempotente: si el nombre viejo ya no existe, no hace nada.
--
--   Seguridad → Security
--   Sesion    → Session
--   Usuario   → User
--   (Menu y Admin ya están en inglés)

BEGIN;

-- Subsistema: renombra la fila y su descripción.
UPDATE subsistema
SET nombre = 'Security'
WHERE nombre = 'Seguridad';

-- Clases del subsistema Security. El WHERE con el nombre viejo y el
-- subsistema_id evita pisar una clase homónima de otro subsistema.
UPDATE clase
SET nombre = 'Session'
WHERE nombre = 'Sesion'
  AND subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security');

UPDATE clase
SET nombre = 'User'
WHERE nombre = 'Usuario'
  AND subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security');

COMMIT;
