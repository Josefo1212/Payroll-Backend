// T13: login con bcrypt, bloqueo por intentos y reinicio al acertar.
// Crea un usuario desechable, lo limpia al final y verifica:
//   - login correcto,
//   - clave incorrecta suma intentos,
//   - al llegar al maximo queda bloqueado y responde 423,
//   - al vencer el bloqueo el login correcto funciona y resetea el contador.
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
const sobre = (method, params) => ({ subsystem: "Seguridad", class: "Sesion", method, params });

await security.executeMethod(
  {
    subsystem: "Seguridad",
    class: "Usuario",
    method: "registrar",
    params: [{ cedula: CED, primer_nombre: "T13", primer_apellido: "Test", username: USER, password: PASS }],
  },
  { session: { userID: 1, userName: "a", profiles: [2] } },
);

const login = (clave) => security.executeMethod(sobre("login", [USER, clave]), req);
const estado = async () =>
  (
    await db.query("SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1", [USER])
  ).rows[0];

const ok1 = await login(PASS);
console.log("login correcto:", ok1.status === 200, await estado());

await login("mala");
console.log("tras 1 fallo:", await estado());

for (let i = 1; i < 5; i += 1) {
  await login("mala");
}
const bloqueado = await estado();
console.log("tras 5 fallos:", bloqueado);

const estandoBloqueada = await login(PASS);
console.log("correcta estando bloqueada:", estandoBloqueada.status);

await db.query("UPDATE usuario SET bloqueado_hasta = NOW() - interval '1 minute' WHERE username = $1", [USER]);
const ok2 = await login(PASS);
console.log("tras vencer el bloqueo:", ok2.status === 200, await estado());

const fallos = [];
if (ok1.status !== 200) fallos.push("login correcto no devolvio 200");
if ((await estado()).intentos_fallidos !== 0) fallos.push("no reseteo intentos al acertar");
if (bloqueado.intentos_fallidos !== 5) fallos.push("no llego a 5 intentos");
if (!bloqueado.bloqueado_hasta) fallos.push("no se bloqueo al llegar al maximo");
if (estandoBloqueada.status !== 423) fallos.push(`estando bloqueada no dio 423 (dio ${estandoBloqueada.status})`);
if (ok2.status !== 200) fallos.push("no permitio login tras vencer el bloqueo");

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
await db.pool.end();

if (fallos.length > 0) {
  console.error("FALLARON:", fallos);
  process.exit(1);
}
console.log("T13 OK");
process.exit(0);
