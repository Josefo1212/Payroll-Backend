// T13: login con bcrypt, bloqueo por intentos y reinicio al acertar.
// Crea un usuario desechable, lo limpia al final y verifica:
//   - login correcto,
//   - clave incorrecta suma intentos,
//   - al llegar al maximo queda bloqueado y responde 423,
//   - al vencer el bloqueo el login correcto funciona y resetea el contador.
import bcrypt from "bcrypt";
import { pool } from "../src/config/database.js";
import { db } from "../src/database/Database.js";
import { authenticateUser } from "../src/services/authService.js";

const CED = "T13-001";
const USER = "t13_001";
const PASS = "123456";

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);

const hash = await bcrypt.hash(PASS, 10);
const persona = await db.query(
  "INSERT INTO persona (cedula, primer_nombre, primer_apellido) VALUES ($1,'T13','Test') RETURNING id",
  [CED],
);
await db.query(
  "INSERT INTO usuario (persona_id, username, password_hash) VALUES ($1,$2,$3)",
  [persona.rows[0].id, USER, hash],
);

const estado = async () =>
  (
    await db.query(
      "SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE username = $1",
      [USER],
    )
  ).rows[0];

const ok1 = await authenticateUser(USER, PASS);
console.log("login correcto:", !!ok1, await estado());

await authenticateUser(USER, "mala");
console.log("tras 1 fallo:", await estado());

for (let i = 1; i < 5; i++) await authenticateUser(USER, "mala");
const bloqueado = await estado();
console.log("tras 5 fallos:", bloqueado);

let statusBloqueo = null;
try {
  await authenticateUser(USER, PASS);
} catch (error) {
  statusBloqueo = error.status;
}
console.log("correcta estando bloqueada:", statusBloqueo);

await db.query(
  "UPDATE usuario SET bloqueado_hasta = NOW() - interval '1 minute' WHERE username = $1",
  [USER],
);
const ok2 = await authenticateUser(USER, PASS);
console.log("tras vencer el bloqueo:", !!ok2, await estado());

const fallos = [];
if (!ok1) fallos.push("login correcto no devolvio usuario");
if ((await estado()).intentos_fallidos !== 0) fallos.push("no reseteo intentos al acertar");
if (bloqueado.intentos_fallidos !== 5) fallos.push("no llego a 5 intentos");
if (!bloqueado.bloqueado_hasta) fallos.push("no se bloqueo al llegar al maximo");
if (statusBloqueo !== 423) fallos.push(`estando bloqueada no dio 423 (dio ${statusBloqueo})`);
if (!ok2) fallos.push("no permitio login tras vencer el bloqueo");

await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
await pool.end();

if (fallos.length > 0) {
  console.error("FALLARON:", fallos);
  process.exit(1);
}
console.log("T13 OK");
process.exit(0);
