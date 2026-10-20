// T12: registrar crea Persona + Usuario (clave hasheada, debe cambiar clave),
// rechaza obligatorios faltantes y no deja filas con datos duplicados.
import { security } from "../src/security/Security.js";
import { db } from "../src/database/Database.js";
import { reqDe } from "./_req.mjs";

const CED = "T12-001";
const USER = "t12_001";

await security.loadPermission();

const superu = { userID: 1, userName: "admin_prueba", profiles: [2] };
const datos = {
  cedula: CED,
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
  username: USER,
  password: "123456",
};

const casos = [];
const check = (nombre, actual, esperado) => casos.push({ nombre, actual, esperado });
const contar = async (tabla, columna, valor) =>
  (await db.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${columna} = $1`, [valor]))
    .rows[0].n;
const limpiar = async () => {
  await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
  await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
};

await limpiar();

try {
  const faltan = await security.executeMethod(
    {
      subsystem: "Seguridad",
      class: "Usuario",
      method: "registrar",
      params: [{ cedula: CED }],
    },
    reqDe(superu),
  );
  check("400 faltan obligatorios", faltan.status, 400);
  check("400 no crea persona", await contar("persona", "cedula", CED), 0);

  const r1 = await security.executeMethod(
    { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [datos] },
    reqDe(superu),
  );
  check("200 registra", r1.status, 200);
  check("una persona", await contar("persona", "cedula", CED), 1);
  check("un usuario", await contar("usuario", "username", USER), 1);

  const usuario = (
    await db.query(
      "SELECT password_hash, debe_cambiar_clave FROM usuario WHERE username = $1",
      [USER],
    )
  ).rows[0];
  check("clave hasheada", Boolean(usuario?.password_hash?.startsWith("$2")), true);
  check("clave no queda en texto plano", usuario?.password_hash === datos.password, false);
  check("debe cambiar clave", usuario?.debe_cambiar_clave, true);

  const r2 = await security.executeMethod(
    { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [datos] },
    reqDe(superu),
  );
  check("409 duplicado", r2.status, 409);
} finally {
  await limpiar();
}

check("sin residuos persona", await contar("persona", "cedula", CED), 0);
check("sin residuos usuario", await contar("usuario", "username", USER), 0);

console.table(casos);
const fallidos = casos.filter((caso) => caso.actual !== caso.esperado);
if (fallidos.length > 0) {
  console.error("FALLARON:", fallidos);
  process.exit(1);
}
console.log("T12 OK");
process.exit(0);
