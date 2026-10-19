// T12: registrar crea Persona+Usuario y duplicado no deja filas
import { security } from "../src/security/Security.js";
import { db } from "../src/database/Database.js";

await security.loadPermission();

const superu = { userID: 1, userName: "admin_prueba", profiles: [2] };
const datos = {
  cedula: "T12-001",
  primer_nombre: "Test",
  primer_apellido: "T12",
  segundo_nombre: null,
  segundo_apellido: null,
  fecha_nacimiento: "1990-01-01",
  sexo: "M",
  estado_civil: "SOLTERO",
  nro_tlf: "123",
  email: "t12_001@example.com",
  direccion: null,
  rif: null,
  username: "t12_001",
  password: "123456"
};

const r1 = await security.executeMethod({ subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [datos] }, superu);
console.log("r1:", r1.status, r1.body);

// contar filas
const cp = await db.query("SELECT count(*) FROM persona WHERE cedula='T12-001'");
const cu = await db.query("SELECT count(*) FROM usuario WHERE username='t12_001'");
console.log("counts1:", cp.rows[0].count, cu.rows[0].count);

// intento duplicado
try {
  const r2 = await security.executeMethod({ subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [datos] }, superu);
  console.log("r2:", r2.status, r2.body);
} catch (e) {
  console.log("err2");
}

// limpiar (idempotente no requerido; solo para no ensuciar)
await db.query("DELETE FROM usuario WHERE username='t12_001'");
await db.query("DELETE FROM persona WHERE cedula='T12-001'");
const cp2 = await db.query("SELECT count(*) FROM persona WHERE cedula='T12-001'");
const cu2 = await db.query("SELECT count(*) FROM usuario WHERE username='t12_001'");
console.log("counts2:", cp2.rows[0].count, cu2.rows[0].count);
process.exit(0);
