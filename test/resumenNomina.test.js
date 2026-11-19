import { test } from "node:test";
import assert from "node:assert/strict";
import { Period } from "../src/bo/Payroll/Period.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const PERIODO_ID = "33333333-3333-4333-8333-333333333333";

const PERIODO = {
  id: PERIODO_ID,
  fecha_inicio: "2026-11-09",
  fecha_fin: "2026-11-15",
  frecuencia: "SEMANAL",
  estado: "PROCESADO",
  descripcion: "Semana 2 de noviembre 2026",
  procesado_por: "11111111-1111-4111-8111-111111111111",
  fecha_proceso: "2026-11-16T00:00:00.000Z",
  created_at: "2026-11-09T00:00:00.000Z",
  pre_nomina_id: null,
  pre_nomina_version: null,
};

function crearDb({
  periodo = PERIODO,
  resumen = [],
  conceptos = [],
  periodos = [],
} = {}) {
  const llamadas = [];

  const db = {
    llamadas,
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });

      if (texto === queries.findPeriodoById) {
        return { rows: periodo ? [periodo] : [] };
      }
      if (texto === queries.resumenPeriodo) {
        return { rows: resumen };
      }
      if (texto === queries.resumenPorConcepto) {
        return { rows: conceptos };
      }
      if (texto === queries.listarPeriodosConTotales) {
        return { rows: periodos };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  return db;
}

test("resumen separa el aporte patronal del neto y calcula el costo total", async () => {
  const db = crearDb({
    resumen: [
      {
        ...PERIODO,
        personas: "3",
        total_asignaciones: "1725.00",
        total_deducciones: "259.89",
        total_neto: "1465.11",
      },
    ],
    conceptos: [
      {
        codigo: "SUELDO_BASE",
        nombre_concepto: "Sueldo base",
        tipo_concepto: "ASIGNACION",
        categoria: "AJUSTE",
        lineas: 3,
        total: "1200.00",
      },
      {
        codigo: "BONO",
        nombre_concepto: "Bono",
        tipo_concepto: "ASIGNACION",
        categoria: "BONO",
        lineas: 3,
        total: "525.00",
      },
      {
        codigo: "SSO",
        nombre_concepto: "Seguro social",
        tipo_concepto: "DEDUCCION",
        categoria: "LEY",
        lineas: 3,
        total: "259.89",
      },
      {
        codigo: "SSO_PATRONAL",
        nombre_concepto: "Seguro social patronal",
        tipo_concepto: "APORTE_PATRONAL",
        categoria: "LEY",
        lineas: 3,
        total: "224.25",
      },
    ],
  });

  const period = new Period(db, crearReq({ userID: "u-1" }));
  const resultado = await period.resumen(PERIODO_ID);

  assert.deepEqual(resultado.totales, {
    personas: 3,
    total_asignaciones: "1725.00",
    total_deducciones: "259.89",
    total_neto: "1465.11",
    total_aporte_patronal: "224.25",
    costo_total: "1949.25",
  });
  assert.equal(resultado.por_concepto.length, 4);
  assert.equal(resultado.por_concepto[0].total, "1200.00");
  assert.equal(resultado.periodo.preNominaId, null);
  assert.equal(resultado.periodo.preNominaVersion, null);
});

test("resumen de un período sin recibos devuelve ceros, no null", async () => {
  const db = crearDb({
    resumen: [
      {
        ...PERIODO,
        estado: "BORRADOR",
        personas: "0",
        total_asignaciones: "0",
        total_deducciones: "0",
        total_neto: "0",
      },
    ],
    conceptos: [],
  });

  const period = new Period(db, crearReq({ userID: "u-1" }));
  const resultado = await period.resumen(PERIODO_ID);

  assert.deepEqual(resultado.totales, {
    personas: 0,
    total_asignaciones: "0.00",
    total_deducciones: "0.00",
    total_neto: "0.00",
    total_aporte_patronal: "0.00",
    costo_total: "0.00",
  });
  assert.deepEqual(resultado.por_concepto, []);
});

test("resumen exige periodo_id y período existente", async () => {
  const period = new Period(crearDb(), crearReq({ userID: "u-1" }));

  await assert.rejects(
    () => period.resumen("   "),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 400 &&
      /periodo_id/.test(error.message),
  );

  const periodSinFila = new Period(crearDb({ periodo: null }), crearReq({ userID: "u-1" }));
  await assert.rejects(
    () => periodSinFila.resumen(PERIODO_ID),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 404 &&
      /no existe/.test(error.message),
  );
});

test("listarConTotales normaliza montos y cuentas", async () => {
  const db = crearDb({
    periodos: [
      {
        ...PERIODO,
        personas: "3",
        total_asignaciones: "1725.00",
        total_deducciones: "259.89",
        total_neto: "1465.11",
        total_aporte_patronal: "224.25",
      },
      {
        ...PERIODO,
        id: "44444444-4444-4444-8444-444444444444",
        estado: "BORRADOR",
        personas: "0",
        total_asignaciones: "0",
        total_deducciones: "0",
        total_neto: "0",
        total_aporte_patronal: "0",
      },
    ],
  });

  const period = new Period(db, crearReq({ userID: "u-1" }));
  const resultado = await period.listarConTotales();

  assert.equal(resultado.length, 2);
  assert.equal(resultado[0].personas, 3);
  assert.equal(resultado[0].total_asignaciones, "1725.00");
  assert.equal(resultado[0].total_aporte_patronal, "224.25");
  assert.equal(resultado[0].costo_total, "1949.25");
  assert.equal(resultado[1].personas, 0);
  assert.equal(resultado[1].total_neto, "0.00");
  assert.equal(resultado[1].costo_total, "0.00");
});
