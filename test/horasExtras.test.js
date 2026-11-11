import { test } from "node:test";
import assert from "node:assert/strict";
import { Hours } from "../src/bo/Payroll/Hours.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const USUARIO_ID = "11111111-1111-4111-8111-111111111111";
const PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const PERIODO_ID = "33333333-3333-4333-8333-333333333333";
const REGISTRO_ID = "44444444-4444-4444-8444-444444444444";

function crearDb({
  periodoNoBorrador = [],
  periodo = null,
  extras = [],
  registro = null,
  errorUpsert = null,
} = {}) {
  const llamadas = [];

  const db = {
    llamadas,
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });

      if (texto === queries.findPeriodoNoBorradorPorFecha) {
        return { rows: periodoNoBorrador };
      }
      if (texto === queries.findPeriodoById) {
        return { rows: periodo ? [periodo] : [] };
      }
      if (texto === queries.findExtrasPorPeriodo) {
        return { rows: extras };
      }
      if (texto === queries.findRegistroHorasConHoras) {
        return { rows: registro ? [registro] : [] };
      }
      if (texto === queries.upsertHorasExtra) {
        if (errorUpsert) {
          throw errorUpsert;
        }
        return {
          rows: [
            {
              id: REGISTRO_ID,
              persona_id: params[0],
              fecha: params[1],
              horas_normales: "0.00",
              horas_extra: params[2],
              observacion: params[3],
              created_at: "2026-11-10T00:00:00.000Z",
            },
          ],
        };
      }
      if (texto === queries.deleteRegistroHoras) {
        return { rows: [{ id: params[0] }] };
      }
      if (texto === queries.updateHorasExtra) {
        return { rows: [{ id: params[0], horas_extra: params[1] }] };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  return db;
}

const reqConSesion = () => crearReq({ userID: USUARIO_ID });

const llamadasDe = (db, consulta) =>
  db.llamadas.filter((llamada) => llamada.texto === consulta);

const rechazaCon = async (promesa, status, fragmento) => {
  await assert.rejects(promesa, (error) => {
    assert.ok(error instanceof ErrorNegocio, `esperaba ErrorNegocio, llegó ${error?.name}`);
    assert.equal(error.status, status);
    if (fragmento) {
      assert.match(error.message, new RegExp(fragmento, "i"));
    }
    return true;
  });
};

// ---------------------------------------------------------------------------
// registrarExtra
// ---------------------------------------------------------------------------
test("registrarExtra exige sesión", async () => {
  const db = crearDb();
  const hours = new Hours(db, crearReq());

  await rechazaCon(hours.registrarExtra(PERSONA_ID, "2026-11-10", 2), 401, "sesión");
  assert.equal(db.llamadas.length, 0);
});

test("registrarExtra valida persona, fecha y horas", async () => {
  const db = crearDb();
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.registrarExtra("", "2026-11-10", 2), 400, "persona_id");
  await rechazaCon(hours.registrarExtra(PERSONA_ID, "10/11/2026", 2), 400, "YYYY-MM-DD");
  await rechazaCon(hours.registrarExtra(PERSONA_ID, "2026-11-10", 0), 400, "mayores que cero");
  await rechazaCon(hours.registrarExtra(PERSONA_ID, "2026-11-10", -1), 400, "mayores que cero");
  await rechazaCon(hours.registrarExtra(PERSONA_ID, "2026-11-10", "dos"), 400, "número");
  assert.equal(db.llamadas.length, 0);
});

test("registrarExtra suma la extra con upsert sobre la fila del día", async () => {
  const db = crearDb();
  const hours = new Hours(db, reqConSesion());

  const resultado = await hours.registrarExtra(PERSONA_ID, "2026-11-10", 2.5, "Soporte");

  const [upsert] = llamadasDe(db, queries.upsertHorasExtra);
  assert.deepEqual(upsert.params, [PERSONA_ID, "2026-11-10", "2.50", "Soporte", USUARIO_ID]);
  assert.equal(resultado.horas_extra, "2.50");
});

test("registrarExtra rechaza un día de período procesado o pagado", async () => {
  const db = crearDb({ periodoNoBorrador: [{ id: PERIODO_ID, estado: "PROCESADO" }] });
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.registrarExtra(PERSONA_ID, "2026-11-10", 2), 409, "no se puede modificar");
  assert.equal(llamadasDe(db, queries.upsertHorasExtra).length, 0);
});

test("registrarExtra traduce persona inexistente y desbordamiento", async () => {
  const dbPersona = crearDb({ errorUpsert: Object.assign(new Error("fk"), { code: "23503" }) });
  await rechazaCon(
    new Hours(dbPersona, reqConSesion()).registrarExtra(PERSONA_ID, "2026-11-10", 2),
    400,
    "persona no existe",
  );

  const dbRango = crearDb({ errorUpsert: Object.assign(new Error("numeric"), { code: "22003" }) });
  await rechazaCon(
    new Hours(dbRango, reqConSesion()).registrarExtra(PERSONA_ID, "2026-11-10", 2),
    400,
    "máximo permitido",
  );
});

// ---------------------------------------------------------------------------
// listarExtrasPorPeriodo
// ---------------------------------------------------------------------------
test("listarExtrasPorPeriodo valida el período y su existencia", async () => {
  const db = crearDb();
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.listarExtrasPorPeriodo(""), 400, "periodo_id");
  await rechazaCon(hours.listarExtrasPorPeriodo(PERIODO_ID), 404, "no existe");
});

test("listarExtrasPorPeriodo consulta el rango del período", async () => {
  const extras = [
    {
      id: REGISTRO_ID,
      persona_id: PERSONA_ID,
      fecha: "2026-11-10",
      horas_normales: "8.00",
      horas_extra: "2.00",
      cedula: "V-1",
      primer_nombre: "Ana",
      primer_apellido: "Pérez",
    },
  ];
  const db = crearDb({
    periodo: {
      id: PERIODO_ID,
      fecha_inicio: new Date(2026, 10, 1),
      fecha_fin: new Date(2026, 10, 15),
    },
    extras,
  });
  const hours = new Hours(db, reqConSesion());

  const resultado = await hours.listarExtrasPorPeriodo(PERIODO_ID);

  const [consulta] = llamadasDe(db, queries.findExtrasPorPeriodo);
  assert.deepEqual(consulta.params, ["2026-11-01", "2026-11-15"]);
  assert.deepEqual(resultado, extras);
});

// ---------------------------------------------------------------------------
// quitarExtra
// ---------------------------------------------------------------------------
test("quitarExtra valida el id y la existencia del registro", async () => {
  const db = crearDb();
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.quitarExtra(""), 400, "id del registro");
  await rechazaCon(hours.quitarExtra(REGISTRO_ID), 404, "no existe");
});

test("quitarExtra rechaza un registro sin horas extra", async () => {
  const db = crearDb({
    registro: { id: REGISTRO_ID, fecha: "2026-11-10", horas_normales: "8.00", horas_extra: "0.00" },
  });
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.quitarExtra(REGISTRO_ID), 409, "no tiene horas extra");
  assert.equal(llamadasDe(db, queries.deleteRegistroHoras).length, 0);
  assert.equal(llamadasDe(db, queries.updateHorasExtra).length, 0);
});

test("quitarExtra elimina la fila cuando el día solo tenía extras", async () => {
  const db = crearDb({
    registro: { id: REGISTRO_ID, fecha: "2026-11-10", horas_normales: "0.00", horas_extra: "2.00" },
  });
  const hours = new Hours(db, reqConSesion());

  const resultado = await hours.quitarExtra(REGISTRO_ID);

  assert.deepEqual(resultado, { ok: true, id: REGISTRO_ID, eliminado: true });
  assert.equal(llamadasDe(db, queries.deleteRegistroHoras).length, 1);
  assert.equal(llamadasDe(db, queries.updateHorasExtra).length, 0);
});

test("quitarExtra conserva las horas normales del día", async () => {
  const db = crearDb({
    registro: { id: REGISTRO_ID, fecha: "2026-11-10", horas_normales: "8.00", horas_extra: "2.00" },
  });
  const hours = new Hours(db, reqConSesion());

  const resultado = await hours.quitarExtra(REGISTRO_ID);

  assert.deepEqual(resultado, { ok: true, id: REGISTRO_ID, eliminado: false });
  const [update] = llamadasDe(db, queries.updateHorasExtra);
  assert.deepEqual(update.params, [REGISTRO_ID, "0.00"]);
  assert.equal(llamadasDe(db, queries.deleteRegistroHoras).length, 0);
});

test("quitarExtra rechaza un día de período procesado o pagado", async () => {
  const db = crearDb({
    periodoNoBorrador: [{ id: PERIODO_ID, estado: "PAGADO" }],
    registro: { id: REGISTRO_ID, fecha: "2026-11-10", horas_normales: "8.00", horas_extra: "2.00" },
  });
  const hours = new Hours(db, reqConSesion());

  await rechazaCon(hours.quitarExtra(REGISTRO_ID), 409, "no se puede modificar");
  assert.equal(llamadasDe(db, queries.deleteRegistroHoras).length, 0);
  assert.equal(llamadasDe(db, queries.updateHorasExtra).length, 0);
});
