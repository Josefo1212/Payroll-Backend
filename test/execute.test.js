import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { security } from "../src/security/Security.js";
import {
  crearDbFalso,
  crearReq,
  crearRes,
  Security,
  queries,
} from "./helpers.js";

// El BO Admin usa el singleton `security`, no la instancia local de cada
// prueba. Guardamos su db para restaurarlo y apuntarlo a un fake durante las
// pruebas que ejecutan Admin.reloadPermissions.
const dbOriginal = security.db;
afterEach(() => {
  security.db = dbOriginal;
  security.ClaseCache = new Map();
});

// Carga los mapas de permisos con permiso para login (perfil 1), logout
// (perfiles 2 y 9, este último NO es Superusuario) y un perfil público con id
// 5 autorizado a login.
async function crearSecurity({ publicoId = null, sesionPorUsuario = null } = {}) {
  const dbFalso = crearDbFalso({ publicoId, sesionPorUsuario });
  const seguridad = new Security(dbFalso);
  await seguridad.loadPermission();

  seguridad.setPermissionMethod("Security", "Session", "login", 1);
  seguridad.setPermissionMethod("Security", "Session", "logout", 2);
  seguridad.setPermissionMethod("Security", "Session", "logout", 9);
  seguridad.setPermissionMethod("Security", "Session", "constructor", 3);
  seguridad.setPermissionMethod("Security", "Session", "toString", 3);
  seguridad.setPermissionMethod("Security", "Admin", "reloadPermissions", 2);
  if (publicoId != null) {
    seguridad.setPermissionMethod("Security", "Session", "login", publicoId);
  }
  return { seguridad, dbFalso };
}

const peticion = (jsonData) => jsonData;

test("login público se autoriza con el perfil Publico", async () => {
  const { seguridad } = await crearSecurity({ publicoId: 5 });
  const req = crearReq({});

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "login", params: [] }),
    req,
  );

  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
});

test("método protegido sin sesión: 401", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({});

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 401);
});

test("método protegido con sesión sin permiso: 403", async () => {
  // Perfil 8 no tiene permiso a logout (el 2 y el 9 sí). La sesión viva se
  // relee de la base, así que el fake debe devolver ese perfil.
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: { 10: { activo: true, perfiles: [8] } },
  });
  const req = crearReq({ userID: 10, profiles: [8] });

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 403);
});

test("sesión de un usuario desactivado: 401 y destruye la sesión", async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: { 10: { activo: false, perfiles: [2] } },
  });
  const req = crearReq({ userID: 10, profiles: [2] });

  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 401);
  assert.match(body.error, /iniciar sesión/i);
  assert.equal(req.session, undefined, "express-session borra req.session al destruir");
});

test("la sesión usa los perfiles actuales de la base, no los de la cookie", async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: {
      10: {
        activo: true,
        perfiles: [2],
        perfiles_detalle: [{ id: 2, nombre: "Superusuario" }],
      },
    },
  });
  seguridad.setPermissionMethod("Security", "Session", "getSession", 2);

  // La cookie trae el perfil 8, pero la base ya solo tiene el 2.
  const req = crearReq({ userID: 10, profiles: [8] });
  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "getSession", params: [] }),
    req,
  );

  assert.equal(status, 200);
  assert.deepEqual(body.profiles, [{ id: 2, nombre: "Superusuario" }]);
  assert.deepEqual(req.session.profiles, [2]);
});

test("ruta con ../ se rechaza con 400", async () => {
  const { seguridad } = await crearSecurity();
  const req = crearReq({ userID: 10, profiles: [1] });

  const { status } = await seguridad.executeMethod(
    peticion({ subsystem: "../", class: "Session", method: "login", params: [] }),
    req,
  );

  assert.equal(status, 400);
});

test('"constructor" y "toString" responden 501', async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: { 10: { activo: true, perfiles: [1, 3] } },
  });
  const req = crearReq({ userID: 10, profiles: [1, 3] });

  for (const method of ["constructor", "toString"]) {
    const { status } = await seguridad.executeMethod(
      peticion({ subsystem: "Security", class: "Session", method, params: [] }),
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
    peticion({ subsystem: "Security", class: "Session", method: "login", params: ["", ""] }),
    req,
  );

  assert.equal(status, 400);
});

test("logout a través del endpoint limpia la cookie", async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: { 10: { activo: true, perfiles: [2] } },
  });
  const req = crearReq({ userID: 10, userName: "Admin", profiles: [2] });
  const res = crearRes();

  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
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

test("logout con perfil distinto de Superusuario: 200", async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: { 10: { activo: true, perfiles: [9] } },
  });
  // Perfil 9 no es Superusuario, pero tiene permiso a logout (sembrado).
  const req = crearReq({ userID: 10, userName: "Juan", profiles: [9] });

  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});

test("logout sin sesión responde 200 { ok: true }", async () => {
  const { seguridad } = await crearSecurity({ publicoId: 5 });
  const req = crearReq({});
  // logout es público (perfil Publico), así que sin sesión también entra y el
  // BO lo trata como idempotente.
  seguridad.setPermissionMethod("Security", "Session", "logout", 5);

  const { status, body } = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Session", method: "logout", params: [] }),
    req,
  );

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
});

test("reloadPermissions: perfil sin permiso 403, Superusuario 200", async () => {
  const { seguridad } = await crearSecurity({
    sesionPorUsuario: {
      10: { activo: true, perfiles: [8] },
      1: { activo: true, perfiles: [2] },
    },
  });

  // Admin.reloadPermissions llama a security.loadPermission(): que use el
  // fake para no abrir conexión.
  security.db = crearDbFalso({});
  security.ClaseCache = new Map();

  const sinPermiso = crearReq({ userID: 10, profiles: [8] });
  const rechazado = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Admin", method: "reloadPermissions", params: [] }),
    sinPermiso,
  );
  assert.equal(rechazado.status, 403);

  const superusuario = crearReq({ userID: 1, profiles: [2] });
  const aceptado = await seguridad.executeMethod(
    peticion({ subsystem: "Security", class: "Admin", method: "reloadPermissions", params: [] }),
    superusuario,
  );
  assert.equal(aceptado.status, 200);
  assert.equal(typeof aceptado.body.metodos, "number");
  assert.equal(typeof aceptado.body.opciones, "number");
});

test("getPermissionMethod/getPermissionOption consultan los mapas", async () => {
  const { seguridad } = await crearSecurity();

  assert.equal(seguridad.getPermissionMethod("Security_Session_login_1"), true);
  assert.equal(seguridad.getPermissionMethod("Security_Session_login_99"), false);
  assert.equal(seguridad.getPermissionOption("Security_inexistente_1"), null);
});
