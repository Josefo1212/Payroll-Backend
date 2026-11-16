import { test } from "node:test";
import assert from "node:assert/strict";
import { TextoService } from "../src/services/TextoService.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { Hours } from "../src/bo/Payroll/Hours.js";

const textoService = new TextoService();

const PERSONA_ID = "22222222-2222-4222-8222-222222222222";

// Cualquier acceso a la BD es un fallo: la longitud se valida antes.
const dbQueRevienta = {
  query: async () => {
    throw new Error("no debería tocar la BD: la longitud se valida antes");
  },
  transaction: async () => {
    throw new Error("no debería tocar la BD: la longitud se valida antes");
  },
};

test("requerido devuelve el texto recortado", () => {
  assert.equal(textoService.requerido("  Ana  ", "nombre", 10), "Ana");
});

test("requerido rechaza texto vacío o solo espacios", () => {
  assert.throws(() => textoService.requerido("   ", "nombre", 10), /nombre/);
});

test("requerido rechaza texto de más de N caracteres", () => {
  assert.throws(
    () => textoService.requerido("a".repeat(11), "nombre", 10),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, /10 caracteres/);
      return true;
    },
  );
});

test("opcional convierte vacío y null en null", () => {
  assert.equal(textoService.opcional("", "observacion", 200), null);
  assert.equal(textoService.opcional(null, "observacion", 200), null);
  assert.equal(textoService.opcional("   ", "observacion", 200), null);
});

test("opcional rechaza texto de más de N caracteres", () => {
  assert.throws(
    () => textoService.opcional("a".repeat(201), "observacion", 200),
    /observacion.*200 caracteres/,
  );
});

test("opcional rechaza un valor que no es texto", () => {
  assert.throws(() => textoService.opcional(123, "observacion", 200), /texto/);
});

test("Hours.registrarExtra rechaza una observación de más de 200 caracteres", async () => {
  const hours = new Hours(dbQueRevienta, { session: { userID: "u-1" } });
  await assert.rejects(
    () =>
      hours.registrarExtra(
        PERSONA_ID,
        "2026-11-10",
        2,
        "a".repeat(201),
      ),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, /observacion/);
      return true;
    },
  );
});
