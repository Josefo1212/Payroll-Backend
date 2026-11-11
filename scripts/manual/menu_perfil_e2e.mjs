// E2E del menú por perfil activo, por HTTP contra la BD apuntada por
// DATABASE_URL. Requiere las migraciones 001–013 aplicadas y el usuario de
// prueba (db/seed-usuario-prueba.sql), que tiene los cuatro perfiles.
//
//   node scripts/manual/menu_perfil_e2e.mjs
//
// Es de SOLO LECTURA: no escribe en la BD ni en los mapas de permisos.
// Flujo: login con admin_prueba → getOptions() (unión) → getOptions(perfilId)
// para Superusuario, Administrador, RRHH y Empleado → perfil ajeno 403 →
// perfilId inválido 400 → logout.
import "dotenv/config";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const casos = [];
const check = (nombre, actual, esperado) => {
  casos.push({ nombre, actual, esperado });
  if (JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(
      `FALLÓ "${nombre}": esperado ${JSON.stringify(esperado)}, recibido ${JSON.stringify(actual)}`,
    );
  }
};

const crearCliente = (base) => {
  const cookies = new Map();
  const pedir = async (ruta, { method = "GET", body, headers = {} } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
        ...(cookies.size
          ? { Cookie: [...cookies].map(([clave, valor]) => `${clave}=${valor}`).join("; ") }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
      const par = linea.split(";")[0];
      const corte = par.indexOf("=");
      const nombre = par.slice(0, corte);
      const valor = par.slice(corte + 1);
      if (valor === "") {
        cookies.delete(nombre);
      } else {
        cookies.set(nombre, valor);
      }
    }

    return { status: respuesta.status, body: await respuesta.json().catch(() => null) };
  };
  return { pedir };
};

const ejecutar = (cliente, subsystem, clase, method, params = []) =>
  cliente.pedir("/api/execute", {
    method: "POST",
    body: { subsystem, class: clase, method, params },
  });

const nombres = (opciones) => opciones.map((opcion) => opcion.nombre).sort();
const tiene = (opciones, nombre) => opciones.some((opcion) => opcion.nombre === nombre);
const subsistemas = (opciones) => [...new Set(opciones.map((opcion) => opcion.subsistema))].sort();

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const cliente = crearCliente(base);

  const login = await cliente.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", login.status, 200);

  const perfiles = login.body.profiles ?? [];
  const idDe = (nombre) => perfiles.find((perfil) => perfil.nombre === nombre)?.id;
  const superId = idDe("Superusuario");
  const adminId = idDe("Administrador");
  const rrhhId = idDe("RRHH");
  const empleadoId = idDe("Empleado");
  check("admin_prueba tiene los cuatro perfiles", perfiles.length, 4);
  check("ids de perfil presentes", [superId, adminId, rrhhId, empleadoId].every(Boolean), true);

  const union = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check("getOptions sin perfilId responde 200", union.status, 200);
  check(
    "la unión conserva todos los subsistemas de la sesión",
    subsistemas(union.body),
    ["Payroll", "Security"],
  );
  check("la unión incluye HorasExtras", tiene(union.body, "HorasExtras"), true);

  const superMenu = await ejecutar(cliente, "Security", "Menu", "getOptions", [superId]);
  check("Superusuario responde 200", superMenu.status, 200);
  check("Superusuario ve Seguridad", subsistemas(superMenu.body).includes("Security"), true);
  check("Superusuario ve HorasExtras", tiene(superMenu.body, "HorasExtras"), true);
  check("Superusuario ve Permisos", tiene(superMenu.body, "Permisos"), true);
  check("Superusuario ve Opciones", tiene(superMenu.body, "Opciones"), true);

  const adminMenu = await ejecutar(cliente, "Security", "Menu", "getOptions", [adminId]);
  check("Administrador responde 200", adminMenu.status, 200);
  check("Administrador NO ve HorasExtras", tiene(adminMenu.body, "HorasExtras"), false);
  check("Administrador NO ve Permisos", tiene(adminMenu.body, "Permisos"), false);
  check("Administrador NO ve Opciones", tiene(adminMenu.body, "Opciones"), false);
  check("Administrador ve Perfiles", tiene(adminMenu.body, "Perfiles"), true);

  const rrhhMenu = await ejecutar(cliente, "Security", "Menu", "getOptions", [rrhhId]);
  check("RRHH responde 200", rrhhMenu.status, 200);
  check("RRHH ve HorasExtras", tiene(rrhhMenu.body, "HorasExtras"), true);
  check("RRHH ve Horas", tiene(rrhhMenu.body, "Horas"), true);
  check("RRHH ve Registrar personas", tiene(rrhhMenu.body, "registrar"), true);
  check("RRHH ve Usuarios", tiene(rrhhMenu.body, "Usuarios"), true);
  check("RRHH NO ve Permisos", tiene(rrhhMenu.body, "Permisos"), false);
  check("RRHH NO ve Perfiles", tiene(rrhhMenu.body, "Perfiles"), false);
  check("RRHH NO ve Opciones", tiene(rrhhMenu.body, "Opciones"), false);

  const empleadoMenu = await ejecutar(cliente, "Security", "Menu", "getOptions", [empleadoId]);
  check("Empleado responde 200", empleadoMenu.status, 200);
  check("Empleado solo ve MisRecibos", nombres(empleadoMenu.body), ["MisRecibos"]);
  check("Empleado NO ve Seguridad", subsistemas(empleadoMenu.body).includes("Security"), false);

  const ajeno = await ejecutar(cliente, "Security", "Menu", "getOptions", [999999]);
  check("perfil ajeno responde 403", ajeno.status, 403);

  const invalido = await ejecutar(cliente, "Security", "Menu", "getOptions", ["abc"]);
  check("perfilId inválido responde 400", invalido.status, 400);

  const logout = await cliente.pedir("/api/logout", {
    method: "POST",
    headers: { Origin: process.env.FRONTEND_URL || "http://localhost:5173" },
  });
  check("logout", logout.status, 200);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("MENU PERFIL E2E OK");
process.exit(0);
