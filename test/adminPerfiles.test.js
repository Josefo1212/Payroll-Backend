import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import { Admin } from "../src/bo/Security/Admin.js";
import { User } from "../src/bo/Security/User.js";
import { queries } from "../src/bo/Security/loader.js";
import { llaveMetodo } from "../src/services/PermissionKeyService.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const dbOriginal = security.db;
const mapaOriginal = security.PermissionMethodMap;
const opcionesOriginal = security.PermissionOptionMap;

const UUID_ADMIN = "11111111-1111-4111-8111-111111111111";
const UUID_OTRO = "22222222-2222-4222-8222-222222222222";
const UUID_SOLO = "33333333-3333-4333-8333-333333333333";

// Catálogo mínimo de métodos: los seis de la base de sesión más uno de
// administración para comprobar que el mapa se arma desde la BD.
const METODOS = [
  { id: 101, subsistema: "Session", clase: "Session", metodo: "logout", base: true },
  { id: 102, subsistema: "Session", clase: "Session", metodo: "getSession", base: true },
  { id: 103, subsistema: "Session", clase: "Session", metodo: "sessionExist", base: true },
  { id: 104, subsistema: "Session", clase: "Token", metodo: "refresh", base: true },
  { id: 105, subsistema: "Security", clase: "Menu", metodo: "getOptions", base: true },
  { id: 106, subsistema: "Security", clase: "User", metodo: "cambiarClave", base: true },
  { id: 201, subsistema: "Security", clase: "Admin", metodo: "crearPerfil" },
];

const idsBase = METODOS.filter((m) => m.base).map((m) => m.id);

function crearEstado() {
  return {
    perfiles: [
      { id: 1, nombre_perfil: "Superusuario", descripcion: "Acceso total", activo: true },
      { id: 2, nombre_perfil: "Administrador", descripcion: "Administra", activo: true },
      { id: 3, nombre_perfil: "Empleado", descripcion: "Usuario final", activo: true },
      { id: 4, nombre_perfil: "Viejo", descripcion: "Inactivo", activo: false },
    ],
    permisos: new Map(),
    usuarios: [
      { id: UUID_ADMIN, username: "admin", activo: true },
      { id: UUID_OTRO, username: "otro", activo: true },
      { id: UUID_SOLO, username: "solo", activo: true },
    ],
    usuarioPerfil: new Map([
      [UUID_ADMIN, new Set([1, 3])],
      [UUID_OTRO, new Set([2])],
      [UUID_SOLO, new Set([1])],
    ]),
  };
}

const perfilPorId = (estado, id) => estado.perfiles.find((p) => p.id === id);

function crearDbPerfiles(estado) {
  const db = {
    query: async (texto, params = []) => {
      if (texto === queries.findAllProfilesAdmin) {
        const rows = estado.perfiles
          .map((perfil) => {
            const asignados = [...estado.usuarioPerfil.entries()].filter(
              ([usuarioId, ids]) =>
                ids.has(perfil.id) &&
                estado.usuarios.some((u) => u.id === usuarioId),
            );
            const activos = asignados.filter(
              ([usuarioId]) =>
                estado.usuarios.find((u) => u.id === usuarioId)?.activo,
            );
            return {
              ...perfil,
              usuarios: asignados.length,
              usuarios_activos: activos.length,
            };
          })
          .sort(
            (a, b) =>
              Number(b.activo) - Number(a.activo) ||
              a.nombre_perfil.localeCompare(b.nombre_perfil),
          );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findPerfilById) {
        const perfil = perfilPorId(estado, params[0]);
        return { rows: perfil ? [perfil] : [], rowCount: perfil ? 1 : 0 };
      }

      if (texto === queries.findPerfilByNombre) {
        const buscado = String(params[0]).toLowerCase();
        const rows = estado.perfiles.filter(
          (p) => p.nombre_perfil.toLowerCase() === buscado,
        );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findPerfilByNombreExcepto) {
        const buscado = String(params[0]).toLowerCase();
        const rows = estado.perfiles.filter(
          (p) => p.nombre_perfil.toLowerCase() === buscado && p.id !== params[1],
        );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.insertPerfil) {
        const id = Math.max(0, ...estado.perfiles.map((p) => p.id)) + 1;
        const fila = {
          id,
          nombre_perfil: params[0],
          descripcion: params[1],
          activo: true,
        };
        estado.perfiles.push(fila);
        return { rows: [fila], rowCount: 1 };
      }

      if (texto === queries.updatePerfil) {
        const fila = perfilPorId(estado, params[2]);
        fila.nombre_perfil = params[0];
        fila.descripcion = params[1];
        return { rows: [fila], rowCount: 1 };
      }

      if (texto === queries.updatePerfilActivo) {
        const fila = perfilPorId(estado, params[1]);
        fila.activo = params[0];
        return { rows: [fila], rowCount: 1 };
      }

      if (texto === queries.insertPermisosBasePerfil) {
        const perfilId = params[0];
        const actuales = estado.permisos.get(perfilId) ?? new Set();
        for (const id of idsBase) {
          actuales.add(id);
        }
        estado.permisos.set(perfilId, actuales);
        return {
          rows: idsBase.map((metodo_id) => ({ metodo_id })),
          rowCount: idsBase.length,
        };
      }

      if (texto === queries.loadPermissionMethods) {
        const rows = [];
        for (const [perfilId, ids] of estado.permisos) {
          if (!perfilPorId(estado, perfilId)?.activo) {
            continue;
          }
          for (const metodoId of ids) {
            const metodo = METODOS.find((m) => m.id === metodoId);
            if (metodo) {
              rows.push({
                subsistema: metodo.subsistema,
                clase: metodo.clase,
                metodo: metodo.metodo,
                perfil_id: perfilId,
              });
            }
          }
        }
        return { rows };
      }

      if (texto === queries.loadPermissionOptions) {
        return { rows: [] };
      }

      if (texto === queries.findActiveProfilesByIds) {
        const rows = params[0]
          .map((id) => perfilPorId(estado, id))
          .filter((p) => p?.activo)
          .map((p) => ({ id: p.id, nombre_perfil: p.nombre_perfil }))
          .sort((a, b) => a.id - b.id);
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findUsuarioById) {
        const usuario = estado.usuarios.find((u) => u.id === params[0]);
        return { rows: usuario ? [usuario] : [], rowCount: usuario ? 1 : 0 };
      }

      if (texto === queries.findPerfilesDeUsuario) {
        const ids = estado.usuarioPerfil.get(params[0]) ?? new Set();
        const rows = [...ids]
          .sort((a, b) => a - b)
          .map((id) => {
            const perfil = perfilPorId(estado, id);
            return {
              perfil_id: id,
              nombre_perfil: perfil.nombre_perfil,
              activo: perfil.activo,
            };
          });
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.deleteUsuarioPerfilTodos) {
        const ids = estado.usuarioPerfil.get(params[0]) ?? new Set();
        const rows = [...ids].map((perfil_id) => ({ perfil_id }));
        estado.usuarioPerfil.set(params[0], new Set());
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.insertUsuarioPerfil) {
        estado.usuarioPerfil.set(params[0], new Set(params[1]));
        return { rows: [], rowCount: params[1].length };
      }

      if (texto === queries.contarOtrosSuperusuariosActivos) {
        const superusuario = estado.perfiles.find(
          (p) => p.nombre_perfil === "Superusuario",
        );
        const total = estado.usuarios.filter(
          (u) =>
            u.activo &&
            u.id !== params[0] &&
            superusuario.activo &&
            estado.usuarioPerfil.get(u.id)?.has(superusuario.id),
        ).length;
        return { rows: [{ total }], rowCount: 1 };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  db.transaction = async (fn) => fn(db);
  return db;
}

let estado;
let admin;

beforeEach(() => {
  estado = crearEstado();
  security.db = crearDbPerfiles(estado);
  security.PermissionMethodMap = new Map();
  security.PermissionOptionMap = new Map();
  admin = new Admin(security.db, crearReq({}));
});

afterEach(() => {
  security.db = dbOriginal;
  security.PermissionMethodMap = mapaOriginal;
  security.PermissionOptionMap = opcionesOriginal;
});

test("listarPerfilesAdmin devuelve activos e inactivos con uso", async () => {
  const perfiles = await admin.listarPerfilesAdmin();

  assert.deepEqual(
    perfiles.map((p) => p.nombre),
    ["Administrador", "Empleado", "Superusuario", "Viejo"],
  );

  const superusuario = perfiles.find((p) => p.nombre === "Superusuario");
  assert.deepEqual(superusuario, {
    id: 1,
    nombre: "Superusuario",
    descripcion: "Acceso total",
    activo: true,
    usuarios: 2,
    usuariosActivos: 2,
    protegido: true,
  });

  const viejo = perfiles.find((p) => p.nombre === "Viejo");
  assert.equal(viejo.activo, false);
  assert.equal(viejo.protegido, false);
});

test("crearPerfil inserta el perfil y sus seis permisos base", async () => {
  const resultado = await admin.crearPerfil("Contador", " Nómina y reportes ");

  assert.equal(resultado.nombre, "Contador");
  assert.equal(resultado.descripcion, "Nómina y reportes");
  assert.equal(resultado.activo, true);
  assert.equal(resultado.protegido, false);
  assert.equal(resultado.permisosBase, 6);

  const creado = estado.perfiles.find((p) => p.nombre_perfil === "Contador");
  assert.ok(creado);
  assert.deepEqual(
    [...estado.permisos.get(creado.id)].sort((a, b) => a - b),
    idsBase,
  );
  assert.equal(
    security.PermissionMethodMap.has(
      llaveMetodo("Session", "Session", "logout", creado.id),
    ),
    true,
  );
});

test("crearPerfil rechaza un nombre repetido sin distinguir mayúsculas", async () => {
  await assert.rejects(
    () => admin.crearPerfil("empleado", "Duplicado"),
    (error) => error instanceof ErrorNegocio && error.status === 409,
  );

  assert.equal(
    estado.perfiles.filter((p) => p.nombre_perfil.toLowerCase() === "empleado")
      .length,
    1,
  );
});

test("crearPerfil valida nombre y descripción antes de tocar la base", async () => {
  const casos = [
    ["ab", ""],
    ["1abc", ""],
    ["Con Espacio", ""],
    ["Guion-Bajo", ""],
    ["Valido", "x".repeat(201)],
    [null, ""],
    ["Valido", 42],
  ];

  for (const [nombre, descripcion] of casos) {
    await assert.rejects(
      () => admin.crearPerfil(nombre, descripcion),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `crearPerfil(${String(nombre)}, ${String(descripcion).slice(0, 10)})`,
    );
  }
});

test("editarPerfil actualiza nombre y descripción", async () => {
  const resultado = await admin.editarPerfil(3, "EmpleadoNuevo", "Nueva área");

  assert.deepEqual(resultado, {
    id: 3,
    nombre: "EmpleadoNuevo",
    descripcion: "Nueva área",
    activo: true,
    protegido: false,
  });
  assert.equal(perfilPorId(estado, 3).descripcion, "Nueva área");
});

test("editarPerfil no permite renombrar Superusuario", async () => {
  await assert.rejects(
    () => admin.editarPerfil(1, "Super", "Acceso total"),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /no se puede renombrar/.test(error.message),
  );

  assert.equal(perfilPorId(estado, 1).nombre_perfil, "Superusuario");
});

test("editarPerfil sí permite cambiar la descripción de Superusuario", async () => {
  const resultado = await admin.editarPerfil(
    1,
    "Superusuario",
    "Acceso total actualizado",
  );

  assert.equal(resultado.descripcion, "Acceso total actualizado");
  assert.equal(resultado.protegido, true);
});

test("editarPerfil rechaza un nombre que ya usa otro perfil", async () => {
  await assert.rejects(
    () => admin.editarPerfil(3, "administrador", "Choque"),
    (error) => error instanceof ErrorNegocio && error.status === 409,
  );

  assert.equal(perfilPorId(estado, 3).nombre_perfil, "Empleado");
});

test("editarPerfil y cambiarEstadoPerfil responden 404 si el perfil no existe", async () => {
  await assert.rejects(
    () => admin.editarPerfil(99, "Nuevo", ""),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
  await assert.rejects(
    () => admin.cambiarEstadoPerfil(99, false),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
});

test("cambiarEstadoPerfil es idempotente cuando ya está en ese estado", async () => {
  const resultado = await admin.cambiarEstadoPerfil(3, true);

  assert.equal(resultado.cambio, false);
  assert.equal(resultado.activo, true);
});

test("cambiarEstadoPerfil no permite desactivar Superusuario", async () => {
  await assert.rejects(
    () => admin.cambiarEstadoPerfil(1, false),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /no se puede desactivar/.test(error.message),
  );

  assert.equal(perfilPorId(estado, 1).activo, true);
});

test("cambiarEstadoPerfil desactiva y reactiva refrescando el mapa", async () => {
  estado.permisos.set(3, new Set([101, 106]));
  await security.loadPermission();
  const llave = llaveMetodo("Session", "Session", "logout", 3);
  assert.equal(security.PermissionMethodMap.has(llave), true);

  const apagado = await admin.cambiarEstadoPerfil(3, false);
  assert.equal(apagado.activo, false);
  assert.equal(apagado.cambio, true);
  assert.equal(security.PermissionMethodMap.has(llave), false);

  const encendido = await admin.cambiarEstadoPerfil(3, true);
  assert.equal(encendido.activo, true);
  assert.equal(encendido.cambio, true);
  assert.equal(security.PermissionMethodMap.has(llave), true);
});

test("cambiarEstadoPerfil exige un booleano", async () => {
  for (const valor of ["true", 1, 0, null, undefined]) {
    await assert.rejects(
      () => admin.cambiarEstadoPerfil(3, valor),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `activo ${String(valor)}`,
    );
  }
});

test("establecerPerfilesUsuario reemplaza el conjunto en una transacción", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [1] }));

  const resultado = await usuario.establecerPerfilesUsuario(UUID_OTRO, [2, 3, 2]);

  assert.deepEqual(resultado, {
    usuarioId: UUID_OTRO,
    username: "otro",
    perfiles: [
      { id: 2, nombre: "Administrador" },
      { id: 3, nombre: "Empleado" },
    ],
  });
  assert.deepEqual(
    [...estado.usuarioPerfil.get(UUID_OTRO)].sort((a, b) => a - b),
    [2, 3],
  );
});

test("establecerPerfilesUsuario valida UUID y arreglo de perfiles", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [1] }));

  await assert.rejects(
    () => usuario.establecerPerfilesUsuario("no-es-uuid", [1]),
    (error) => error instanceof ErrorNegocio && error.status === 400,
  );

  for (const perfiles of [[], [0], ["2"], [1.5], [99], [4], "x", null]) {
    await assert.rejects(
      () => usuario.establecerPerfilesUsuario(UUID_OTRO, perfiles),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `perfiles ${JSON.stringify(perfiles)}`,
    );
  }
});

test("establecerPerfilesUsuario responde 404 si el usuario no existe", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [1] }));
  const inexistente = "99999999-9999-4999-8999-999999999999";

  await assert.rejects(
    () => usuario.establecerPerfilesUsuario(inexistente, [1]),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
});

test("establecerPerfilesUsuario impide a un no Superusuario asignar privilegiados", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [3] }));

  await assert.rejects(
    () => usuario.establecerPerfilesUsuario(UUID_OTRO, [1]),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 403 &&
      /Solo Superusuario/.test(error.message),
  );

  assert.deepEqual([...estado.usuarioPerfil.get(UUID_OTRO)], [2]);
});

test("listarPerfilesUsuario devuelve el conjunto actual con su estado", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [1] }));

  const resultado = await usuario.listarPerfilesUsuario(UUID_ADMIN);

  assert.deepEqual(resultado, {
    usuarioId: UUID_ADMIN,
    username: "admin",
    activo: true,
    perfiles: [
      { id: 1, nombre: "Superusuario", activo: true },
      { id: 3, nombre: "Empleado", activo: true },
    ],
  });
});

test("listarPerfilesUsuario valida el UUID y el usuario existente", async () => {
  const usuario = new User(security.db, crearReq({ profiles: [1] }));

  await assert.rejects(
    () => usuario.listarPerfilesUsuario("no-es-uuid"),
    (error) => error instanceof ErrorNegocio && error.status === 400,
  );

  await assert.rejects(
    () => usuario.listarPerfilesUsuario("99999999-9999-4999-8999-999999999999"),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
});

test("establecerPerfilesUsuario no deja el sistema sin superusuarios", async () => {
  // u3 queda como el único superusuario activo: u1 deja de tenerlo.
  estado.usuarioPerfil.set(UUID_ADMIN, new Set([3]));
  const usuario = new User(security.db, crearReq({ profiles: [1] }));

  await assert.rejects(
    () => usuario.establecerPerfilesUsuario(UUID_SOLO, [3]),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /sin usuarios activos con perfil Superusuario/.test(error.message),
  );

  assert.deepEqual([...estado.usuarioPerfil.get(UUID_SOLO)], [1]);
});
