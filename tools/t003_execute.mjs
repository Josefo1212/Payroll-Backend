// T003: POST /api/execute de punta a punta por HTTP.
// Arranca la app en un puerto efímero, hace login real (cookie incluida) y
// comprueba 401, 200, 409, 400, 403 y 501. Limpia los datos al final.
import app from "../src/app.js";
import { security } from "../src/security/Security.js";
import { db } from "../src/database/Database.js";

const CED = "T003-001";
const USER = "t003_001";

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let cookie = "";
const pedir = async (ruta, opciones = {}) => {
  const respuesta = await fetch(`${base}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...opciones.headers,
    },
  });
  const setCookie =
    respuesta.headers.getSetCookie?.()[0] ?? respuesta.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const body = await respuesta.json().catch(() => null);
  return { status: respuesta.status, body };
};

const casos = [];
const check = (nombre, actual, esperado) => casos.push({ nombre, actual, esperado });
const sobre = (extra = {}) => ({
  subsystem: "Seguridad",
  class: "Usuario",
  method: "registrar",
  params: [],
  ...extra,
});
const datos = {
  cedula: CED,
  primer_nombre: "Test",
  primer_apellido: "T003",
  email: "t003_001@example.com",
  username: USER,
  password: "123456",
};
const contarUsuario = async () =>
  (
    await db.query("SELECT count(*)::int AS n FROM usuario WHERE username = $1", [
      USER,
    ])
  ).rows[0].n;
const limpiar = async () => {
  await db.query("DELETE FROM usuario WHERE username = $1", [USER]);
  await db.query("DELETE FROM persona WHERE cedula = $1", [CED]);
};

await limpiar();

try {
  const sinSesion = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ params: [datos] })),
  });
  check("401 sin sesión", sinSesion.status, 401);

  // El login también pasa por el endpoint único (BO Sesion).
  const login = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify({
      subsystem: "Seguridad",
      class: "Sesion",
      method: "login",
      params: ["admin_prueba", "Password123"],
    }),
  });
  check("200 login", login.status, 200);

  const forma = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ params: "no-es-arreglo" })),
  });
  check("400 forma", forma.status, 400);

  const sinPermiso = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ method: "zzz" })),
  });
  check("403 sin permiso", sinPermiso.status, 403);

  // Se concede el permiso solo en memoria para llegar a la reflexión (501).
  security.setPermissionMethod("Seguridad", "Usuario", "zzz", 2);
  const inexistente = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ method: "zzz" })),
  });
  check("501 método", inexistente.status, 501);

  const registrado = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ params: [datos] })),
  });
  check("200 registra", registrado.status, 200);
  check("devuelve username", registrado.body?.username, USER);
  check("un usuario", await contarUsuario(), 1);

  const duplicado = await pedir("/api/execute", {
    method: "POST",
    body: JSON.stringify(sobre({ params: [datos] })),
  });
  check("409 duplicado", duplicado.status, 409);
} finally {
  await limpiar();
  check("sin residuos", await contarUsuario(), 0);
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
const fallidos = casos.filter((caso) => caso.actual !== caso.esperado);
if (fallidos.length > 0) {
  console.error("FALLARON:", fallidos);
  process.exit(1);
}
console.log("T003 OK");
process.exit(0);
