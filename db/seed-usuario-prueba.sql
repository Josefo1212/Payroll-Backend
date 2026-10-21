-- Usuario de prueba para probar el login y los permisos.
--
-- ADVERTENCIA: es SOLO para desarrollo. Crea 'admin_prueba' con una clave
-- conocida ('Password123'), así que NUNCA debe aplicarse en producción.
-- db-setup.sh solo lo corre con la bandera --with-test-user.
--
-- La clave se guarda con bcrypt (hash cost 12 de "Password123"): el login usa
-- bcrypt.compare, así que no puede quedar en texto plano. Regenerar con:
--   node scripts/hash-password.js "Password123"
--
-- Se liga a los cuatro perfiles (Empleado, GerenteRRHH, Administrador y
-- Superusuario) para poder probar la lógica OR de permisos: basta con que uno
-- autorice. Datos para probar: username admin_prueba / password Password123.
--
-- Correr DESPUÉS de db/init.sql y db/seed-seguridad.sql (que crea los
-- perfiles). Idempotente.

BEGIN;

INSERT INTO persona (cedula, primer_nombre, primer_apellido, email)
VALUES ('TEST-LOGIN-001', 'Usuario', 'Prueba', 'usuario.prueba@local.test')
ON CONFLICT (cedula) DO NOTHING;

-- DO NOTHING: no se reescribe la clave en cada corrida (si alguien la cambió,
-- se respeta). Borrar la fila a mano para volver a sembrarla.
INSERT INTO usuario (persona_id, username, password_hash, debe_cambiar_clave)
SELECT p.id, 'admin_prueba',
       '$2b$12$JGKlv0la5OFqyhJKfLFRWe3KseJEqNEbrEQJPPcfY1F/sqEgpRRg2', false
FROM persona p
WHERE p.cedula = 'TEST-LOGIN-001'
ON CONFLICT (username) DO NOTHING;

-- El usuario de prueba no debe quedar obligado a cambiar la clave: se usa
-- para probar login/permisos, no para el flujo de primer ingreso.
UPDATE usuario
   SET debe_cambiar_clave = false,
       updated_at = NOW()
 WHERE username = 'admin_prueba';

-- Los cuatro perfiles. Con ON CONFLICT DO NOTHING el seed es repetible.
INSERT INTO usuario_perfil (usuario_id, perfil_id)
SELECT u.id, pf.id
FROM usuario u
JOIN perfil pf
  ON pf.nombre_perfil IN ('Empleado', 'GerenteRRHH', 'Administrador', 'Superusuario')
WHERE u.username = 'admin_prueba'
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

COMMIT;
