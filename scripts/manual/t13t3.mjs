// T13: intentos fallidos, bloqueo y reinicio (variante t3).
import "./_guard.mjs";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";
import { crearReq } from "./_req.mjs";

const CED = "T13-001";
const USER = "t13_001";
const PASS = "clave123";

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);

const req = crearReq();
const sobre = (clase, method, params) => ({ subsystem: "Seguridad", class: clase, method, params });

await security.executeMethod(
  sobre("Usuario", "registrar", [{ cedula: CED, primer_nombre: "T", primer_apellido: "T", username: USER, password: PASS }]),
  { session: { userID: 1, userName: "a", profiles: [2] } },
);
console.log("REG:", 200);

const login = (clave) => security.executeMethod(sobre("Sesion", "login", [USER, clave]), req);
const estado = async () =>
  (await db.query("SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1", [USER])).rows[0];

let u = await estado();
console.log("U1:", u.intentos_fallidos, u.bloqueado_hasta);

for (let i = 0; i < 5; i += 1) {
  await login("mala");
}
u = await estado();
console.log("U2:", u.intentos_fallidos, Boolean(u.bloqueado_hasta));

const sexto = await login("mala");
console.log("E6:", sexto.status);
u = await estado();
console.log("U3:", u.intentos_fallidos, Boolean(u.bloqueado_hasta));

await db.query("UPDATE usuario SET bloqueado_hasta = NOW() - interval '1 minute', intentos_fallidos = 5 WHERE username = $1", [USER]);
const ok = await login(PASS);
console.log("OK:", ok.status === 200);
u = await estado();
console.log("U4:", u.intentos_fallidos, u.bloqueado_hasta);

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
await db.pool.end();
process.exit(0);
