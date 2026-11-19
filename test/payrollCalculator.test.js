import { test } from "node:test";
import assert from "node:assert/strict";
import { PayrollCalculator } from "../src/services/PayrollCalculator.js";

const calc = new PayrollCalculator();

test("240 horas mensuales y recargo de hora extra x1.5", () => {
  assert.equal(calc.HORAS_MENSUALES.toString(), "240");
  assert.equal(calc.RECARGO_HORA_EXTRA.toString(), "1.5");
  assert.equal(calc.valorHoraFijo("12000").toFixed(2), "50.00");
  assert.equal(calc.valorHoraExtra("50").toFixed(2), "75.00");
});

test("sueldo del período por frecuencia", () => {
  assert.equal(calc.sueldoPeriodo("30000", "MENSUAL").toFixed(2), "30000.00");
  assert.equal(calc.sueldoPeriodo("30000", "QUINCENAL").toFixed(2), "15000.00");
  assert.equal(calc.sueldoPeriodo("30000", "SEMANAL").toFixed(2), "6923.08");
  assert.equal(calc.sueldoPeriodo("12000", "SEMANAL").toFixed(2), "2769.23");
  assert.throws(() => calc.sueldoPeriodo("30000", "DIARIO"), /Frecuencia/);
});

test("cuotas con interés simple plano", () => {
  const { cuotas, interesTotal, totalPagar } = calc.armarCuotas("10000", "0.10", 4);
  assert.equal(interesTotal, "1000.00");
  assert.equal(totalPagar, "11000.00");
  assert.deepEqual(
    cuotas.map((cuota) => cuota.montoCuota),
    ["2750.00", "2750.00", "2750.00", "2750.00"],
  );
});

test("la última cuota absorbe el redondeo del capital", () => {
  const { cuotas } = calc.armarCuotas("100", 0, 3);
  assert.deepEqual(
    cuotas.map((cuota) => cuota.montoCapital),
    ["33.33", "33.33", "33.34"],
  );
  const sumaCapital = cuotas.reduce(
    (total, cuota) => total + Number(cuota.montoCapital),
    0,
  );
  assert.equal(sumaCapital.toFixed(2), "100.00");
});

test("la última cuota absorbe el redondeo del interés", () => {
  const { cuotas, interesTotal } = calc.armarCuotas("100", "0.10", 3);
  assert.equal(interesTotal, "10.00");
  assert.deepEqual(
    cuotas.map((cuota) => cuota.montoCuota),
    ["36.66", "36.66", "36.68"],
  );
  const sumaCuotas = cuotas.reduce(
    (total, cuota) => total + Number(cuota.montoCuota),
    0,
  );
  assert.equal(sumaCuotas.toFixed(2), "110.00");
});

test("número de cuotas inválido", () => {
  assert.throws(() => calc.armarCuotas("100", 0, 0), /entero positivo/);
  assert.throws(() => calc.armarCuotas("100", 0, 1.5), /entero positivo/);
});

test("suma y multiplicación redondean a dos decimales", () => {
  assert.equal(calc.sumar(["0.10", "0.20"]).toFixed(2), "0.30");
  assert.equal(calc.multiplicar("575", "0.005").toFixed(2), "2.88");
  assert.equal(calc.dividir("10", "3").toFixed(2), "3.33");
});

test("sueldo proporcional: contrato completo no se prorratea", () => {
  const monto = calc.sueldoPeriodoProporcional("2600", "SEMANAL", {
    inicioPeriodo: "2031-01-01",
    finPeriodo: "2031-01-07",
    inicioContrato: "2031-01-01",
    finContrato: null,
  });
  assert.equal(monto.toFixed(2), "600.00");
});

test("sueldo proporcional: despido a mitad de período paga los días trabajados", () => {
  // Semana de 7 días, contrato hasta el día 4 → 4/7 del sueldo semanal.
  const monto = calc.sueldoPeriodoProporcional("2600", "SEMANAL", {
    inicioPeriodo: "2031-01-01",
    finPeriodo: "2031-01-07",
    inicioContrato: "2030-06-01",
    finContrato: "2031-01-04",
  });
  assert.equal(monto.toFixed(2), "342.86");
});

test("sueldo proporcional: alta a mitad de período paga desde el inicio", () => {
  // Días 5, 6 y 7 de una semana de 7 → 3/7.
  const monto = calc.sueldoPeriodoProporcional("2600", "SEMANAL", {
    inicioPeriodo: "2031-01-01",
    finPeriodo: "2031-01-07",
    inicioContrato: "2031-01-05",
    finContrato: null,
  });
  assert.equal(monto.toFixed(2), "257.14");
});

test("sueldo proporcional: sin fechas de contrato devuelve el período completo", () => {
  const monto = calc.sueldoPeriodoProporcional("1200", "MENSUAL", {
    inicioPeriodo: "2031-01-01",
    finPeriodo: "2031-01-31",
  });
  assert.equal(monto.toFixed(2), "1200.00");
});
