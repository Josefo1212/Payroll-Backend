import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarOrigen } from "../src/middlewares/csrf.js";
import { origenesPermitidos } from "../src/config/http.js";

const PERMITIDO = origenesPermitidos[0];

const evaluar = (req) => {
  const res = {
    statusCode: null,
    cuerpo: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      return this;
    },
  };
  let paso = false;
  verificarOrigen(req, res, () => {
    paso = true;
  });
  return { paso, status: res.statusCode, cuerpo: res.cuerpo };
};

test("los métodos seguros no se revisan", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const { paso } = evaluar({ method, headers: { origin: "http://evil.test" } });
    assert.equal(paso, true, method);
  }
});

test("un POST del origen permitido pasa", () => {
  const { paso } = evaluar({ method: "POST", headers: { origin: PERMITIDO } });
  assert.equal(paso, true);
});

test("un POST de otro origen responde 403", () => {
  const { paso, status } = evaluar({
    method: "POST",
    headers: { origin: "http://evil.test" },
  });
  assert.equal(paso, false);
  assert.equal(status, 403);
});

test("el origen opaco 'null' responde 403", () => {
  const { status } = evaluar({ method: "POST", headers: { origin: "null" } });
  assert.equal(status, 403);
});

test("un POST sin Origin ni Referer pasa (curl y scripts)", () => {
  const { paso } = evaluar({ method: "POST", headers: {} });
  assert.equal(paso, true);
});

test("un POST con Referer del origen permitido pasa", () => {
  const { paso } = evaluar({
    method: "POST",
    headers: { referer: `${PERMITIDO}/login` },
  });
  assert.equal(paso, true);
});

test("un POST con Referer de otro origen responde 403", () => {
  const { status } = evaluar({
    method: "POST",
    headers: { referer: "http://evil.test/login" },
  });
  assert.equal(status, 403);
});

test("un Referer ilegible responde 403", () => {
  const { status } = evaluar({
    method: "POST",
    headers: { referer: "no-es-una-url" },
  });
  assert.equal(status, 403);
});
