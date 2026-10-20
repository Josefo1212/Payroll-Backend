import { test } from "node:test";
import assert from "node:assert/strict";
import { Usuario } from "../bo/Seguridad/Usuario.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";

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
};

async function rechaza(password, fragmento) {
  const usuario = new Usuario(dbQueRevienta, {});
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
  const usuario = new Usuario(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password: "a".repeat(71) + "1" }),
    /no debería tocar la BD/,
  );
});

test("acepta una contraseña válida de 8 caracteres", async () => {
  const usuario = new Usuario(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password: "abcdefg1" }),
    /no debería tocar la BD/,
  );
});
