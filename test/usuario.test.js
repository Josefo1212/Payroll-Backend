import { test } from "node:test";
import assert from "node:assert/strict";
import { User } from "../src/bo/Security/User.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearDbFalso, crearReq, queries, HASH_CLAVE } from "./helpers.js";

// La validación de contraseña corre antes de tocar la BD. Este doble falla si
// `registrar` intenta abrir una transacción: así una prueba solo puede pasar
// si la clave fue rechazada antes.
const dbQueRevienta = {
  transaction: async () => {
    throw new Error("no debería tocar la BD: la clave debió rechazarse antes");
  },
  query: async () => {
    throw new Error("no debería tocar la BD: la clave debió rechazarse antes");
  },
};

const base = {
  cedula: "V-1",
  primer_nombre: "Ana",
  primer_apellido: "Pérez",
  username: "ana",
  perfiles: [1],
};

async function rechaza(password, fragmento) {
  const usuario = new User(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password }),
    (error) => {
      assert.ok(error instanceof ErrorNegocio, "debe ser ErrorNegocio");
      assert.equal(error.status, 400);
      assert.match(error.message, fragmento);
      return true;
    },
  );
}

test("rechaza contraseña de menos de 8 caracteres", async () => {
  await rechaza("Aa1", /al menos 8/);
  await rechaza("Aa1bbbbb".slice(0, 7), /al menos 8/);
});

test("rechaza contraseña sin número", async () => {
  await rechaza("abcdefgh", /una letra y un número/);
});

test("rechaza contraseña sin letra", async () => {
  await rechaza("12345678", /una letra y un número/);
});

test("rechaza contraseña de más de 72 bytes", async () => {
  // 72 caracteres 'a' + '1' => 73 bytes: se pasa del límite de bcrypt.
  await rechaza("a".repeat(72) + "1", /72 bytes/);
  // Caracteres multibyte: 40 'á' (2 bytes c/u = 80 bytes) con un dígito.
  await rechaza("á".repeat(40) + "1", /72 bytes/);
});

test("acepta una contraseña válida de exactamente 72 bytes", async () => {
  // 71 'a' + '1' = 72 bytes: válida, debe llegar a la BD (y reventar ahí).
  const usuario = new User(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password: "a".repeat(71) + "1" }),
    /no debería tocar la BD/,
  );
});

test("acepta una contraseña válida de 8 caracteres", async () => {
  const usuario = new User(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password: "abcdefg1" }),
    /no debería tocar la BD/,
  );
});

test("registrar exige al menos un perfil", async () => {
  const { perfiles, ...sinPerfiles } = base;
  const usuario = new User(dbQueRevienta, {});

  await assert.rejects(
    () => usuario.registrar({ ...sinPerfiles, password: "abcdefg1" }),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, /al menos un perfil/i);
      return true;
    },
  );
});

test("registrar rechaza perfiles que no son ids enteros positivos", async () => {
  const usuario = new User(dbQueRevienta, {});

  for (const perfiles of [[1, "2"], [0], [1.5]]) {
    await assert.rejects(
      () => usuario.registrar({ ...base, perfiles, password: "abcdefg1" }),
      (error) => {
        assert.ok(error instanceof ErrorNegocio);
        assert.equal(error.status, 400);
        assert.match(error.message, /ids enteros positivos/i);
        return true;
      },
      `perfiles ${JSON.stringify(perfiles)}`,
    );
  }
});

test("registrar rechaza un perfil inexistente o inactivo", async () => {
  const db = crearDbFalso({ perfilesActivos: [1] });
  const usuario = new User(db, {});

  await assert.rejects(
    () => usuario.registrar({ ...base, perfiles: [1, 2], password: "abcdefg1" }),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, /no existe o está inactivo/i);
      return true;
    },
  );
  assert.equal(
    db.llamadas.some((l) => l.texto === queries.insertUsuario),
    false,
    "no inserta el usuario si un perfil falla",
  );
});

test("registrar asigna los perfiles en la misma transacción", async () => {
  const db = crearDbFalso({ perfilesActivos: [1, 2] });
  const usuario = new User(db, {});

  // Repetido a propósito: se deduplica antes de insertar.
  const resultado = await usuario.registrar({
    ...base,
    perfiles: [1, 2, 2],
    password: "abcdefg1",
  });

  assert.deepEqual(resultado.perfiles, [1, 2]);
  const insercion = db.llamadas.find((l) => l.texto === queries.insertUsuarioPerfil || (typeof l.texto === "string" && l.texto.includes("INSERT INTO usuario_perfil")));
  assert.ok(insercion);
  assert.deepEqual(insercion.params, [200, [1, 2]]);
});

test("cambiarClave exige sesión", async () => {
  const usuario = new User(dbQueRevienta, crearReq({}));

  await assert.rejects(() => usuario.cambiarClave("Password123", "NuevaClave123"), (error) => {
    assert.ok(error instanceof ErrorNegocio);
    assert.equal(error.status, 401);
    return true;
  });
});

test("cambiarClave rechaza una clave nueva inválida antes de tocar la BD", async () => {
  const usuario = new User(dbQueRevienta, crearReq({ userID: 1 }));

  await assert.rejects(() => usuario.cambiarClave("Password123", "corta"), (error) => {
    assert.ok(error instanceof ErrorNegocio);
    assert.equal(error.status, 400);
    return true;
  });
});

test("cambiarClave rechaza la contraseña actual incorrecta", async () => {
  const db = crearDbFalso({});
  const usuario = new User(db, crearReq({ userID: 1 }));

  await assert.rejects(() => usuario.cambiarClave("incorrecta", "NuevaClave123"), (error) => {
    assert.ok(error instanceof ErrorNegocio);
    assert.equal(error.status, 401);
    assert.match(error.message, /actual es incorrecta/i);
    return true;
  });
  assert.equal(db.llamadas.some((l) => typeof l.texto === "string" && l.texto.includes("UPDATE usuario") && l.texto.includes("password_hash")), false);
});

test("cambiarClave actualiza el hash y limpia la bandera de la sesión", async () => {
  const db = crearDbFalso({});
  const req = crearReq({ userID: 1, debeCambiarClave: true });
  const usuario = new User(db, req);

  const resultado = await usuario.cambiarClave("Password123", "NuevaClave123");

  assert.deepEqual(resultado, { ok: true });
  assert.equal(req.session.debeCambiarClave, false);
  assert.ok(db.llamadas.some((l) => typeof l.texto === "string" && l.texto.includes("UPDATE usuario") && l.texto.includes("password_hash")));
  // El hash guardado ya no corresponde a la clave anterior.
  const llamada = db.llamadas.find((l) => typeof l.texto === "string" && l.texto.includes("UPDATE usuario") && l.texto.includes("password_hash"));
  assert.notEqual(llamada.params[0], HASH_CLAVE);
});
