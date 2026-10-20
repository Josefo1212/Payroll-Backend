// T13: login correcto, clave mala suma intento, bloqueo y reinicio.
// El login ahora pasa por el BO Sesion vía executeMethod (firma req).
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

const sobre = (method, params) => ({
  subsystem: "Seguridad",
  class: "Sesion",
  method,
  params,
});
const login = (clave) => security.executeMethod(sobre("login", [USER, clave]), req);

const reg = await security.executeMethod(
  {
    subsystem: "Seguridad",
    class: "Usuario",
    method: "registrar",
    params: [{ cedula: CED, primer_nombre: "T13", primer_apellido: "T", username: USER, password: PASS }],
  },
  { session: { userID: 1, userName: "a", profiles: [2] } },
);
console.log("reg:", reg.status);

const estado = async () =>
  (
    await db.query(
      "SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1",
      [USER],
    )
  ).rows[0];

const ok = await login(PASS);
console.log("login correcto:", ok.status, await estado());

await login("mala");
console.log("tras 1 fallo:", (await estado()).intentos_fallidos);

for (let i = 1; i < 5; i += 1) {
  await login("mala");
}
const bloqueado = await estado();
console.log("tras 5 fallos:", bloqueado.intentos_fallidos, Boolean(bloqueado.bloqueado_hasta));

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
const fallos = [];
if (ok.status !== 200) fallos.push("login correcto no devolvio 200");
if (bloqueado.intentos_fallidos !== 5) fallos.push("no llego a 5 intentos");
if (!bloqueado.bloqueado_hasta) fallos.push("no se bloqueo al llegar al maximo");
if (fallos.length > 0) {
  console.error("FALLARON:", fallos);
  process.exit(1);
}
await db.pool.end();
console.log("T13 OK");
process.exit(0);
