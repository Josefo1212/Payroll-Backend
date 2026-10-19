import {authenticateUser} from './src/services/authService.js';
import {db} from './src/database/Database.js';

await db.query("DELETE FROM usuario WHERE username='t13_001'");
await db.query("DELETE FROM persona WHERE cedula='T13-001'");

const {security} = await import('./src/security/Security.js');
await security.loadPermission();
const r = await security.executeMethod({subsystem:'Seguridad',class:'Usuario',method:'registrar',params:[{cedula:'T13-001',primer_nombre:'T',primer_apellido:'T',username:'t13_001',password:'123456'}]},{userID:1,userName:'a',profiles:[2]});
console.log('reg',r.status);
const u = (await db.query("SELECT id,intentos_fallidos,bloqueado_hasta FROM usuario WHERE username='t13_001'")).rows[0];
console.log('u',u);
process.exit(0);
