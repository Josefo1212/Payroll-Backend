import bcrypt from 'bcrypt';
import {authenticateUser} from '../src/services/authService.js';
import {db} from '../src/database/Database.js';
import {security} from '../src/security/Security.js';

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");

const r = await security.executeMethod({subsystem:'Seguridad',class:'Usuario',method:'registrar',params:[{cedula:'T13-001',primer_nombre:'T',primer_apellido:'T',username:'t13_001',password:'123456'}]},{userID:1,userName:'a',profiles:[2]});
console.log('reg',r.status);

let u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('u1',u);

// 5 intentos fallidos
for (let i=0;i<5;i++) {
  try { await authenticateUser('t13_001','mala'); } catch(e) {}
}
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('u2',u);

// 6to debe bloquear
try { await authenticateUser('t13_001','mala'); } catch(e) { console.log('e',e.status); }
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('u3',u && u.bloqueado_hasta);

// login correcto tras bloqueo? no, debe rechazar 423
try { await authenticateUser('t13_001','123456'); } catch(e) { console.log('e2',e.status); }

// simular desbloqueo: poner bloqueado_hasta pasado
await db.query("UPDATE usuario SET bloqueado_hasta=NOW()-interval '1 minute', intentos_fallidos=5 WHERE username='t13_001'");
// ahora correcto debe resetear
const ok = await authenticateUser('t13_001','123456');
console.log('ok', !!ok);
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('u4',u);

// limpiar
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");
process.exit(0);
