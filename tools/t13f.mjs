// T13 resultado (más rápido)
import {authenticateUser} from '../src/services/authService.js';
import {db} from '../src/database/Database.js';
import {security} from '../src/security/Security.js';

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");

const r = await security.executeMethod({subsystem:'Seguridad',class:'Usuario',method:'registrar',params:[{cedula:'T13-001',primer_nombre:'T',primer_apellido:'T',username:'t13_001',password:'123456'}]},{userID:1,userName:'a',profiles:[2]});
console.log('REG', r.status);

// desbloqueo limpio
await db.query("UPDATE usuario SET bloqueado_hasta=NULL,intentos_fallidos=0 WHERE username='t13_001'");
const ok1 = await authenticateUser('t13_001','123456');
console.log('LOGIN_OK', !!ok1);
let u = (await db.query("SELECT intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('A1', u.intentos_fallidos, u.bloqueado_hasta);
// fallido
await (async()=>{ try{ await authenticateUser('t13_001','mal'); }catch(e){} })();
u = (await db.query("SELECT intentos_fallidos FROM usuario WHERE username='t13_001'")).rows[0];
console.log('F1', u.intentos_fallidos);
await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");
process.exit(0);
