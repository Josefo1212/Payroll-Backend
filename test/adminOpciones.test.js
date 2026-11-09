import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import { Admin } from "../src/bo/Security/Admin.js";
import { queries } from "../src/bo/Security/loader.js";
import { llaveOpcion } from "../src/services/PermissionKeyService.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const dbOriginal = security.db;
const mapaMetodosOriginal = security.PermissionMethodMap;
const mapaOpcionesOriginal = security.PermissionOptionMap;

const IDS_BASE = [101, 102, 103, 104, 105, 106];

const SUBSISTEMAS = [
  { id: 1, nombre: "Security", activo: true },
  { id: 2, nombre: "Payroll", activo: true },
  { id: 3, nombre: "Viejo", activo: false },
];

const METODOS = [
  { id: 301, subsistema: "Security", clase: "Admin", metodo: "listarOpciones", activo: true },
  { id: 302, subsistema: "Security", clase: "Admin", metodo: "crearOpcion", activo: true },
];

function crearEstado() {
  return {
    perfiles: [
      { id: 1, nombre_perfil: "Superusuario", descripcion: "Acceso total", activo: true },
      { id: 3, nombre_perfil: "Empleado", descripcion: "Usuario final", activo: true },
      { id: 4, nombre_perfil: "Inactivo", descripcion: "Viejo", activo: false },
    ],
    opciones: [
      { id: 1, subsistema_id: 1, nombre: "Usuarios", descripcion: "Gestión de usuarios", orden: 2, activo: true },
      { id: 2, subsistema_id: 1, nombre: "Opciones", descripcion: "Opciones de menú", orden: 5, activo: true },
      { id: 3, subsistema_id: 2, nombre: "Periodos", descripcion: "Períodos", orden: 1, activo: true },
      { id: 4, subsistema_id: 2, nombre: "Vieja", descripcion: "Inactiva", orden: 9, activo: false },
    ],
    // El perfil 4 está inactivo: no debe contar en `perfiles`.
    permisosOpcion: new Map([
      [1, new Set([1, 2])],
      [3, new Set([3])],
      [4, new Set([4])],
    ]),
    permisosMetodo: new Map([
      [1, new Set(IDS_BASE)],
      [3, new Set([101, 102, 301])],
    ]),
  };
}

const subsistemaPorId = (estado, id) =>
  SUBSISTEMAS.find((s) => s.id === id);
const opcionPorId = (estado, id) => estado.opciones.find((o) => o.id === id);
const perfilPorId = (estado, id) =>
  estado.perfiles.find((p) => p.id === id);

const filaOpcion = (estado, opcion) => {
  const subsistema = subsistemaPorId(estado, opcion.subsistema_id);
  return {
    id: opcion.id,
    subsistema_id: opcion.subsistema_id,
    subsistema: subsistema.nombre,
    subsistema_activo: subsistema.activo,
    opcion: opcion.nombre,
    descripcion: opcion.descripcion,
    orden: opcion.orden,
    activo: opcion.activo,
  };
};

const opcionesVisibles = (estado) =>
  estado.opciones.filter(
    (o) =>
      o.activo && subsistemaPorId(estado, o.subsistema_id).activo,
  );

function crearDbOpciones(estado) {
  const db = {
    query: async (texto, params = []) => {
      if (texto === queries.findAllOptionsAdmin) {
        const rows = estado.opciones
          .filter((o) => subsistemaPorId(estado, o.subsistema_id).activo)
          .map((o) => {
            const activos = [...estado.permisosOpcion.entries()].filter(
              ([perfilId, ids]) => ids.has(o.id) && perfilPorId(estado, perfilId)?.activo,
            );
            return { ...filaOpcion(estado, o), perfiles: activos.length };
          })
          .sort(
            (a, b) =>
              Number(b.activo) - Number(a.activo) ||
              a.subsistema.localeCompare(b.subsistema) ||
              a.orden - b.orden ||
              a.opcion.localeCompare(b.opcion),
          );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findOpcionById) {
        const opcion = opcionPorId(estado, params[0]);
        return opcion
          ? { rows: [filaOpcion(estado, opcion)], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (texto === queries.findOpcionByNombreEnSubsistema) {
        const buscado = String(params[1]).toLowerCase();
        const rows = estado.opciones.filter(
          (o) =>
            o.subsistema_id === params[0] &&
            o.nombre.toLowerCase() === buscado,
        );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findOpcionByNombreEnSubsistemaExcepto) {
        const buscado = String(params[1]).toLowerCase();
        const rows = estado.opciones.filter(
          (o) =>
            o.subsistema_id === params[0] &&
            o.nombre.toLowerCase() === buscado &&
            o.id !== params[2],
        );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findSubsistemaById) {
        const subsistema = subsistemaPorId(estado, params[0]);
        return subsistema
          ? { rows: [subsistema], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (texto === queries.insertOpcion) {
        const id = Math.max(0, ...estado.opciones.map((o) => o.id)) + 1;
        const opcion = {
          id,
          subsistema_id: params[0],
          nombre: params[1],
          descripcion: params[2],
          orden: params[3],
          activo: true,
        };
        estado.opciones.push(opcion);
        return { rows: [{ ...opcion }], rowCount: 1 };
      }

      if (texto === queries.updateOpcion) {
        const opcion = opcionPorId(estado, params[3]);
        opcion.nombre = params[0];
        opcion.descripcion = params[1];
        opcion.orden = params[2];
        return { rows: [{ ...opcion }], rowCount: 1 };
      }

      if (texto === queries.updateOpcionActivo) {
        const opcion = opcionPorId(estado, params[1]);
        opcion.activo = params[0];
        return { rows: [{ ...opcion }], rowCount: 1 };
      }

      if (texto === queries.findAllActiveOptions) {
        const rows = opcionesVisibles(estado)
          .map((o) => filaOpcion(estado, o))
          .sort(
            (a, b) =>
              a.subsistema.localeCompare(b.subsistema) ||
              a.orden - b.orden ||
              a.opcion.localeCompare(b.opcion),
          );
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.findPermisosOpcionPorPerfil) {
        const ids = estado.permisosOpcion.get(params[0]) ?? new Set();
        const visibles = new Set(opcionesVisibles(estado).map((o) => o.id));
        const rows = [...ids]
          .filter((id) => visibles.has(id))
          .sort((a, b) => a - b)
          .map((opcion_id) => ({ opcion_id }));
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.insertPermisoOpcion) {
        const [perfilId, opcionId] = params;
        const ids = estado.permisosOpcion.get(perfilId) ?? new Set();
        const yaEstaba = ids.has(opcionId);
        ids.add(opcionId);
        estado.permisosOpcion.set(perfilId, ids);
        return { rows: [{ perfil_id: perfilId, opcion_id: opcionId }], rowCount: yaEstaba ? 0 : 1 };
      }

      if (texto === queries.deletePermisoOpcion) {
        const [perfilId, opcionId] = params;
        const ids = estado.permisosOpcion.get(perfilId) ?? new Set();
        const existia = ids.delete(opcionId);
        return { rows: [{ perfil_id: perfilId, opcion_id: opcionId }], rowCount: existia ? 1 : 0 };
      }

      if (texto === queries.findPerfilById) {
        const perfil = perfilPorId(estado, params[0]);
        return perfil
          ? { rows: [perfil], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (texto === queries.findPerfilByNombre) {
        const buscado = String(params[0]).toLowerCase();
        const rows = estado.perfiles.filter(
          (p) => p.nombre_perfil.toLowerCase() === buscado,
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

      if (texto === queries.insertPermisosBasePerfil) {
        const perfilId = params[0];
        const actuales = estado.permisosMetodo.get(perfilId) ?? new Set();
        const nuevos = IDS_BASE.filter((id) => !actuales.has(id));
        for (const id of nuevos) {
          actuales.add(id);
        }
        estado.permisosMetodo.set(perfilId, actuales);
        return {
          rows: nuevos.map((metodo_id) => ({ metodo_id })),
          rowCount: nuevos.length,
        };
      }

      if (texto === queries.insertPermisosDesdePlantillaMetodo) {
        const [perfilId, plantillaId] = params;
        const destino = estado.permisosMetodo.get(perfilId) ?? new Set();
        const origen = estado.permisosMetodo.get(plantillaId) ?? new Set();
        const nuevos = [...origen].filter((id) => !destino.has(id));
        for (const id of nuevos) {
          destino.add(id);
        }
        estado.permisosMetodo.set(perfilId, destino);
        return {
          rows: nuevos.map((metodo_id) => ({ metodo_id })),
          rowCount: nuevos.length,
        };
      }

      if (texto === queries.insertPermisosDesdePlantillaOpcion) {
        const [perfilId, plantillaId] = params;
        const destino = estado.permisosOpcion.get(perfilId) ?? new Set();
        const origen = estado.permisosOpcion.get(plantillaId) ?? new Set();
        const visibles = new Set(opcionesVisibles(estado).map((o) => o.id));
        const nuevos = [...origen].filter(
          (id) => visibles.has(id) && !destino.has(id),
        );
        for (const id of nuevos) {
          destino.add(id);
        }
        estado.permisosOpcion.set(perfilId, destino);
        return {
          rows: nuevos.map((opcion_id) => ({ opcion_id })),
          rowCount: nuevos.length,
        };
      }

      if (texto === queries.contarPermisosMetodoPerfil) {
        const total = (estado.permisosMetodo.get(params[0]) ?? new Set()).size;
        return { rows: [{ total }], rowCount: 1 };
      }

      if (texto === queries.contarPermisosOpcionPerfil) {
        const total = (estado.permisosOpcion.get(params[0]) ?? new Set()).size;
        return { rows: [{ total }], rowCount: 1 };
      }

      if (texto === queries.findMetodoById) {
        const metodo = METODOS.find((m) => m.id === params[0]);
        return metodo
          ? {
              rows: [
                {
                  ...metodo,
                  clase_activa: true,
                  subsistema_activo: true,
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }

      if (texto === queries.loadPermissionMethods) {
        const rows = [];
        for (const [perfilId, ids] of estado.permisosMetodo) {
          if (!perfilPorId(estado, perfilId)?.activo) {
            continue;
          }
          for (const id of ids) {
            const metodo = METODOS.find((m) => m.id === id);
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
        return { rows, rowCount: rows.length };
      }

      if (texto === queries.loadPermissionOptions) {
        const rows = [];
        for (const [perfilId, ids] of estado.permisosOpcion) {
          if (!perfilPorId(estado, perfilId)?.activo) {
            continue;
          }
          for (const opcion of opcionesVisibles(estado)) {
            if (ids.has(opcion.id)) {
              rows.push({
                subsistema: filaOpcion(estado, opcion).subsistema,
                opcion_id: opcion.id,
                opcion: opcion.nombre,
                orden: opcion.orden,
                descripcion: opcion.descripcion,
                perfil_id: perfilId,
              });
            }
          }
        }
        return { rows, rowCount: rows.length };
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
  security.db = crearDbOpciones(estado);
  security.PermissionMethodMap = new Map();
  security.PermissionOptionMap = new Map();
  admin = new Admin(security.db, crearReq({}));
});

afterEach(() => {
  security.db = dbOriginal;
  security.PermissionMethodMap = mapaMetodosOriginal;
  security.PermissionOptionMap = mapaOpcionesOriginal;
});

test("listarOpciones devuelve activas e inactivas con uso y protección", async () => {
  const opciones = await admin.listarOpciones();

  assert.deepEqual(
    opciones.map((o) => o.nombre),
    ["Periodos", "Usuarios", "Opciones", "Vieja"],
  );

  const usuarios = opciones.find((o) => o.nombre === "Usuarios");
  assert.deepEqual(usuarios, {
    id: 1,
    subsistema: "Security",
    nombre: "Usuarios",
    descripcion: "Gestión de usuarios",
    orden: 2,
    activo: true,
    protegida: true,
    perfiles: 1,
  });

  const periodos = opciones.find((o) => o.nombre === "Periodos");
  assert.equal(periodos.perfiles, 1);
  assert.equal(periodos.protegida, false);

  const vieja = opciones.find((o) => o.nombre === "Vieja");
  assert.equal(vieja.activo, false);
  assert.equal(vieja.perfiles, 0, "el perfil inactivo no cuenta");
});

test("crearOpcion inserta una opción nueva sin permisos", async () => {
  const resultado = await admin.crearOpcion(
    2,
    " Reportes ",
    " Reportes de nómina ",
    9,
  );

  assert.deepEqual(resultado, {
    id: 5,
    subsistema: "Payroll",
    nombre: "Reportes",
    descripcion: "Reportes de nómina",
    orden: 9,
    activo: true,
    protegida: false,
    perfiles: 0,
  });
  assert.ok(opcionPorId(estado, 5));
});

test("crearOpcion rechaza un nombre repetido en el mismo subsistema", async () => {
  await assert.rejects(
    () => admin.crearOpcion(2, "periodos", "", 1),
    (error) => error instanceof ErrorNegocio && error.status === 409,
  );

  assert.equal(
    estado.opciones.filter((o) => o.nombre.toLowerCase() === "periodos").length,
    1,
  );
});

test("crearOpcion permite el mismo nombre en otro subsistema", async () => {
  const resultado = await admin.crearOpcion(1, "Periodos", "", 9);
  assert.equal(resultado.nombre, "Periodos");
  assert.equal(resultado.subsistema, "Security");
});

test("crearOpcion valida el borde antes de tocar la base", async () => {
  const casos = [
    [1, "a", "", 1],
    [1, "1abc", "", 1],
    [1, "Con Espacio", "", 1],
    [1, "Con_Guion", "", 1],
    [1, "Valido", "x".repeat(201), 1],
    [1, "Valido", "", -1],
    [1, "Valido", "", 40000],
    [1, "Valido", "", "x"],
    [1, "Valido", "", null],
    [0, "Valido", "", 1],
    ["x", "Valido", "", 1],
    [1.5, "Valido", "", 1],
    [1, null, "", 1],
    [1, "Valido", 42, 1],
  ];

  for (const params of casos) {
    await assert.rejects(
      () => admin.crearOpcion(...params),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `crearOpcion(${JSON.stringify(params).slice(0, 60)})`,
    );
  }
});

test("crearOpcion responde 404 si el subsistema no existe o está inactivo", async () => {
  for (const subsistemaId of [99, 3]) {
    await assert.rejects(
      () => admin.crearOpcion(subsistemaId, "Valido", "", 1),
      (error) => error instanceof ErrorNegocio && error.status === 404,
    );
  }
});

test("editarOpcion actualiza nombre, descripción y orden", async () => {
  const resultado = await admin.editarOpcion(3, "PeriodoNuevo", "Nuevo", 4);

  assert.deepEqual(resultado, {
    id: 3,
    subsistema: "Payroll",
    nombre: "PeriodoNuevo",
    descripcion: "Nuevo",
    orden: 4,
    activo: true,
    protegida: false,
  });
  assert.equal(opcionPorId(estado, 3).nombre, "PeriodoNuevo");
});

test("editarOpcion no permite renombrar una opción protegida", async () => {
  await assert.rejects(
    () => admin.editarOpcion(2, "OtraOpcion", "Opciones de menú", 5),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /no se puede renombrar/.test(error.message),
  );

  assert.equal(opcionPorId(estado, 2).nombre, "Opciones");
});

test("editarOpcion sí permite cambiar descripción y orden de una protegida", async () => {
  const resultado = await admin.editarOpcion(2, "Opciones", "Nueva", 6);

  assert.equal(resultado.descripcion, "Nueva");
  assert.equal(resultado.orden, 6);
  assert.equal(resultado.protegida, true);
});

test("editarOpcion rechaza un nombre que ya usa otra opción del subsistema", async () => {
  await assert.rejects(
    () => admin.editarOpcion(1, "opciones", "Choque", 2),
    (error) => error instanceof ErrorNegocio && error.status === 409,
  );

  assert.equal(opcionPorId(estado, 1).nombre, "Usuarios");
});

test("editarOpcion responde 404 si la opción no existe", async () => {
  await assert.rejects(
    () => admin.editarOpcion(99, "Valido", "", 1),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
});

test("editarOpcion recarga el mapa con el nombre nuevo", async () => {
  await security.loadPermission();
  const vieja = llaveOpcion("Payroll", "Periodos", 3);
  assert.equal(security.PermissionOptionMap.has(vieja), true);

  await admin.editarOpcion(3, "PeriodoNuevo", "Nuevo", 1);

  const nueva = llaveOpcion("Payroll", "PeriodoNuevo", 3);
  assert.equal(security.PermissionOptionMap.has(vieja), false);
  assert.equal(security.PermissionOptionMap.has(nueva), true);
});

test("cambiarEstadoOpcion es idempotente cuando ya está en ese estado", async () => {
  const resultado = await admin.cambiarEstadoOpcion(1, true);

  assert.equal(resultado.cambio, false);
  assert.equal(resultado.activo, true);
});

test("cambiarEstadoOpcion no permite desactivar una opción protegida", async () => {
  await assert.rejects(
    () => admin.cambiarEstadoOpcion(2, false),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /no se puede desactivar/.test(error.message),
  );

  assert.equal(opcionPorId(estado, 2).activo, true);
});

test("cambiarEstadoOpcion desactiva y reactiva refrescando el mapa", async () => {
  await security.loadPermission();
  const llave = llaveOpcion("Payroll", "Periodos", 3);
  assert.equal(security.PermissionOptionMap.has(llave), true);

  const apagada = await admin.cambiarEstadoOpcion(3, false);
  assert.equal(apagada.activo, false);
  assert.equal(apagada.cambio, true);
  assert.equal(security.PermissionOptionMap.has(llave), false);

  const encendida = await admin.cambiarEstadoOpcion(3, true);
  assert.equal(encendida.activo, true);
  assert.equal(encendida.cambio, true);
  assert.equal(security.PermissionOptionMap.has(llave), true);
});

test("cambiarEstadoOpcion exige un booleano", async () => {
  for (const valor of ["true", 1, 0, null, undefined]) {
    await assert.rejects(
      () => admin.cambiarEstadoOpcion(3, valor),
      (error) => error instanceof ErrorNegocio && error.status === 400,
      `activo ${String(valor)}`,
    );
  }
});

test("listarPermisosOpcion devuelve el catálogo con asignado y protegida", async () => {
  const resultado = await admin.listarPermisosOpcion(3);

  assert.deepEqual(resultado.perfil, {
    id: 3,
    nombre: "Empleado",
    descripcion: "Usuario final",
  });
  assert.deepEqual(
    resultado.opciones.map((o) => [o.nombre, o.asignado, o.protegida]),
    [
      ["Periodos", true, false],
      ["Usuarios", false, true],
      ["Opciones", false, true],
    ],
  );

  estado.permisosOpcion.set(3, new Set([1, 3]));
  const conAsignados = await admin.listarPermisosOpcion(3);
  assert.deepEqual(
    conAsignados.opciones.filter((o) => o.asignado).map((o) => o.nombre),
    ["Periodos", "Usuarios"],
  );
});

test("listarPermisosOpcion responde 404 si el perfil no existe o está inactivo", async () => {
  for (const perfilId of [99, 4]) {
    await assert.rejects(
      () => admin.listarPermisosOpcion(perfilId),
      (error) => error instanceof ErrorNegocio && error.status === 404,
    );
  }
});

test("asignarPermisoOpcion inserta la fila y actualiza el mapa", async () => {
  const resultado = await admin.asignarPermisoOpcion(3, 1);

  assert.deepEqual(resultado, {
    perfilId: 3,
    perfil: "Empleado",
    opcionId: 1,
    subsistema: "Security",
    opcion: "Usuarios",
    asignado: true,
    yaEstaba: false,
  });
  assert.deepEqual(
    security.PermissionOptionMap.get(llaveOpcion("Security", "Usuarios", 3)),
    {
      id: 1,
      nombre: "Usuarios",
      orden: 2,
      descripcion: "Gestión de usuarios",
      subsistema: "Security",
      perfilId: 3,
    },
  );
});

test("asignarPermisoOpcion es idempotente", async () => {
  const primero = await admin.asignarPermisoOpcion(3, 1);
  const repetido = await admin.asignarPermisoOpcion(3, 1);

  assert.equal(primero.yaEstaba, false);
  assert.equal(repetido.yaEstaba, true);
  assert.equal(estado.permisosOpcion.get(3).size, 2);
});

test("asignarPermisoOpcion responde 404 si la opción no existe o está inactiva", async () => {
  for (const opcionId of [99, 4]) {
    await assert.rejects(
      () => admin.asignarPermisoOpcion(3, opcionId),
      (error) => error instanceof ErrorNegocio && error.status === 404,
    );
  }
});

test("asignar y quitar validan los ids", async () => {
  for (const [perfilId, opcionId] of [
    [0, 3],
    [3, 0],
    ["x", 3],
    [3, "x"],
    [1.5, 3],
    [3, 1.5],
  ]) {
    await assert.rejects(
      () => admin.asignarPermisoOpcion(perfilId, opcionId),
      (error) => error instanceof ErrorNegocio && error.status === 400,
    );
    await assert.rejects(
      () => admin.quitarPermisoOpcion(perfilId, opcionId),
      (error) => error instanceof ErrorNegocio && error.status === 400,
    );
  }
});

test("quitarPermisoOpcion borra la fila y la llave del mapa", async () => {
  estado.permisosOpcion.set(3, new Set([3]));
  await security.loadPermission();
  const llave = llaveOpcion("Payroll", "Periodos", 3);
  assert.equal(security.PermissionOptionMap.has(llave), true);

  const resultado = await admin.quitarPermisoOpcion(3, 3);

  assert.deepEqual(resultado, {
    perfilId: 3,
    perfil: "Empleado",
    opcionId: 3,
    subsistema: "Payroll",
    opcion: "Periodos",
    asignado: false,
    yaNoEstaba: false,
  });
  assert.equal(security.PermissionOptionMap.has(llave), false);
  assert.equal(estado.permisosOpcion.get(3).has(3), false);
});

test("quitarPermisoOpcion es idempotente", async () => {
  await admin.quitarPermisoOpcion(3, 3);
  const repetido = await admin.quitarPermisoOpcion(3, 3);

  assert.equal(repetido.yaNoEstaba, true);
});

test("quitarPermisoOpcion protege las opciones críticas de Superusuario", async () => {
  await assert.rejects(
    () => admin.quitarPermisoOpcion(1, 2),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 409 &&
      /es crítica/.test(error.message),
  );

  assert.equal(estado.permisosOpcion.get(1).has(2), true);
});

test("quitarPermisoOpcion permite quitar una protegida a otro perfil", async () => {
  estado.permisosOpcion.set(3, new Set([1]));
  const resultado = await admin.quitarPermisoOpcion(3, 1);

  assert.equal(resultado.asignado, false);
  assert.equal(estado.permisosOpcion.get(3).has(1), false);
});

test("los métodos nuevos son críticos para Superusuario", async () => {
  for (const metodoId of [301, 302]) {
    await assert.rejects(
      () => admin.quitarPermisoMetodo(1, metodoId),
      (error) =>
        error instanceof ErrorNegocio &&
        error.status === 409 &&
        /es crítico/.test(error.message),
      `metodo ${metodoId}`,
    );
  }
});

test("crearPerfil clona métodos y opciones de la plantilla", async () => {
  const resultado = await admin.crearPerfil("Clon", "", 3);

  assert.equal(resultado.nombre, "Clon");
  assert.equal(resultado.permisosBase, 6);
  // Plantilla: base 101/102 + 301; el nuevo suma los 6 base y el 301 → 7.
  assert.equal(resultado.permisosMetodo, 7);
  assert.equal(resultado.permisosOpcion, 1);

  const creado = estado.perfiles.find((p) => p.nombre_perfil === "Clon");
  assert.deepEqual(
    [...estado.permisosOpcion.get(creado.id)],
    [3],
  );
  assert.equal(
    security.PermissionOptionMap.has(
      llaveOpcion("Payroll", "Periodos", creado.id),
    ),
    true,
  );
});

test("crearPerfil sin plantilla conserva el contrato de la spec 010", async () => {
  const resultado = await admin.crearPerfil("Simple", "Sin plantilla");

  assert.equal(resultado.permisosBase, 6);
  assert.equal("permisosMetodo" in resultado, false);
  assert.equal("permisosOpcion" in resultado, false);
});

test("crearPerfil valida la plantilla", async () => {
  for (const plantillaId of [99, 4]) {
    await assert.rejects(
      () => admin.crearPerfil("Clon", "", plantillaId),
      (error) => error instanceof ErrorNegocio && error.status === 404,
      `plantilla ${plantillaId}`,
    );
  }

  await assert.rejects(
    () => admin.crearPerfil("Clon", "", "x"),
    (error) => error instanceof ErrorNegocio && error.status === 400,
  );

  const conNull = await admin.crearPerfil("ClonNull", "", null);
  assert.equal(conNull.permisosBase, 6);
  assert.equal("permisosOpcion" in conNull, false);
});
