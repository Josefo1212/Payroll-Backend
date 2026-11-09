import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import { Admin } from "../src/bo/Security/Admin.js";
import { queries } from "../src/bo/Security/loader.js";
import { llaveMetodo } from "../src/services/PermissionKeyService.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const dbOriginal = security.db;
const mapaOriginal = security.PermissionMethodMap;

const CLAVE_CARGO = llaveMetodo("Payroll", "Cargo", "listarCargosTarifa", 2);
const CLAVE_CRITICO = llaveMetodo("Security", "Admin", "listarMetodos", 1);

// Estado mínimo: tres métodos activos, uno inactivo y tres perfiles (uno
// inactivo). `permisos` guarda las filas de permiso_metodo como "perfil:metodo".
function crearEstado() {
  return {
    metodos: [
      {
        id: 1,
        subsistema: "Security",
        clase: "Admin",
        metodo: "listarMetodos",
        descripcion: "Lista los métodos",
      },
      {
        id: 2,
        subsistema: "Security",
        clase: "User",
        metodo: "listarPerfiles",
        descripcion: "Lista los perfiles",
      },
      {
        id: 3,
        subsistema: "Payroll",
        clase: "Cargo",
        metodo: "listarCargosTarifa",
        descripcion: "Lista cargos con tarifa",
      },
      {
        id: 4,
        subsistema: "Payroll",
        clase: "Cargo",
        metodo: "inactivo",
        descripcion: "Método apagado",
        activo: false,
      },
    ],
    perfiles: [
      {
        id: 1,
        nombre_perfil: "Superusuario",
        descripcion: "Acceso total",
        activo: true,
      },
      {
        id: 2,
        nombre_perfil: "Administrador",
        descripcion: "Administra el sistema",
        activo: true,
      },
      {
        id: 3,
        nombre_perfil: "Empleado",
        descripcion: "Usuario final",
        activo: false,
      },
    ],
    permisos: new Set(["1:1"]),
  };
}

function crearDbPermisos(estado, { fallarInsert = false } = {}) {
  const activo = (fila) => fila.activo !== false;

  return {
    query: async (texto, params = []) => {
      if (texto === queries.findAllActiveMethods) {
        // Mismo ORDER BY del SQL: subsistema, clase, método.
        const rows = estado.metodos
          .filter(activo)
          .sort(
            (a, b) =>
              a.subsistema.localeCompare(b.subsistema) ||
              a.clase.localeCompare(b.clase) ||
              a.metodo.localeCompare(b.metodo),
          );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findPermisosMetodoPorPerfil) {
        const [perfilId] = params;
        const activos = new Set(estado.metodos.filter(activo).map((m) => m.id));
        const rows = [...estado.permisos]
          .map((clave) => clave.split(":").map(Number))
          .filter(([idPerfil, idMetodo]) => idPerfil === perfilId && activos.has(idMetodo))
          .map(([, metodoId]) => ({ metodo_id: metodoId }))
          .sort((a, b) => a.metodo_id - b.metodo_id);
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findPerfilById) {
        const [perfilId] = params;
        const perfil = estado.perfiles.find((p) => p.id === perfilId);
        return { rows: perfil ? [perfil] : [], rowCount: perfil ? 1 : 0 };
      }

      if (texto === queries.findMetodoById) {
        const [metodoId] = params;
        const metodo = estado.metodos.find((m) => m.id === metodoId);
        if (!metodo) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              ...metodo,
              activo: metodo.activo !== false,
              clase_activa: true,
              subsistema_activo: true,
            },
          ],
          rowCount: 1,
        };
      }

      if (texto === queries.insertPermisoMetodo) {
        if (fallarInsert) {
          throw new Error("fallo simulado de base");
        }
        const [perfilId, metodoId] = params;
        const clave = `${perfilId}:${metodoId}`;
        if (estado.permisos.has(clave)) {
          return { rows: [], rowCount: 0 };
        }
        estado.permisos.add(clave);
        return {
          rows: [{ perfil_id: perfilId, metodo_id: metodoId }],
          rowCount: 1,
        };
      }

      if (texto === queries.deletePermisoMetodo) {
        const [perfilId, metodoId] = params;
        const clave = `${perfilId}:${metodoId}`;
        if (!estado.permisos.has(clave)) {
          return { rows: [], rowCount: 0 };
        }
        estado.permisos.delete(clave);
        return {
          rows: [{ perfil_id: perfilId, metodo_id: metodoId }],
          rowCount: 1,
        };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };
}

let estado;
let admin;

beforeEach(() => {
  estado = crearEstado();
  security.db = crearDbPermisos(estado);
  security.PermissionMethodMap = new Map();
  admin = new Admin(security.db, crearReq({}));
});

afterEach(() => {
  security.db = dbOriginal;
  security.PermissionMethodMap = mapaOriginal;
});

test("listarMetodos devuelve el catálogo activo con critico", async () => {
  const metodos = await admin.listarMetodos();

  assert.equal(metodos.length, 3);
  assert.deepEqual(
    metodos.map((m) => `${m.subsistema}/${m.clase}/${m.metodo}`),
    [
      "Payroll/Cargo/listarCargosTarifa",
      "Security/Admin/listarMetodos",
      "Security/User/listarPerfiles",
    ],
  );
  assert.deepEqual(metodos.find((m) => m.id === 1), {
    id: 1,
    subsistema: "Security",
    clase: "Admin",
    metodo: "listarMetodos",
    descripcion: "Lista los métodos",
    critico: true,
  });
  assert.equal(metodos.find((m) => m.id === 3).critico, false);
  assert.equal(
    metodos.some((m) => m.id === 4),
    false,
    "el método inactivo no aparece",
  );
});

test("listarPermisosMetodo marca asignado solo en los ids del perfil", async () => {
  estado.permisos.add("2:3");

  const { perfil, metodos } = await admin.listarPermisosMetodo(2);

  assert.deepEqual(perfil, {
    id: 2,
    nombre: "Administrador",
    descripcion: "Administra el sistema",
  });
  assert.deepEqual(
    metodos.filter((m) => m.asignado).map((m) => m.id),
    [3],
  );
  assert.equal(metodos.find((m) => m.id === 1).asignado, false);
});

test("asignarPermisoMetodo inserta la fila y actualiza el mapa", async () => {
  const resultado = await admin.asignarPermisoMetodo(2, 3);

  assert.equal(estado.permisos.has("2:3"), true);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CARGO), true);
  assert.deepEqual(resultado, {
    perfilId: 2,
    perfil: "Administrador",
    metodoId: 3,
    subsistema: "Payroll",
    clase: "Cargo",
    metodo: "listarCargosTarifa",
    asignado: true,
    yaEstaba: false,
  });
});

test("asignar un permiso existente responde yaEstaba sin duplicar", async () => {
  estado.permisos.add("2:3");

  const resultado = await admin.asignarPermisoMetodo(2, 3);

  assert.equal(resultado.yaEstaba, true);
  assert.equal(resultado.asignado, true);
  assert.equal(estado.permisos.size, 2);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CARGO), true);
});

test("quitarPermisoMetodo borra la fila y elimina la llave del mapa", async () => {
  estado.permisos.add("2:3");
  security.PermissionMethodMap.set(CLAVE_CARGO, true);

  const resultado = await admin.quitarPermisoMetodo(2, 3);

  assert.equal(estado.permisos.has("2:3"), false);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CARGO), false);
  assert.equal(resultado.asignado, false);
  assert.equal(resultado.yaNoEstaba, false);
});

test("quitar un permiso inexistente responde yaNoEstaba", async () => {
  const resultado = await admin.quitarPermisoMetodo(2, 3);

  assert.equal(resultado.yaNoEstaba, true);
  assert.equal(resultado.asignado, false);
  assert.equal(estado.permisos.size, 1);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CARGO), false);
});

test("quitar un crítico a Superusuario responde 409 sin tocar base ni mapa", async () => {
  security.PermissionMethodMap.set(CLAVE_CRITICO, true);

  await assert.rejects(
    () => admin.quitarPermisoMetodo(1, 1),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /crítico/.test(error.message),
  );

  assert.equal(estado.permisos.has("1:1"), true);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CRITICO), true);
});

test("quitar un crítico a otro perfil está permitido", async () => {
  estado.permisos.add("2:1");
  security.PermissionMethodMap.set(
    llaveMetodo("Security", "Admin", "listarMetodos", 2),
    true,
  );

  const resultado = await admin.quitarPermisoMetodo(2, 1);

  assert.equal(resultado.yaNoEstaba, false);
  assert.equal(estado.permisos.has("2:1"), false);
  assert.equal(
    security.PermissionMethodMap.has(
      llaveMetodo("Security", "Admin", "listarMetodos", 2),
    ),
    false,
  );
});

test("ids inválidos responden 400 antes de consultar la base", async () => {
  const invalidos = ["x", 0, -1, 1.5, null, undefined, "", " ", true];

  for (const valor of invalidos) {
    await assert.rejects(
      () => admin.listarPermisosMetodo(valor),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `listarPermisosMetodo(${String(valor)})`,
    );
    await assert.rejects(
      () => admin.asignarPermisoMetodo(valor, 3),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `asignarPermisoMetodo(${String(valor)}, 3)`,
    );
    await assert.rejects(
      () => admin.quitarPermisoMetodo(2, valor),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `quitarPermisoMetodo(2, ${String(valor)})`,
    );
  }

  assert.equal(estado.permisos.size, 1);
});

test("perfil inactivo o inexistente y método inactivo o inexistente responden 404", async () => {
  const casos = [
    () => admin.listarPermisosMetodo(3),
    () => admin.listarPermisosMetodo(99),
    () => admin.asignarPermisoMetodo(3, 3),
    () => admin.asignarPermisoMetodo(99, 3),
    () => admin.asignarPermisoMetodo(2, 4),
    () => admin.asignarPermisoMetodo(2, 99),
    () => admin.quitarPermisoMetodo(2, 4),
  ];

  for (const caso of casos) {
    await assert.rejects(
      caso,
      (error) => error instanceof ErrorNegocio && error.status === 404,
    );
  }

  assert.equal(estado.permisos.size, 1);
  assert.equal(security.PermissionMethodMap.size, 0);
});

test("si la base falla al insertar, el mapa no cambia", async () => {
  security.db = crearDbPermisos(estado, { fallarInsert: true });
  admin = new Admin(security.db, crearReq({}));

  await assert.rejects(
    () => admin.asignarPermisoMetodo(2, 3),
    /fallo simulado de base/,
  );

  assert.equal(estado.permisos.has("2:3"), false);
  assert.equal(security.PermissionMethodMap.has(CLAVE_CARGO), false);
});
