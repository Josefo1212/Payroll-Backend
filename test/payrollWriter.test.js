import { test } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { PayrollWriter } from "../src/bo/Payroll/PayrollWriter.js";
import { Period } from "../src/bo/Payroll/Period.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const USUARIO_ID = "11111111-1111-4111-8111-111111111111";
const PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const PERIODO_ID = "33333333-3333-4333-8333-333333333333";
const CONTRATO_ID = "44444444-4444-4444-8444-444444444444";

const CONCEPTOS = {
  SUELDO_BASE: { id: 1, codigo: "SUELDO_BASE" },
  HORA_EXTRA: { id: 2, codigo: "HORA_EXTRA" },
  CUOTA_PRESTAMO: { id: 3, codigo: "CUOTA_PRESTAMO" },
};

const PERIODO = {
  id: PERIODO_ID,
  fecha_inicio: "2031-01-01",
  fecha_fin: "2031-01-07",
  frecuencia: "SEMANAL",
  estado: "BORRADOR",
};

const contratoPorHora = (extra = {}) => ({
  contrato_id: CONTRATO_ID,
  persona_id: PERSONA_ID,
  tipo_pago: "POR_HORA",
  frecuencia_pago: "SEMANAL",
  primer_nombre: "Ana",
  primer_apellido: "Pérez",
  monto_salario: "10",
  ...extra,
});

const contratoFijo = (frecuencia, monto = "2600") => ({
  contrato_id: CONTRATO_ID,
  persona_id: PERSONA_ID,
  tipo_pago: "SALARIO_FIJO",
  frecuencia_pago: frecuencia,
  primer_nombre: "Ana",
  primer_apellido: "Pérez",
  monto_salario: monto,
});

function crearDb({
  conceptos = CONCEPTOS,
  contratos = [],
  horas = { horas_normales: "0", horas_extra: "0" },
  recurrentes = [],
  novedades = [],
  cuotas = [],
  afiliaciones = [],
  parametros = [],
  periodo = PERIODO,
} = {}) {
  const llamadas = [];
  let secuencia = 0;

  const db = {
    llamadas,
    transaction: async (fn) => fn(db),
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });

      if (texto === queries.findConceptoByCodigo) {
        const concepto = conceptos[params[0]];
        return { rows: concepto ? [concepto] : [] };
      }
      if (texto === queries.findContratosVigentesPorFrecuencia) {
        return { rows: contratos };
      }
      if (texto === queries.sumaHorasPorPersonaPeriodo) {
        return { rows: [horas] };
      }
      if (texto === queries.findRecurrentesVigentesPorPersona) {
        return { rows: recurrentes };
      }
      if (texto === queries.findNovedadesAprobadasPorPersona) {
        return { rows: novedades };
      }
      if (texto === queries.findCuotasPendientesPorPersona) {
        return { rows: cuotas };
      }
      if (texto === queries.findAfiliacionesVigentesPorPersona) {
        return { rows: afiliaciones };
      }
      if (texto === queries.findParametrosAportePorIds) {
        const ids = params[0] ?? [];
        return { rows: parametros.filter((fila) => ids.includes(fila.id)) };
      }
      if (texto === queries.insertRecibo) {
        secuencia += 1;
        return {
          rows: [
            {
              id: `recibo-${secuencia}`,
              persona_id: params[0],
              periodo_nomina_id: params[1],
              contrato_id: params[2],
              total_asignaciones: params[4],
              total_deducciones: params[5],
              monto_total: params[6],
              estado: "PENDIENTE",
            },
          ],
        };
      }
      if (texto === queries.insertDetalleRecibo || texto === queries.insertPreNominaDetalle) {
        secuencia += 1;
        return { rows: [{ id: `detalle-${secuencia}` }] };
      }
      if (texto === queries.insertPreNominaRecibo) {
        secuencia += 1;
        return {
          rows: [
            {
              id: `pre-recibo-${secuencia}`,
              persona_id: params[1],
              contrato_id: params[2],
              total_asignaciones: params[3],
              total_deducciones: params[4],
              monto_total: params[5],
            },
          ],
        };
      }
      if (texto === queries.findPeriodoById) {
        return { rows: periodo ? [periodo] : [] };
      }
      if (
        texto === queries.marcarNovedadesAplicadas ||
        texto === queries.marcarCuotaDescontada ||
        texto === queries.marcarPrestamosPagados
      ) {
        return { rows: [] };
      }
      if (texto === queries.updatePeriodoEstado) {
        return { rows: [{ id: params[0], estado: params[1] }] };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  return db;
}

const lineasDe = (resultado, origen) =>
  resultado.lineas.filter((linea) => linea.origen === origen);

const llamadasDe = (db, consulta) =>
  db.llamadas.filter((llamada) => llamada.texto === consulta);

// ---------------------------------------------------------------------------
// 1. Por hora: sueldo = horas × tarifa, extra ×1.5
// ---------------------------------------------------------------------------

test("por hora: sueldo normal y hora extra con origen CALCULADA", async () => {
  const db = crearDb({
    contratos: [contratoPorHora()],
    horas: { horas_normales: "80", horas_extra: "10" },
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const calculadas = lineasDe(resultado, "CALCULADA");
  assert.equal(calculadas.length, 2);
  assert.deepEqual(
    calculadas.map((linea) => linea.monto.toFixed(2)),
    ["800.00", "150.00"],
  );
  assert.equal(calculadas[0].conceptoId, CONCEPTOS.SUELDO_BASE.id);
  assert.equal(calculadas[0].cantidadUnidades, 80);
  assert.equal(calculadas[1].cantidadUnidades, 10);
  assert.equal(calculadas[1].baseCalculo.toFixed(2), "10.00");
  assert.equal(calculadas[1].tasaAplicada.toString(), "1.5");
});

// ---------------------------------------------------------------------------
// 2. Salario fijo: prorrateo por frecuencia
// ---------------------------------------------------------------------------

test("salario fijo: prorrateo mensual, quincenal y semanal", async () => {
  const writer = new PayrollWriter(crearDb());
  const conceptos = await writer.conceptosBase();

  const casos = [
    ["MENSUAL", "2600.00"],
    ["QUINCENAL", "1300.00"],
    ["SEMANAL", "600.00"],
  ];

  for (const [frecuencia, esperado] of casos) {
    const resultado = await writer.construirLineas(
      contratoFijo(frecuencia),
      { ...PERIODO, frecuencia },
      conceptos,
    );
    assert.equal(resultado.lineas[0].monto.toFixed(2), esperado);
    assert.equal(resultado.lineas[0].cantidadUnidades, null);
  }
});

// ---------------------------------------------------------------------------
// 3. Recurrentes: porcentaje y monto fijo
// ---------------------------------------------------------------------------

test("recurrentes: porcentaje del sueldo y monto fijo con origen RECURRENTE", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "0" },
    recurrentes: [
      {
        id: "recurrente-1",
        concepto_id: 10,
        tipo_valor: "PORCENTAJE_SALARIO",
        valor: "0.10",
        tipo_concepto: "ASIGNACION",
        categoria: "BONO",
        afecta_base_ley: true,
      },
      {
        id: "recurrente-2",
        concepto_id: 11,
        tipo_valor: "MONTO_FIJO",
        valor: "50",
        tipo_concepto: "ASIGNACION",
        categoria: "BONO",
        afecta_base_ley: false,
      },
    ],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const recurrentes = lineasDe(resultado, "RECURRENTE");
  assert.equal(recurrentes.length, 2);
  assert.equal(recurrentes[0].monto.toFixed(2), "80.00");
  assert.equal(recurrentes[0].baseCalculo.toFixed(2), "800.00");
  assert.equal(recurrentes[0].tasaAplicada.toString(), "0.1");
  assert.equal(recurrentes[0].conceptoPersonaId, "recurrente-1");
  assert.equal(recurrentes[1].monto.toFixed(2), "50.00");
  assert.equal(recurrentes[1].baseCalculo, null);
  assert.equal(recurrentes[1].tasaAplicada, null);
});

// ---------------------------------------------------------------------------
// 4. Novedades: monto y cantidad
// ---------------------------------------------------------------------------

test("novedades: monto directo y hora extra por cantidad", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "0" },
    novedades: [
      {
        id: "novedad-1",
        concepto_id: 20,
        cantidad: null,
        monto: "200",
        tipo_concepto: "ASIGNACION",
        categoria: "BONO",
        afecta_base_ley: true,
      },
      {
        id: "novedad-2",
        concepto_id: 21,
        cantidad: "2",
        monto: null,
        tipo_concepto: "ASIGNACION",
        categoria: "HORA_EXTRA",
        afecta_base_ley: true,
      },
    ],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const novedades = lineasDe(resultado, "NOVEDAD");
  assert.equal(novedades.length, 2);
  assert.equal(novedades[0].monto.toFixed(2), "200.00");
  assert.equal(novedades[0].novedadId, "novedad-1");
  assert.equal(novedades[0].cantidadUnidades, null);
  assert.equal(novedades[1].monto.toFixed(2), "30.00");
  assert.equal(novedades[1].cantidadUnidades, 2);
});

// ---------------------------------------------------------------------------
// 5. Cuotas de préstamo
// ---------------------------------------------------------------------------

test("cuota pendiente: origen PRESTAMO con cuotaPrestamoId", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "0" },
    cuotas: [{ id: "cuota-1", monto_cuota: "120.00" }],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const prestamos = lineasDe(resultado, "PRESTAMO");
  assert.equal(prestamos.length, 1);
  assert.equal(prestamos[0].monto.toFixed(2), "120.00");
  assert.equal(prestamos[0].cuotaPrestamoId, "cuota-1");
  assert.equal(prestamos[0].tipoConcepto, "DEDUCCION");
});

// ---------------------------------------------------------------------------
// 6. Ley: piso/tope y aporte patronal
// ---------------------------------------------------------------------------

test("ley: base acotada por piso y aporte patronal separado", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "0" },
    afiliaciones: [
      {
        parametro_id: 7,
        concepto_deduccion_id: 30,
        concepto_patronal_id: 31,
        tasa_empleado: "0.0400",
        tasa_patronal: "0.0900",
        piso_base: "1000",
        tope_base: null,
      },
    ],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const ley = lineasDe(resultado, "LEY");
  assert.equal(ley.length, 2);
  assert.equal(ley[0].baseCalculo.toFixed(2), "1000.00");
  assert.equal(ley[0].monto.toFixed(2), "40.00");
  assert.equal(ley[1].monto.toFixed(2), "90.00");
  assert.equal(ley[1].tipoConcepto, "APORTE_PATRONAL");
  assert.equal(resultado.totalAportePatronal.toFixed(2), "90.00");
});

test("ley: base acotada por tope", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "0" },
    afiliaciones: [
      {
        parametro_id: 8,
        concepto_deduccion_id: 30,
        concepto_patronal_id: null,
        tasa_empleado: "0.0400",
        tasa_patronal: "0",
        piso_base: null,
        tope_base: "500",
      },
    ],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  const ley = lineasDe(resultado, "LEY");
  assert.equal(ley.length, 1);
  assert.equal(ley[0].baseCalculo.toFixed(2), "500.00");
  assert.equal(ley[0].monto.toFixed(2), "20.00");
  assert.equal(resultado.totalAportePatronal.toFixed(2), "0.00");
});

// ---------------------------------------------------------------------------
// 7. Totales
// ---------------------------------------------------------------------------

test("totales: asignaciones, deducciones, neto y aporte patronal", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "10" },
    cuotas: [{ id: "cuota-1", monto_cuota: "120.00" }],
    afiliaciones: [
      {
        parametro_id: 7,
        concepto_deduccion_id: 30,
        concepto_patronal_id: 31,
        tasa_empleado: "0.0400",
        tasa_patronal: "0.0900",
        piso_base: null,
        tope_base: null,
      },
    ],
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const resultado = await writer.construirLineas(contratoPorHora(), PERIODO, conceptos);

  // 800 sueldo + 150 extra = 950; 120 cuota + 38 ley = 158; neto 792.
  assert.equal(resultado.totalAsignaciones.toFixed(2), "950.00");
  assert.equal(resultado.totalDeducciones.toFixed(2), "158.00");
  assert.equal(resultado.montoTotal.toFixed(2), "792.00");
  assert.equal(resultado.totalAportePatronal.toFixed(2), "85.50");
});

// ---------------------------------------------------------------------------
// 8. Contrato sin salario
// ---------------------------------------------------------------------------

test("contrato sin salario vigente: 409 con el nombre", async () => {
  const writer = new PayrollWriter(crearDb());
  const conceptos = await writer.conceptosBase();

  await assert.rejects(
    writer.construirLineas(contratoPorHora({ monto_salario: null }), PERIODO, conceptos),
    (error) => {
      assert.ok(error instanceof ErrorNegocio);
      assert.equal(error.status, 409);
      assert.match(error.message, /Ana Pérez/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 9-10. Recálculo de ley
// ---------------------------------------------------------------------------

test("recalcularLey usa la tasa guardada y el piso del parámetro", async () => {
  const db = crearDb({ parametros: [{ id: 7, piso_base: "1000", tope_base: null }] });
  const writer = new PayrollWriter(db);

  const lineas = [
    {
      origen: "CALCULADA",
      tipoConcepto: "ASIGNACION",
      afectaBaseLey: true,
      monto: new Decimal("1200"),
    },
    {
      origen: "LEY",
      tipoConcepto: "DEDUCCION",
      afectaBaseLey: false,
      parametroId: 7,
      tasaAplicada: new Decimal("0.0400"),
      monto: new Decimal("48"),
    },
  ];

  const parametros = await writer.parametrosDeLineas(lineas);
  const [recalculada] = writer.recalcularLey(lineas, parametros);

  assert.equal(recalculada.baseCalculo.toFixed(2), "1200.00");
  assert.equal(recalculada.monto.toFixed(2), "48.00");
  assert.equal(recalculada.borrar, false);
});

test("recalcularLey con monto 0 marca la línea para borrar", async () => {
  const writer = new PayrollWriter(crearDb());

  const lineas = [
    {
      origen: "CALCULADA",
      tipoConcepto: "ASIGNACION",
      afectaBaseLey: true,
      monto: new Decimal("1"),
    },
    {
      origen: "LEY",
      tipoConcepto: "DEDUCCION",
      afectaBaseLey: false,
      parametroId: 7,
      tasaAplicada: new Decimal("0.0001"),
      monto: new Decimal("1"),
    },
  ];

  const [recalculada] = writer.recalcularLey(lineas, new Map());
  assert.equal(recalculada.monto.toFixed(2), "0.00");
  assert.equal(recalculada.borrar, true);
});

// ---------------------------------------------------------------------------
// 11. Recibo final vs borrador
// ---------------------------------------------------------------------------

test("recibo final y borrador escriben las mismas líneas y montos", async () => {
  const db = crearDb({
    horas: { horas_normales: "80", horas_extra: "10" },
  });
  const writer = new PayrollWriter(db);
  const conceptos = await writer.conceptosBase();
  const contrato = contratoPorHora();
  const { lineas, ...totales } = await writer.construirLineas(
    contrato,
    PERIODO,
    conceptos,
  );

  await writer.escribirReciboFinal(db, { periodo: PERIODO, contrato, lineas, totales });
  await writer.escribirReciboBorrador(db, {
    preNominaId: "55555555-5555-4555-8555-555555555555",
    contrato,
    lineas,
    totales,
  });

  const finales = llamadasDe(db, queries.insertDetalleRecibo).map((l) => l.params);
  const borrador = llamadasDe(db, queries.insertPreNominaDetalle).map((l) => l.params);
  // El borrador agrega `origen` (índice 2) y `editada` (último); el resto de
  // las columnas debe ser idéntico.
  const comparableFinal = (params) => params.slice(1, 10);
  const comparableBorrador = (params) => [params[1], ...params.slice(3, 11)];

  assert.equal(finales.length, 2);
  assert.equal(borrador.length, 2);
  assert.deepEqual(comparableFinal(finales[0]), comparableBorrador(borrador[0]));
  assert.equal(borrador[0][2], "CALCULADA");
  assert.equal(borrador[0][11], false);
  assert.deepEqual(comparableFinal(finales[1]), comparableBorrador(borrador[1]));
});

// ---------------------------------------------------------------------------
// 12. Regresión: Period.procesar usa el writer y escribe lo mismo
// ---------------------------------------------------------------------------

test("Period.procesar escribe recibo y detalles con los montos del writer", async () => {
  const db = crearDb({
    contratos: [contratoPorHora()],
    horas: { horas_normales: "80", horas_extra: "10" },
    cuotas: [{ id: "cuota-1", monto_cuota: "120.00" }],
  });
  const period = new Period(db, crearReq({ userID: USUARIO_ID }));

  const resultado = await period.procesar(PERIODO_ID);

  assert.equal(resultado.recibos.length, 1);
  const [recibo] = llamadasDe(db, queries.insertRecibo);
  assert.deepEqual(recibo.params, [
    PERSONA_ID,
    PERIODO_ID,
    CONTRATO_ID,
    "2031-01-07",
    "950.00",
    "120.00",
    "830.00",
  ]);

  const detalles = llamadasDe(db, queries.insertDetalleRecibo).map((l) => l.params);
  assert.equal(detalles.length, 3);
  assert.deepEqual(
    detalles.map((params) => params[9]),
    ["800.00", "150.00", "120.00"],
  );

  // El flujo de marcas no cambia: novedades por persona y cuota por línea.
  assert.equal(llamadasDe(db, queries.marcarNovedadesAplicadas).length, 1);
  assert.equal(llamadasDe(db, queries.marcarCuotaDescontada).length, 1);
  assert.equal(llamadasDe(db, queries.marcarPrestamosPagados).length, 1);
  assert.deepEqual(llamadasDe(db, queries.updatePeriodoEstado)[0].params.slice(1, 3), [
    "PROCESADO",
    USUARIO_ID,
  ]);
});
