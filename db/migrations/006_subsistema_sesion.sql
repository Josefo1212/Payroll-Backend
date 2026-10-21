-- 006: separa la sesión de la seguridad.
--
-- Antes: un solo subsistema 'Security' con las clases Session, Menu, Admin y
-- User. Ahora 'Session' es su propio subsistema y 'Security' conserva solo lo
-- que es de seguridad (Menu, Admin, User).
--
-- Corresponde al código: src/bo/Session/Session.js (antes
-- src/bo/Security/Session.js). La llave del mapa de reflexión es
-- <Subsistema>_<Clase>_<metodo>_<perfilId>, así que mover el subsistema
-- en la BD y el archivo de carpeta a la vez mantiene la coincidencia.
--
-- Mueve la clase EXISTENTE en su lugar (conserva el id), para que
-- Permiso_Metodo siga apuntando a los mismos métodos. Sembrar un subsistema
-- nuevo con la clase repetida dejaría las filas viejas huérfanas.
--
-- Idempotente: si el subsistema 'Session' ya existe, no hace nada.

BEGIN;

-- 1. Subsistema nuevo. Nombre alfanumérico y sin '_' como exige el CHECK.
INSERT INTO subsistema (nombre, descripcion)
VALUES ('Session', 'Autenticación y sesiones')
ON CONFLICT (nombre) DO NOTHING;

-- 2. Mueve la clase Session al subsistema Session, conservando el id (y por
--    tanto sus filas de Permiso_Metodo). El UPDATE con el nombre viejo del
--    subsistema evita tocar una clase homónima de otro subsistema.
UPDATE clase
SET subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Session')
WHERE nombre = 'Session'
  AND subsistema_id = (SELECT id FROM subsistema WHERE nombre = 'Security');

-- 3. La descripción del subsistema Security ya no cubre la sesión.
UPDATE subsistema
SET descripcion = 'Permisos, menú y administración'
WHERE nombre = 'Security';

COMMIT;
