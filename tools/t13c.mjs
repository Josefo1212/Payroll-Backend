import {authenticateUser} from '../src/services/authService.js';
import {db} from '../src/database/Database.js';
import {security} from '../src/security/Security.js';

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");

const r = await security.executeMethod({subsystem:'Seguridad',class:'Usuario',method:'registrar',params:[{cedula:'T13-001',primer_nombre:'T',primer_apellido:'T',username:'t13_001',password:'123456'}]},{userID:1,userName:'a',profiles:[2]});
console.log('REG', r.status);
let u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('U1', u.intentos_fallidos, u.bloqueado_hasta);

// fallidos 1-5
for (let i=0;i<5;i++) { try { await authenticateUser('t13_001','mala'); } catch(e) {} }
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('U2', u.intentos_fallidos, !!u.bloqueado_hasta);

// desbloquear antes de sexto intento
await db.query("UPDATE usuario SET bloqueado_hasta=NOW()-interval '1 minute', intentos_fallidos=5 WHERE username='t13_001'");
// 6to intento falla -> bloquea (>=5? registerFailedAttempt: cuando intentos_fallidos+1 >= MAX -> bloquea)
try { await authenticateUser('t13_001','mala'); } catch(e) { console.log('E6', e.status); }
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('U3', u.intentos_fallidos, !!u.bloqueado_hasta);
// desbloquear
await db.query("UPDATE usuario SET bloqueado_hasta=NOW()-interval '1 minute', intentos_fallidos=0 WHERE username='t13_001'");
const ok = await authenticateUser('t13_001','123456');
console.log('OK', !!ok);
u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('U4', u.intentos_fallidos, u.bloqueado_hasta);
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13_001'");
process.exit(0);
