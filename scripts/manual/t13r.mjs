// T13: registra un usuario desechable y muestra su estado de intentos.
import "./_guard.mjs";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const CED = "T13-001";
const USER = "t13_001";

await security.loadPermission();
await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);

const reg = await security.executeMethod(
  {
    subsystem: "Seguridad",
    class: "Usuario",
    method: "registrar",
    params: [{ cedula: CED, primer_nombre: "T", primer_apellido: "T", username: USER, password: "clave123" }],
  },
  { session: { userID: 1, userName: "a", profiles: [2] } },
);
console.log("reg", reg.status);

const u = (await db.query("SELECT id, intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1", [USER])).rows[0];
console.log("u", u);

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
await db.pool.end();
process.exit(0);
