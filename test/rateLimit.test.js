import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { crearLimiteDeFallos } from "../src/middlewares/rateLimit.js";

const crearRes = () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.cabeceras = {};
  res.cuerpo = null;
  res.set = (nombre, valor) => {
    res.cabeceras[nombre.toLowerCase()] = valor;
    return res;
  };
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (cuerpo) => {
    res.cuerpo = cuerpo;
    res.emit("finish");
    return res;
  };
  return res;
};

// Ejecuta el middleware una vez. Si deja pasar, simula la respuesta del
// handler con el status indicado (que es lo que dispara el conteo).
const peticion = (limite, ip, status = 401) => {
  const req = { ip };
  const res = crearRes();
  let paso = false;

  limite.middleware(req, res, () => {
    paso = true;
  });

  if (!paso) {
    return { bloqueado: true, res };
  }

  res.statusCode = status;
  res.emit("finish");
  return { bloqueado: false, res };
};

test("bloquea con 429 al superar el máximo de fallos y manda Retry-After", () => {
  const limite = crearLimiteDeFallos({ maximo: 2, ventanaMs: 60_000 });

  assert.equal(peticion(limite, "1.1.1.1").bloqueado, false);
  assert.equal(peticion(limite, "1.1.1.1").bloqueado, false);

  const tercera = peticion(limite, "1.1.1.1");
  assert.equal(tercera.bloqueado, true);
  assert.equal(tercera.res.statusCode, 429);
  assert.equal(tercera.res.cabeceras["retry-after"], "60");
  assert.match(tercera.res.cuerpo.error, /Demasiados intentos/);
});

test("un acierto limpia el contador de la IP", () => {
  const limite = crearLimiteDeFallos({ maximo: 2, ventanaMs: 60_000 });

  peticion(limite, "2.2.2.2", 401);
  peticion(limite, "2.2.2.2", 200);
  peticion(limite, "2.2.2.2", 401);

  assert.equal(peticion(limite, "2.2.2.2").bloqueado, false);
});

test("los 429 no se cuentan como un fallo nuevo", () => {
  const limite = crearLimiteDeFallos({ maximo: 1, ventanaMs: 60_000 });

  peticion(limite, "3.3.3.3");
  const bloqueada = peticion(limite, "3.3.3.3");
  assert.equal(bloqueada.bloqueado, true);

  assert.equal(limite.fallos.get("3.3.3.3").conteo, 1);
});

test("la ventana se reinicia al vencer", () => {
  let instante = 0;
  const limite = crearLimiteDeFallos({
    maximo: 1,
    ventanaMs: 1_000,
    ahora: () => instante,
  });

  peticion(limite, "4.4.4.4");
  assert.equal(peticion(limite, "4.4.4.4").bloqueado, true);

  instante = 1_000;
  assert.equal(peticion(limite, "4.4.4.4").bloqueado, false);
});

test("cada IP tiene su propio contador", () => {
  const limite = crearLimiteDeFallos({ maximo: 1, ventanaMs: 60_000 });

  peticion(limite, "5.5.5.5");
  assert.equal(peticion(limite, "5.5.5.5").bloqueado, true);
  assert.equal(peticion(limite, "6.6.6.6").bloqueado, false);
});
