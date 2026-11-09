// E2E de administración de permisos de método por perfil, por HTTP contra la
// BD apuntada por DATABASE_URL. Requiere las migraciones 001–006 aplicadas y
// el usuario de prueba (db/seed-usuario-prueba.sql). Escribe en la BD: usar un
// branch desechable. Restaura el estado inicial al terminar.
//
//   node scripts/manual/permisos_e2e.mjs --yes
//
// Flujo: login Superusuario → listar perfiles y métodos → asignar un método a
// Empleado (fila + mapa en caliente) → listar → quitar → idempotencia →
// guarda anti-bloqueo 409 → restaurar.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";
import { llaveMetodo } from "../../src/services/PermissionKeyService.js";

const METODO_PRUEBA = { subsistema: "Payroll", clase: "Cargo", metodo: "listarCargosTarifa" };
const METODO_CRITICO = { subsistema: "Security", clase: "Admin", metodo: "asignarPermisoMetodo" };

const casos = [];
const check = (nombre, actual, esperado) => {
  casos.push({ nombre, actual, esperado });
  if (JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(`FALLÓ "${nombre}": esperado ${JSON.stringify(esperado)}, recibido ${JSON.stringify(actual)}`);
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

const existeFila = async (perfilId, metodoId) => {
  const { rowCount } = await db.query(
    "SELECT 1 FROM permiso_metodo WHERE perfil_id = $1 AND metodo_id = $2",
    [perfilId, metodoId],
  );
  return rowCount === 1;
};

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let restaurar = null;

try {
  const admin = crearCliente(base);
  const login = await admin.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", login.status, 200);

  const perfiles = await ejecutar(admin, "Security", "User", "listarPerfiles");
  check("listarPerfiles", perfiles.status, 200);
  const perfilEmpleado = perfiles.body.find((perfil) => perfil.nombre === "Empleado");
  const perfilSuper = perfiles.body.find((perfil) => perfil.nombre === "Superusuario");
  check("perfil Empleado existe", Boolean(perfilEmpleado), true);
  check("perfil Superusuario existe", Boolean(perfilSuper), true);

  const catalogo = await ejecutar(admin, "Security", "Admin", "listarMetodos");
  check("listarMetodos", catalogo.status, 200);
  check("catálogo no vacío", catalogo.body.length > 0, true);

  const metodo = catalogo.body.find(
    (m) =>
      m.subsistema === METODO_PRUEBA.subsistema &&
      m.clase === METODO_PRUEBA.clase &&
      m.metodo === METODO_PRUEBA.metodo,
  );
  check("método de prueba en el catálogo", Boolean(metodo), true);
  check("método de prueba no es crítico", metodo?.critico, false);

  const critico = catalogo.body.find(
    (m) =>
      m.subsistema === METODO_CRITICO.subsistema &&
      m.clase === METODO_CRITICO.clase &&
      m.metodo === METODO_CRITICO.metodo,
  );
  check("método crítico en el catálogo", Boolean(critico), true);
  check("método crítico marcado", critico?.critico, true);

  const llave = llaveMetodo(
    metodo.subsistema,
    metodo.clase,
    metodo.metodo,
    perfilEmpleado.id,
  );
  const llaveCritico = llaveMetodo(
    critico.subsistema,
    critico.clase,
    critico.metodo,
    perfilSuper.id,
  );

  const inicial = await ejecutar(admin, "Security", "Admin", "listarPermisosMetodo", [
    perfilEmpleado.id,
  ]);
  check("listarPermisosMetodo inicial", inicial.status, 200);
  check("perfil devuelto", inicial.body.perfil.nombre, "Empleado");
  const estabaAsignado = inicial.body.metodos.find((m) => m.id === metodo.id).asignado;
  check(
    "estado inicial coincide con la fila",
    estabaAsignado,
    await existeFila(perfilEmpleado.id, metodo.id),
  );

  // Si el branch ya tenía el permiso, se quita primero para partir de cero.
  if (estabaAsignado) {
    const limpieza = await ejecutar(admin, "Security", "Admin", "quitarPermisoMetodo", [
      perfilEmpleado.id,
      metodo.id,
    ]);
    check("quitar estado previo", limpieza.status, 200);
  }
  restaurar = async () => {
    if (estabaAsignado) {
      await ejecutar(admin, "Security", "Admin", "asignarPermisoMetodo", [
        perfilEmpleado.id,
        metodo.id,
      ]);
    }
  };

  const asignado = await ejecutar(admin, "Security", "Admin", "asignarPermisoMetodo", [
    perfilEmpleado.id,
    metodo.id,
  ]);
  check("asignarPermisoMetodo", asignado.status, 200);
  check("respuesta asignado", asignado.body.asignado, true);
  check("primera asignación no era existente", asignado.body.yaEstaba, false);
  check("fila en permiso_metodo", await existeFila(perfilEmpleado.id, metodo.id), true);
  check("llave en PermissionMethodMap", security.PermissionMethodMap.has(llave), true);

  const repetido = await ejecutar(admin, "Security", "Admin", "asignarPermisoMetodo", [
    perfilEmpleado.id,
    metodo.id,
  ]);
  check("asignar repetido responde 200", repetido.status, 200);
  check("asignar repetido es idempotente", repetido.body.yaEstaba, true);

  const conPermiso = await ejecutar(admin, "Security", "Admin", "listarPermisosMetodo", [
    perfilEmpleado.id,
  ]);
  check("listarPermisosMetodo con permiso", conPermiso.status, 200);
  check(
    "método marcado como asignado",
    conPermiso.body.metodos.find((m) => m.id === metodo.id).asignado,
    true,
  );

  const quitado = await ejecutar(admin, "Security", "Admin", "quitarPermisoMetodo", [
    perfilEmpleado.id,
    metodo.id,
  ]);
  check("quitarPermisoMetodo", quitado.status, 200);
  check("respuesta asignado en false", quitado.body.asignado, false);
  check("primera remoción existía", quitado.body.yaNoEstaba, false);
  check("fila borrada de permiso_metodo", await existeFila(perfilEmpleado.id, metodo.id), false);
  check("llave fuera de PermissionMethodMap", security.PermissionMethodMap.has(llave), false);

  const quitadoOtraVez = await ejecutar(admin, "Security", "Admin", "quitarPermisoMetodo", [
    perfilEmpleado.id,
    metodo.id,
  ]);
  check("quitar repetido responde 200", quitadoOtraVez.status, 200);
  check("quitar repetido es idempotente", quitadoOtraVez.body.yaNoEstaba, true);

  const bloqueado = await ejecutar(admin, "Security", "Admin", "quitarPermisoMetodo", [
    perfilSuper.id,
    critico.id,
  ]);
  check("quitar crítico a Superusuario responde 409", bloqueado.status, 409);
  check("mensaje de guarda anti-bloqueo", /crítico/.test(bloqueado.body.error ?? ""), true);
  check(
    "fila del crítico intacta",
    await existeFila(perfilSuper.id, critico.id),
    true,
  );
  check("llave del crítico intacta", security.PermissionMethodMap.has(llaveCritico), true);

  const idsInvalidos = await ejecutar(admin, "Security", "Admin", "asignarPermisoMetodo", [
    "x",
    metodo.id,
  ]);
  check("id inválido responde 400", idsInvalidos.status, 400);

  const perfilInexistente = await ejecutar(
    admin,
    "Security",
    "Admin",
    "listarPermisosMetodo",
    [999999],
  );
  check("perfil inexistente responde 404", perfilInexistente.status, 404);

  await restaurar();
  restaurar = null;
  check(
    "estado inicial restaurado",
    await existeFila(perfilEmpleado.id, metodo.id),
    estabaAsignado,
  );
  check(
    "mapa restaurado",
    security.PermissionMethodMap.has(llave),
    estabaAsignado,
  );

  const logout = await admin.pedir("/api/logout", {
    method: "POST",
    headers: { Origin: process.env.FRONTEND_URL || "http://localhost:5173" },
  });
  check("logout", logout.status, 200);
} finally {
  if (restaurar) {
    await restaurar().catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("PERMISOS E2E OK");
process.exit(0);
