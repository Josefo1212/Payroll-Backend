import { test } from "node:test";
import assert from "node:assert/strict";
import { User } from "../src/bo/Security/User.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearDbFalso, crearReq, crearRes, queries, HASH_CLAVE } from "./helpers.js";

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
  // El solicitante es Superusuario: el perfil 2 lo es en el doble de la BD.
  const usuario = new User(db, crearReq({ profiles: [2] }));

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

test("registrar impide que un no Superusuario asigne perfiles privilegiados", async () => {
  const db = crearDbFalso({
    nombresPerfil: { 1: "Empleado", 2: "Administrador", 3: "GerenteRRHH" },
  });
  const usuario = new User(db, crearReq({ profiles: [3] }));

  for (const perfiles of [[2], [1, 2], [3]]) {
    await assert.rejects(
      () => usuario.registrar({ ...base, perfiles, password: "abcdefg1" }),
      (error) => {
        assert.ok(error instanceof ErrorNegocio);
        assert.equal(error.status, 403);
        assert.match(error.message, /Solo Superusuario/i);
        return true;
      },
      `perfiles ${JSON.stringify(perfiles)}`,
    );
  }

  assert.equal(
    db.llamadas.some((l) => l.texto === queries.insertUsuario),
    false,
    "no inserta el usuario cuando la asignación escala privilegios",
  );
});

test("registrar permite a Superusuario asignar perfiles privilegiados", async () => {
  const db = crearDbFalso({
    nombresPerfil: { 1: "Superusuario", 2: "Administrador" },
  });
  const usuario = new User(db, crearReq({ profiles: [1] }));

  const resultado = await usuario.registrar({
    ...base,
    perfiles: [2],
    password: "abcdefg1",
  });

  assert.deepEqual(resultado.perfiles, [2]);
  assert.ok(db.llamadas.some((l) => l.texto === queries.insertUsuario));
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

test("cambiarClave rechaza reutilizar la contraseña actual", async () => {
  const db = crearDbFalso({});
  const usuario = new User(db, crearReq({ userID: 1 }));

  await assert.rejects(
    () => usuario.cambiarClave("Password123", "Password123"),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, /distinta de la actual/);
      return true;
    },
  );
  assert.equal(
    db.llamadas.some((l) => typeof l.texto === "string" && l.texto.includes("SET password_hash")),
    false,
    "no actualiza el hash si la clave se reutiliza",
  );
});

test("cambiarClave revoca los refresh tokens y borra las cookies de token", async () => {
  const db = crearDbFalso({});
  const req = crearReq({ userID: 1 });
  req.res = crearRes();
  const usuario = new User(db, req);

  await usuario.cambiarClave("Password123", "NuevaClave123");

  assert.ok(
    db.llamadas.some(
      (l) =>
        typeof l.texto === "string" &&
        l.texto.includes("UPDATE refresh_token") &&
        l.texto.includes("revocado_en = NOW()"),
    ),
    "revoca los refresh tokens del usuario",
  );
  assert.deepEqual(req.res.cookiesLimpiadas, ["access_token", "refresh_token"]);
});

// ---------------------------------------------------------------------------
// Validación de entrada de registrar: los límites replican los varchar de la
// BD. Cada caso debe responder 400 antes de abrir la transacción, no un 500
// por 22001 de PostgreSQL.
// ---------------------------------------------------------------------------

const rechazaRegistro = async (cambios, fragmento) => {
  const usuario = new User(dbQueRevienta, {});
  await assert.rejects(
    () => usuario.registrar({ ...base, password: "abcdefg1", ...cambios }),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 400);
      assert.match(error.message, fragmento);
      return true;
    },
  );
};

test("registrar rechaza una cédula de más de 20 caracteres", async () => {
  await rechazaRegistro({ cedula: "V-" + "1".repeat(20) }, /cedula/);
});

test("registrar rechaza un email con formato inválido", async () => {
  await rechazaRegistro({ email: "sin-arroba.test" }, /email/);
});

test("registrar rechaza un email de más de 120 caracteres", async () => {
  await rechazaRegistro({ email: `${"a".repeat(120)}@x.test` }, /email/);
});

test("registrar rechaza un username con caracteres no permitidos", async () => {
  await rechazaRegistro({ username: "ana perez" }, /username/);
});

test("registrar rechaza un username vacío", async () => {
  await rechazaRegistro({ username: "   " }, /username/);
});

test("registrar rechaza un sexo fuera del enum", async () => {
  await rechazaRegistro({ sexo: "X" }, /sexo/);
});

test("registrar rechaza un estado civil fuera del enum", async () => {
  await rechazaRegistro({ estado_civil: "NOVIO" }, /estado_civil/);
});

test("registrar rechaza una fecha que no existe", async () => {
  await rechazaRegistro({ fecha_nacimiento: "2026-02-31" }, /fecha_nacimiento/);
});

test("registrar rechaza nombres de más de 60 caracteres", async () => {
  await rechazaRegistro({ primer_nombre: "A".repeat(61) }, /primer_nombre/);
});

test("registrar rechaza un salario que no es mayor que cero", async () => {
  await rechazaRegistro(
    {
      laboral: {
        cargo_id: 1,
        fecha_inicio: "2026-01-01",
        tipo_pago: "SALARIO_FIJO",
        frecuencia_pago: "MENSUAL",
        monto: 0,
      },
    },
    /monto/,
  );
});

test("registrar rechaza horas semanales fuera de rango", async () => {
  await rechazaRegistro(
    {
      laboral: {
        cargo_id: 1,
        fecha_inicio: "2026-01-01",
        tipo_pago: "POR_HORA",
        frecuencia_pago: "SEMANAL",
        monto: 10,
        horas_semanales: 200,
      },
    },
    /horas_semanales/,
  );
});
