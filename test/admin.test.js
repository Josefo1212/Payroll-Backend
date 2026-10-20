import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import { Admin } from "../src/bo/Security/Admin.js";
import { crearReq, crearDbFalso } from "./helpers.js";

const dbOriginal = security.db;

// Deja el singleton apuntando a un Database falso con permisos conocidos.
function conDbFalso(opciones) {
  security.db = crearDbFalso(opciones);
  security.ClaseCache = new Map();
}

beforeEach(() => {
  security.db = dbOriginal;
});

test("reloadPermissions recarga y devuelve los conteos", async () => {
  conDbFalso({});
  // Simula el cambio en la BD: el fake responde a loadPermissionMethods.
  security.db.query = async (texto) => {
    if (texto.includes("permiso_metodo")) {
      return {
        rows: [
          { subsistema: "Security", clase: "Session", metodo: "login", perfil_id: 1 },
        ],
      };
    }
    if (texto.includes("permiso_opcion")) {
      return {
        rows: [
          { subsistema: "Security", opcion_id: 20, opcion: "Perfiles", orden: 1, descripcion: "x", perfil_id: 1 },
          { subsistema: "Security", opcion_id: 21, opcion: "Usuarios", orden: 2, descripcion: "y", perfil_id: 1 },
        ],
      };
    }
    return { rows: [] };
  };

  const admin = new Admin(security.db, crearReq({}));
  const resultado = await admin.reloadPermissions();

  assert.deepEqual(resultado, { metodos: 1, opciones: 2 });
  assert.equal(security.PermissionMethodMap.size, 1);
  assert.equal(security.PermissionOptionMap.size, 2);
});

test("reloadPermissions refleja el cambio en los mapas", async () => {
  conDbFalso({});
  security.PermissionMethodMap = new Map();
  security.db.query = async () => ({ rows: [] });

  const admin = new Admin(security.db, crearReq({}));
  await admin.reloadPermissions();
  assert.equal(security.PermissionMethodMap.size, 0);

  // Ahora la BD trae un permiso nuevo.
  security.db.query = async (texto) => {
    if (texto.includes("permiso_metodo")) {
      return {
        rows: [
          { subsistema: "Security", clase: "Admin", metodo: "reloadPermissions", perfil_id: 7 },
        ],
      };
    }
    return { rows: [] };
  };

  const resultado = await admin.reloadPermissions();

  assert.deepEqual(resultado, { metodos: 1, opciones: 0 });
  assert.equal(security.PermissionMethodMap.has("Security_Admin_reloadPermissions_7"), true);
});
