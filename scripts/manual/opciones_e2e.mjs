// E2E de administración del catálogo de opciones de menú y de la asignación
// perfil ↔ opción, por HTTP contra la BD apuntada por DATABASE_URL. Requiere
// las migraciones 001–010 aplicadas y el usuario de prueba
// (db/seed-usuario-prueba.sql). Escribe en la BD: usar un branch desechable.
// Limpia sus perfiles/opciones temporales y restaura los perfiles de
// admin_prueba al terminar.
//
//   node scripts/manual/opciones_e2e.mjs --yes
//
// Flujo: login Superusuario → catálogo de opciones → crear perfil temporal →
// crear/duplicar/editar/desactivar/reactivar una opción temporal → asignar y
// quitar la opción a un perfil comprobando el menú en caliente → guardas de
// opciones críticas → crear un perfil clonando los permisos de Empleado →
// limpiar.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";
import { llaveOpcion } from "../../src/services/PermissionKeyService.js";

const PERFIL = "PerfilOpcE2E";
const PERFIL_CLON = "ClonOpcE2E";
const OPCION = "ReporteE2E";
const OPCION_EDITADA = "ReporteE2E2";
const SUBSISTEMA_PAYROLL = "Payroll";
const PERFIL_PROTEGIDO = "Superusuario";
const PERFIL_EMPLEADO = "Empleado";
const OPCION_CRITICA = "Opciones";

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

const opcionEnBd = async (id) => {
  const { rows } = await db.query(
    "SELECT id, nombre, descripcion, orden, activo FROM opcion WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
};

const permisosOpcionEnBd = async (perfilId) => {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM permiso_opcion WHERE perfil_id = $1",
    [perfilId],
  );
  return rows[0].total;
};

const perfilesDeUsuario = async (usuarioId) => {
  const { rows } = await db.query(
    "SELECT perfil_id FROM usuario_perfil WHERE usuario_id = $1 ORDER BY perfil_id",
    [usuarioId],
  );
  return rows.map((fila) => fila.perfil_id);
};

// Deja la base como estaba si una corrida anterior falló a mitad de camino.
const limpiarTemporal = async () => {
  const { rows } = await db.query(
    "SELECT id FROM perfil WHERE LOWER(nombre_perfil) IN (LOWER($1), LOWER($2))",
    [PERFIL, PERFIL_CLON],
  );
  for (const { id } of rows) {
    await db.query("DELETE FROM usuario_perfil WHERE perfil_id = $1", [id]);
    await db.query("DELETE FROM permiso_metodo WHERE perfil_id = $1", [id]);
    await db.query("DELETE FROM permiso_opcion WHERE perfil_id = $1", [id]);
    await db.query("DELETE FROM perfil WHERE id = $1", [id]);
  }

  await db.query(
    "DELETE FROM opcion WHERE LOWER(nombre) IN (LOWER($1), LOWER($2))",
    [OPCION, OPCION_EDITADA],
  );
};

const restaurarPerfiles = async (usuarioId, perfiles) => {
  if (!usuarioId || !Array.isArray(perfiles)) {
    return;
  }
  await db.query("DELETE FROM usuario_perfil WHERE usuario_id = $1", [usuarioId]);
  if (perfiles.length > 0) {
    await db.query(
      "INSERT INTO usuario_perfil (usuario_id, perfil_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING",
      [usuarioId, perfiles],
    );
  }
};

await limpiarTemporal();
await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let adminUserId = null;
let perfilesOriginales = null;
let cliente = null;

try {
  cliente = crearCliente(base);
  const login = await cliente.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", login.status, 200);

  // --- Catálogo de opciones -------------------------------------------------
  const catalogo = await ejecutar(cliente, "Security", "Admin", "listarOpciones");
  check("listarOpciones", catalogo.status, 200);
  check("catálogo no vacío", catalogo.body.length > 0, true);

  const critica = catalogo.body.find(
    (o) => o.subsistema === "Security" && o.nombre === OPCION_CRITICA,
  );
  check("opción crítica existe", Boolean(critica), true);
  check("opción crítica protegida", critica?.protegida, true);
  check("opción crítica ve Superusuario", critica?.perfiles, 1);
  check("catálogo trae subsistemaId", typeof critica?.subsistemaId, "number");

  const payroll = catalogo.body.find((o) => o.subsistema === SUBSISTEMA_PAYROLL);
  check("subsistema Payroll en el catálogo", Boolean(payroll?.subsistemaId), true);

  // --- Perfil temporal ------------------------------------------------------
  const perfil = await ejecutar(cliente, "Security", "Admin", "crearPerfil", [
    PERFIL,
    "Perfil temporal del E2E de opciones",
  ]);
  check("crearPerfil", perfil.status, 200);
  check("seis permisos base", perfil.body.permisosBase, 6);
  check("perfil sin opciones", await permisosOpcionEnBd(perfil.body.id), 0);

  const inicial = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPermisosOpcion",
    [perfil.body.id],
  );
  check("listarPermisosOpcion", inicial.status, 200);
  check("perfil temporal sin opciones asignadas", [
    inicial.body.opciones.length > 0,
    inicial.body.opciones.every((o) => o.asignado === false),
  ], [true, true]);

  // --- CRUD del catálogo ----------------------------------------------------
  const creada = await ejecutar(cliente, "Security", "Admin", "crearOpcion", [
    payroll.subsistemaId,
    OPCION,
    "Opción temporal del E2E",
    99,
  ]);
  check("crearOpcion", creada.status, 200);
  check("opción creada", [creada.body.nombre, creada.body.activo, creada.body.perfiles], [
    OPCION,
    true,
    0,
  ]);
  check("opción en BD", Boolean(await opcionEnBd(creada.body.id)), true);

  const duplicada = await ejecutar(cliente, "Security", "Admin", "crearOpcion", [
    payroll.subsistemaId,
    OPCION.toLowerCase(),
    "Duplicada",
    100,
  ]);
  check("nombre duplicado sin distinguir mayúsculas: 409", duplicada.status, 409);

  const invalida = await ejecutar(cliente, "Security", "Admin", "crearOpcion", [
    payroll.subsistemaId,
    "1Mala",
    "",
    1,
  ]);
  check("nombre inválido: 400", invalida.status, 400);

  // --- Asignación perfil ↔ opción con el menú en caliente -------------------
  const personas = await ejecutar(cliente, "Security", "User", "listarPersonas");
  check("listarPersonas", personas.status, 200);
  const admin = personas.body.find((p) => p.username === "admin_prueba");
  check("admin_prueba con usuario_id", Boolean(admin?.usuario_id), true);
  adminUserId = admin.usuario_id;
  perfilesOriginales = await perfilesDeUsuario(adminUserId);
  check("admin_prueba tiene perfiles", perfilesOriginales.length > 0, true);

  const asignadoPerfil = await ejecutar(
    cliente,
    "Security",
    "User",
    "establecerPerfilesUsuario",
    [adminUserId, [...perfilesOriginales, perfil.body.id]],
  );
  check("asignar perfil temporal a admin_prueba", asignadoPerfil.status, 200);

  const menuAntes = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check("getOptions antes", menuAntes.status, 200);
  check(
    "la opción no aparece antes de asignarla",
    menuAntes.body.some((o) => o.id === creada.body.id),
    false,
  );

  const asignada = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "asignarPermisoOpcion",
    [perfil.body.id, creada.body.id],
  );
  check("asignarPermisoOpcion", asignada.status, 200);
  check("asignación nueva", [asignada.body.asignado, asignada.body.yaEstaba], [true, false]);
  check("llave en el mapa", security.PermissionOptionMap.has(
    llaveOpcion(SUBSISTEMA_PAYROLL, OPCION, perfil.body.id),
  ), true);

  const menuDespues = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check(
    "la opción aparece sin reiniciar",
    menuDespues.body.some((o) => o.id === creada.body.id),
    true,
  );

  const repetida = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "asignarPermisoOpcion",
    [perfil.body.id, creada.body.id],
  );
  check("asignar repetido es idempotente", repetida.body.yaEstaba, true);

  const leida = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPermisosOpcion",
    [perfil.body.id],
  );
  check(
    "listarPermisosOpcion marca la asignada",
    leida.body.opciones.filter((o) => o.asignado).map((o) => o.id),
    [creada.body.id],
  );

  // --- Renombrar en caliente ------------------------------------------------
  const editada = await ejecutar(cliente, "Security", "Admin", "editarOpcion", [
    creada.body.id,
    OPCION_EDITADA,
    "Opción temporal renombrada",
    98,
  ]);
  check("editarOpcion", editada.status, 200);
  check("nombre editado", editada.body.nombre, OPCION_EDITADA);
  check("nombre editado en BD", (await opcionEnBd(creada.body.id)).nombre, OPCION_EDITADA);
  check("llave vieja fuera del mapa", security.PermissionOptionMap.has(
    llaveOpcion(SUBSISTEMA_PAYROLL, OPCION, perfil.body.id),
  ), false);

  const menuRenombrado = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check(
    "el menú muestra el nombre nuevo",
    menuRenombrado.body.find((o) => o.id === creada.body.id)?.nombre,
    OPCION_EDITADA,
  );

  // --- Desactivar / reactivar en caliente -----------------------------------
  const apagada = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoOpcion",
    [creada.body.id, false],
  );
  check("desactivar opción", apagada.status, 200);
  check("opción inactiva", [apagada.body.activo, apagada.body.cambio], [false, true]);
  check("opción inactiva en BD", (await opcionEnBd(creada.body.id)).activo, false);

  const menuApagado = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check(
    "la opción desaparece del menú",
    menuApagado.body.some((o) => o.id === creada.body.id),
    false,
  );

  const encendida = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoOpcion",
    [creada.body.id, true],
  );
  check("reactivar opción", encendida.status, 200);
  check("opción activa", [encendida.body.activo, encendida.body.cambio], [true, true]);

  const menuEncendido = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check(
    "la opción vuelve al menú",
    menuEncendido.body.some((o) => o.id === creada.body.id),
    true,
  );

  const idempotente = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoOpcion",
    [creada.body.id, true],
  );
  check("cambiar al mismo estado es idempotente", idempotente.body.cambio, false);

  // --- Quitar la asignación -------------------------------------------------
  const quitada = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "quitarPermisoOpcion",
    [perfil.body.id, creada.body.id],
  );
  check("quitarPermisoOpcion", quitada.status, 200);
  check("asignación quitada", [quitada.body.asignado, quitada.body.yaNoEstaba], [false, false]);
  check("fila borrada en BD", await permisosOpcionEnBd(perfil.body.id), 0);

  const menuQuitado = await ejecutar(cliente, "Security", "Menu", "getOptions");
  check(
    "la opción sale del menú al quitar el permiso",
    menuQuitado.body.some((o) => o.id === creada.body.id),
    false,
  );

  const quitarRepetido = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "quitarPermisoOpcion",
    [perfil.body.id, creada.body.id],
  );
  check("quitar repetido es idempotente", quitarRepetido.body.yaNoEstaba, true);

  // --- Guardas de opciones críticas ----------------------------------------
  const perfilesAdmin = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPerfilesAdmin",
  );
  const superPerfil = perfilesAdmin.body.find((p) => p.nombre === PERFIL_PROTEGIDO);
  const empleadoPerfil = perfilesAdmin.body.find((p) => p.nombre === PERFIL_EMPLEADO);
  check("perfil Superusuario existe", Boolean(superPerfil), true);
  check("perfil Empleado existe", Boolean(empleadoPerfil), true);

  const quitarCritica = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "quitarPermisoOpcion",
    [superPerfil.id, critica.id],
  );
  check("quitar opción crítica a Superusuario: 409", quitarCritica.status, 409);

  const renombrarCritica = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "editarOpcion",
    [critica.id, "OpcionesE2E", critica.descripcion, critica.orden],
  );
  check("renombrar opción crítica: 409", renombrarCritica.status, 409);

  const apagarCritica = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoOpcion",
    [critica.id, false],
  );
  check("desactivar opción crítica: 409", apagarCritica.status, 409);

  // --- Clonación de permisos desde una plantilla ---------------------------
  const permisosEmpleadoMetodo = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPermisosMetodo",
    [empleadoPerfil.id],
  );
  const permisosEmpleadoOpcion = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPermisosOpcion",
    [empleadoPerfil.id],
  );
  const metodosEmpleado = permisosEmpleadoMetodo.body.metodos.filter((m) => m.asignado).length;
  const opcionesEmpleado = permisosEmpleadoOpcion.body.opciones.filter((o) => o.asignado).length;

  const clon = await ejecutar(cliente, "Security", "Admin", "crearPerfil", [
    PERFIL_CLON,
    "Clon de Empleado del E2E",
    empleadoPerfil.id,
  ]);
  check("crearPerfil con plantilla", clon.status, 200);
  check("métodos clonados", clon.body.permisosMetodo, metodosEmpleado);
  check("opciones clonadas", clon.body.permisosOpcion, opcionesEmpleado);
  check("opciones del clon en BD", await permisosOpcionEnBd(clon.body.id), opcionesEmpleado);

  const plantillaInvalida = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "crearPerfil",
    ["ClonMaloE2E", "", 999999],
  );
  check("plantilla inexistente: 404", plantillaInvalida.status, 404);
} finally {
  if (cliente) {
    await cliente
      .pedir("/api/logout", {
        method: "POST",
        headers: { Origin: process.env.FRONTEND_URL || "http://localhost:5173" },
      })
      .catch(() => {});
  }
  await restaurarPerfiles(adminUserId, perfilesOriginales).catch(() => {});
  await limpiarTemporal().catch(() => {});
  await security.loadPermission().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("OPCIONES E2E OK");
process.exit(0);
