// T13: intentos fallidos, bloqueo y reinicio al vencer el bloqueo.
import { security } from "../src/security/Security.js";
import { db } from "../src/database/Database.js";
import { crearReq } from "./_req.mjs";

const CED = "T13-001";
const USER = "t13_001";
const PASS = "123456";

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);

const req = crearReq();
const sobre = (clase, method, params) => ({ subsystem: "Seguridad", class: clase, method, params });

await security.executeMethod(
  sobre("Usuario", "registrar", [{ cedula: CED, primer_nombre: "T", primer_apellido: "T", username: USER, password: PASS }]),
  { session: { userID: 1, userName: "a", profiles: [2] } },
);
console.log("reg", 200);

const login = (clave) => security.executeMethod(sobre("Sesion", "login", [USER, clave]), req);
const estado = async () =>
  (await db.query("SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1", [USER])).rows[0];

console.log("u1", await estado());

for (let i = 0; i < 5; i += 1) {
  await login("mala");
}
console.log("u2", await estado());

const sexto = await login("mala");
console.log("e", sexto.status);
console.log("u3", Boolean((await estado()).bloqueado_hasta));

const bloqueada = await login(PASS);
console.log("e2", bloqueada.status);

await db.query("UPDATE usuario SET bloqueado_hasta = NOW() - interval '1 minute', intentos_fallidos = 5 WHERE username = $1", [USER]);
const ok = await login(PASS);
console.log("ok", ok.status === 200);
console.log("u4", await estado());

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
await db.pool.end();
process.exit(0);
