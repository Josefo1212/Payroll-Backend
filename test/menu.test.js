import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import { Menu } from "../bo/Seguridad/Menu.js";
import { crearReq, peticion } from "./helpers.js";

// Opciones de prueba: 'Perfiles' (perfil 1) y 'Usuarios' (perfil 2) se
// solapan en la opción id 1; el resto son exclusivas y con distinto `orden`.
const OPCIONES = [
  { subsistema: "Nomina", opcion_id: 10, opcion: "Periodos", orden: 2, descripcion: "Periodos", perfil_id: 1 },
  { subsistema: "Nomina", opcion_id: 11, opcion: "Recibos", orden: 1, descripcion: "Recibos", perfil_id: 2 },
  { subsistema: "Seguridad", opcion_id: 20, opcion: "Perfiles", orden: 1, descripcion: "Perfiles", perfil_id: 1 },
  { subsistema: "Seguridad", opcion_id: 20, opcion: "Perfiles", orden: 1, descripcion: "Perfiles", perfil_id: 2 },
  { subsistema: "Seguridad", opcion_id: 21, opcion: "Usuarios", orden: 2, descripcion: "Usuarios", perfil_id: 1 },
];

// Reescribe el mapa de opciones del singleton de seguridad (el mismo que usan
// los BO vía import).
function sembrarOpciones() {
  security.PermissionOptionMap = new Map();
  for (const fila of OPCIONES) {
    security.PermissionOptionMap.set(
      `${fila.subsistema}_${fila.opcion}_${fila.perfil_id}`,
      {
        id: fila.opcion_id,
        nombre: fila.opcion,
        orden: fila.orden,
        descripcion: fila.descripcion,
        subsistema: fila.subsistema,
        perfilId: fila.perfil_id,
      },
    );
  }
}

beforeEach(() => sembrarOpciones());

async function crearMenu(sesionInicial = {}) {
  const { req } = await peticion(sesionInicial);
  return new Menu(null, req);
}

test("getOptions devuelve las opciones de los perfiles, sin duplicados", async () => {
  const menu = await crearMenu({ profiles: [1, 2] });

  const opciones = menu.getOptions();

  assert.deepEqual(
    opciones.map((o) => o.id),
    [11, 10, 20, 21],
    "Perfiles (compartida) aparece una sola vez",
  );
  assert.deepEqual(opciones[2], {
    id: 20,
    nombre: "Perfiles",
    descripcion: "Perfiles",
    subsistema: "Seguridad",
  });
});

test("getOptions ordena por subsistema y luego por orden", async () => {
  const menu = await crearMenu({ profiles: [1, 2] });

  const opciones = menu.getOptions();
  const claves = opciones.map((o) => `${o.subsistema}/${o.id}`);

  assert.deepEqual(claves, [
    "Nomina/11",
    "Nomina/10",
    "Seguridad/20",
    "Seguridad/21",
  ]);
});
test("getOptions sin sesión devuelve []", async () => {
  const menu = await crearMenu();

  assert.deepEqual(menu.getOptions(), []);
});

test("getOptions con un solo perfil no incluye lo de otros", async () => {
  const menu = await crearMenu({ profiles: [1] });

  const opciones = menu.getOptions();

  assert.deepEqual(
    opciones.map((o) => o.id),
    [10, 20, 21],
    "la opción 11 es solo del perfil 2",
  );
});
