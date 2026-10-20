import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crearDbFalso,
  crearReq,
  crearRes,
  Security,
  queries,
} from "./helpers.js";

// Carga los mapas de permisos con permiso para login (perfil 1) y logout
// (perfil 2), y un perfil público con id 5 autorizado a login.
async function crearSecurity({ publicoId = null } = {}) {
  const dbFalso = crearDbFalso({ publicoId });
  const seguridad = new Security(dbFalso);
  await seguridad.loadPermission();

  seguridad.setPermissionMethod("Seguridad", "Sesion", "login", 1);
  seguridad.setPermissionMethod("Seguridad", "Sesion", "logout", 2);
  seguridad.setPermissionMethod("Seguridad", "Sesion", "constructor", 3);
  seguridad.setPermissionMethod("Seguridad", "Sesion", "toString", 3);
  if (publicoId != null) {
    seguridad.setPermissionMethod("Seguridad", "Sesion", "login", publicoId);
  }
  return { seguridad, dbFalso };
}

const peticion = (jsonData) => jsonData;

test("login público se autoriza con el perfil Publico", async () => {
  const { seguridad } = await crearSecurity({ publicoId: 5 });
  const req = crearReq({});

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Seguridad", class: "Sesion", method: "login", params: [] }),
    req,
  );

  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
});

test("método protegido sin sesión: 401", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({});

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Seguridad", class: "Sesion", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 401);
});

test("método protegido con sesión sin permiso: 403", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ userID: 10, profiles: [9] });

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Seguridad", class: "Sesion", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 403);
});

test("ruta con ../ se rechaza con 400", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ userID: 10, profiles: [1] });

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "../", class: "Sesion", method: "login", params: [] }),
    req,
  );

  assert.equal(status, 400);
});

test('"constructor" y "toString" responden 501', async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ userID: 10, profiles: [1, 3] });

  for (const method of ["constructor", "toString"]) {
    const { status } = await seguridad.executeMethod(
      peticion({ subsystem: "Seguridad", class: "Sesion", method, params: [] }),
      req,
    );
    assert.equal(status, 501, `método ${method}`);
  }
});

test("ErrorNegocio se traduce a su status", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ profiles: [1] });

  // login con credenciales vacías lanza ErrorNegocio 400.
  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Seguridad", class: "Sesion", method: "login", params: ["", ""] }),
    req,
  );

  assert.equal(status, 400);
});

test("logout a través del endpoint limpia la cookie", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ userID: 10, userName: "Admin", profiles: [2] });
  const res = crearRes();

  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Seguridad", class: "Sesion", method: "logout", params: [] }),
    req,
  );

  // El handler de /api/execute limpia la cookie si desapareció req.session.
  if (!req.session) {
    res.clearCookie("connect.sid");
  }

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(res.cookieLimpiada, "connect.sid");
});

test("getPermissionMethod/getPermissionOption consultan los mapas", async () => {
  const { seguridad } = await crearSecurity();

  assert.equal(seguridad.getPermissionMethod("Seguridad_Sesion_login_1"), true);
  assert.equal(seguridad.getPermissionMethod("Seguridad_Sesion_login_99"), false);
  assert.equal(seguridad.getPermissionOption("Seguridad_inexistente_1"), null);
});
