// E2E de administración de perfiles por HTTP contra la BD apuntada por
// DATABASE_URL. Requiere las migraciones 001–008 aplicadas y el usuario de
// prueba (db/seed-usuario-prueba.sql). Escribe en la BD: usar un branch
// desechable. Limpia su perfil temporal y restaura los perfiles de
// admin_prueba al terminar.
//
//   node scripts/manual/perfiles_e2e.mjs --yes
//
// Flujo: login Superusuario → listar perfiles → crear (con permisos base) →
// duplicado/inválido → editar → guarda de rename → asignar a admin_prueba →
// guarda anti-bloqueo → desactivar/reactivar → limpiar.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";
import { llaveMetodo } from "../../src/services/PermissionKeyService.js";

const PERFIL = "PerfilE2E";
const PERFIL_EDITADO = "PerfilE2E2";
const PERFIL_PROTEGIDO = "Superusuario";
const PERFIL_EMPLEADO = "Empleado";

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

const perfilEnBd = async (id) => {
  const { rows } = await db.query(
    "SELECT id, nombre_perfil, descripcion, activo FROM perfil WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
};

const permisosEnBd = async (id) => {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS total FROM permiso_metodo WHERE perfil_id = $1",
    [id],
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
    [PERFIL, PERFIL_EDITADO],
  );
  for (const { id } of rows) {
    await db.query("DELETE FROM usuario_perfil WHERE perfil_id = $1", [id]);
    await db.query("DELETE FROM permiso_metodo WHERE perfil_id = $1", [id]);
    await db.query("DELETE FROM perfil WHERE id = $1", [id]);
  }
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

  const inicial = await ejecutar(cliente, "Security", "Admin", "listarPerfilesAdmin");
  check("listarPerfilesAdmin", inicial.status, 200);
  const superusuario = inicial.body.find((p) => p.nombre === PERFIL_PROTEGIDO);
  const empleado = inicial.body.find((p) => p.nombre === PERFIL_EMPLEADO);
  check("perfil Superusuario existe", Boolean(superusuario), true);
  check("Superusuario protegido", superusuario?.protegido, true);
  check("perfil Empleado existe", Boolean(empleado), true);

  const creado = await ejecutar(cliente, "Security", "Admin", "crearPerfil", [
    PERFIL,
    "Perfil temporal del E2E",
  ]);
  check("crearPerfil", creado.status, 200);
  check("nombre devuelto", creado.body.nombre, PERFIL);
  check("perfil activo", creado.body.activo, true);
  check("seis permisos base", creado.body.permisosBase, 6);
  check("fila del perfil en BD", Boolean(await perfilEnBd(creado.body.id)), true);
  check("permisos base en BD", await permisosEnBd(creado.body.id), 6);

  const duplicado = await ejecutar(cliente, "Security", "Admin", "crearPerfil", [
    PERFIL.toLowerCase(),
    "Duplicado",
  ]);
  check("nombre duplicado sin distinguir mayúsculas: 409", duplicado.status, 409);

  const invalido = await ejecutar(cliente, "Security", "Admin", "crearPerfil", [
    "1Malo",
    "",
  ]);
  check("nombre inválido: 400", invalido.status, 400);

  const editado = await ejecutar(cliente, "Security", "Admin", "editarPerfil", [
    creado.body.id,
    PERFIL_EDITADO,
    "Perfil temporal editado",
  ]);
  check("editarPerfil", editado.status, 200);
  check("nombre editado", editado.body.nombre, PERFIL_EDITADO);
  const filaEditada = await perfilEnBd(creado.body.id);
  check("nombre editado en BD", filaEditada.nombre_perfil, PERFIL_EDITADO);
  check("descripción editada en BD", filaEditada.descripcion, "Perfil temporal editado");

  const renombrarSuper = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "editarPerfil",
    [superusuario.id, "SuperE2E", "No permitido"],
  );
  check("renombrar Superusuario: 409", renombrarSuper.status, 409);

  const choque = await ejecutar(cliente, "Security", "Admin", "editarPerfil", [
    creado.body.id,
    PERFIL_EMPLEADO,
    "Choque",
  ]);
  check("nombre que ya usa otro perfil: 409", choque.status, 409);

  const conTemporal = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "listarPerfilesAdmin",
  );
  const temporal = conTemporal.body.find((p) => p.id === creado.body.id);
  check("perfil temporal activo y sin usuarios", [
    temporal?.activo,
    temporal?.usuarios,
    temporal?.protegido,
  ], [true, 0, false]);

  const personas = await ejecutar(cliente, "Security", "User", "listarPersonas");
  check("listarPersonas", personas.status, 200);
  const admin = personas.body.find((p) => p.username === "admin_prueba");
  check("admin_prueba con usuario_id", Boolean(admin?.usuario_id), true);
  adminUserId = admin.usuario_id;
  perfilesOriginales = await perfilesDeUsuario(adminUserId);
  check("admin_prueba tiene perfiles", perfilesOriginales.length > 0, true);

  const asignado = await ejecutar(
    cliente,
    "Security",
    "User",
    "establecerPerfilesUsuario",
    [adminUserId, [...perfilesOriginales, creado.body.id]],
  );
  check("establecerPerfilesUsuario", asignado.status, 200);
  check("respuesta incluye el perfil temporal", asignado.body.perfiles.some((p) => p.id === creado.body.id), true);
  check(
    "fila en usuario_perfil",
    (await perfilesDeUsuario(adminUserId)).includes(creado.body.id),
    true,
  );

  const restaurado = await ejecutar(
    cliente,
    "Security",
    "User",
    "establecerPerfilesUsuario",
    [adminUserId, perfilesOriginales],
  );
  check("restaurar perfiles", restaurado.status, 200);
  check(
    "perfiles de admin_prueba restaurados",
    await perfilesDeUsuario(adminUserId),
    perfilesOriginales,
  );

  const { rows: otrosSuper } = await db.query(
    `SELECT COUNT(DISTINCT u.id)::int AS total
     FROM usuario u
     JOIN usuario_perfil up ON up.usuario_id = u.id
     JOIN perfil pf ON pf.id = up.perfil_id
     WHERE u.activo AND pf.activo AND pf.nombre_perfil = 'Superusuario'
       AND u.id <> $1`,
    [adminUserId],
  );
  if (otrosSuper[0].total === 0) {
    const sinSuper = await ejecutar(
      cliente,
      "Security",
      "User",
      "establecerPerfilesUsuario",
      [adminUserId, [empleado.id]],
    );
    check("quitar el último Superusuario: 409", sinSuper.status, 409);
    check(
      "admin_prueba conserva Superusuario",
      (await perfilesDeUsuario(adminUserId)).includes(superusuario.id),
      true,
    );
  } else {
    console.warn(
      `Aviso: hay ${otrosSuper[0].total} superusuario(s) más; se omite la guarda anti-bloqueo.`,
    );
  }

  const llaveBase = llaveMetodo("Session", "Session", "logout", creado.body.id);
  const apagado = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoPerfil",
    [creado.body.id, false],
  );
  check("desactivar perfil", apagado.status, 200);
  check("perfil inactivo", apagado.body.activo, false);
  check("cambio aplicado", apagado.body.cambio, true);
  check("perfil inactivo en BD", (await perfilEnBd(creado.body.id)).activo, false);
  check("llave fuera del mapa", security.PermissionMethodMap.has(llaveBase), false);

  const encendido = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoPerfil",
    [creado.body.id, true],
  );
  check("reactivar perfil", encendido.status, 200);
  check("perfil activo", encendido.body.activo, true);
  check("llave de vuelta en el mapa", security.PermissionMethodMap.has(llaveBase), true);

  const idempotente = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoPerfil",
    [creado.body.id, true],
  );
  check("cambiar al mismo estado es idempotente", idempotente.body.cambio, false);

  const apagarSuper = await ejecutar(
    cliente,
    "Security",
    "Admin",
    "cambiarEstadoPerfil",
    [superusuario.id, false],
  );
  check("desactivar Superusuario: 409", apagarSuper.status, 409);

  const uuidInvalido = await ejecutar(
    cliente,
    "Security",
    "User",
    "establecerPerfilesUsuario",
    ["no-es-uuid", [empleado.id]],
  );
  check("UUID inválido: 400", uuidInvalido.status, 400);
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
console.log("PERFILES E2E OK");
process.exit(0);
