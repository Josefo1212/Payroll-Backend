import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crearDbFalso,
  peticion,
  Sesion,
  queries,
  HASH_CLAVE,
  USUARIO_OK,
} from "./helpers.js";

// Construye un BO sobre una petición con sesión real (express-session falso).
async function crearBo(sesionInicial = {}, opciones = {}) {
  const { req } = await peticion(sesionInicial);
  const dbFalso = crearDbFalso(opciones);
  return { bo: new Sesion(dbFalso, req), req, dbFalso };
}

test("login ok: crea la sesión sin exponer el hash", async () => {
  const { bo, req, dbFalso } = await crearBo({}, { perfiles: [2, 3] });

  const resultado = await bo.login("admin", "Password123");

  assert.deepEqual(resultado, { userID: 1, userName: "Admin Prueba", profiles: [2, 3] });
  assert.equal(req.session.userID, 1);
  assert.deepEqual(req.session.profiles, [2, 3]);
  assert.equal(req.session.password_hash, undefined);
  // Resetea intentos y último acceso.
  assert.ok(dbFalso.llamadas.some((l) => l.texto === queries.resetAttemptsAndAccess));
});

test("contraseña incorrecta: 401 y registra intento fallido", async () => {
  const { bo, dbFalso } = await crearBo();

  await assert.rejects(() => bo.login("admin", "incorrecta"), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, "Usuario o contraseña incorrectos");
    return true;
  });
  assert.ok(dbFalso.llamadas.some((l) => l.texto === queries.registerFailedAttempt));
});

test("usuario inexistente: mismo mensaje que contraseña incorrecta", async () => {
  const { bo } = await crearBo({}, { usuario: null });

  await assert.rejects(() => bo.login("nadie", "Password123"), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, "Usuario o contraseña incorrectos");
    return true;
  });
});

test("usuario inactivo: 403", async () => {
  const { bo } = await crearBo({}, { usuario: { ...USUARIO_OK, activo: false } });

  await assert.rejects(() => bo.login("admin", "Password123"), (error) => {
    assert.equal(error.status, 403);
    return true;
  });
});

test("usuario bloqueado: 423", async () => {
  const futuro = new Date(Date.now() + 60_000);
  const { bo } = await crearBo({}, { usuario: { ...USUARIO_OK, bloqueado_hasta: futuro } });

  await assert.rejects(() => bo.login("admin", "Password123"), (error) => {
    assert.equal(error.status, 423);
    return true;
  });
});

test("bloqueo al llegar al máximo de intentos", async () => {
  const { bo, dbFalso } = await crearBo(
    {},
    { usuario: { ...USUARIO_OK, intentos_fallidos: 4 } },
  );

  await assert.rejects(() => bo.login("admin", "incorrecta"), (error) => {
    assert.equal(error.status, 401);
    return true;
  });

  assert.equal(dbFalso.estado.intentos, 5);
  assert.ok(dbFalso.estado.bloqueadoHasta > new Date(), "queda bloqueado hasta el futuro");
});

test("login con sesión existente: devuelve la sesión sin autenticar", async () => {
  const { bo, dbFalso } = await crearBo({ userID: 9, userName: "Ya", profiles: [7] });

  const resultado = await bo.login("admin", "Password123");

  assert.deepEqual(resultado, { userID: 9, userName: "Ya", profiles: [7] });
  assert.equal(
    dbFalso.llamadas.some((l) => l.texto === queries.findUserByUsername),
    false,
    "no consulta la base si ya hay sesión",
  );
});

test("getSession devuelve la sesión; sessionExist() es booleano", async () => {
  const { bo } = await crearBo({ userID: 1, userName: "Admin", profiles: [2] });

  assert.equal(bo.sessionExist(), true);
  assert.deepEqual(bo.getSession(), { userID: 1, userName: "Admin", profiles: [2] });

  const { bo: boVacio } = await crearBo();
  assert.equal(boVacio.sessionExist(), false);
  assert.equal(boVacio.getSession(), null);
});

test("logout destruye la sesión", async () => {
  const { bo, req } = await crearBo({ userID: 1, userName: "Admin", profiles: [2] });

  const resultado = await bo.logout();

  assert.deepEqual(resultado, { ok: true });
  assert.equal(req.session.userID, undefined);
  assert.equal(req.session.userName, undefined);
});

test("logout sin sesión devuelve { ok: true } sin lanzar", async () => {
  const { bo } = await crearBo();

  const resultado = await bo.logout();

  assert.deepEqual(resultado, { ok: true });
});

test("un error de BD en login no se atrapa: se propaga", async () => {
  const { bo, dbFalso } = await crearBo();
  const original = dbFalso.query;
  dbFalso.query = async (texto, params) => {
    if (texto === queries.findUserByUsername) {
      throw new Error("BD caída");
    }
    return original(texto, params);
  };

  await assert.rejects(() => bo.login("admin", "Password123"), /BD caída/);
});

test("login con credenciales vacías: 400", async () => {
  const { bo } = await crearBo();

  await assert.rejects(() => bo.login("", ""), (error) => {
    assert.equal(error.status, 400);
    return true;
  });
});

test("la contraseña nunca aparece en los logs", async () => {
  const original = console.log;
  const registros = [];
  console.log = (...args) => registros.push(args.join(" "));

  try {
    const { bo } = await crearBo();
    await assert.rejects(() => bo.login("admin", "SuperSecreta123"));
  } finally {
    console.log = original;
  }

  assert.equal(
    registros.some((linea) => linea.includes("SuperSecreta123")),
    false,
  );
});

test("con LOGIN_FAIL_DELAY_MS=0 un fallo de credenciales es inmediato", async () => {
  assert.equal(process.env.LOGIN_FAIL_DELAY_MS, "0", "la prueba corre con la pausa desactivada");
  const { bo } = await crearBo();

  const inicio = Date.now();
  await assert.rejects(() => bo.login("admin", "incorrecta"), (error) => {
    assert.equal(error.status, 401);
    return true;
  });

  assert.ok(Date.now() - inicio < 150, "no espera la pausa configurable");
});

test("hash de la clave de prueba corresponde al texto plano", async () => {
  const { default: bcrypt } = await import("bcrypt");
  assert.equal(await bcrypt.compare("Password123", HASH_CLAVE), true);
});
