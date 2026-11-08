import Decimal from "decimal.js";

const HORAS_MENSUALES = new Decimal(240);
const RECARGO_HORA_EXTRA = new Decimal("1.5");

class PayrollCalculator {
  HORAS_MENSUALES = HORAS_MENSUALES;

  RECARGO_HORA_EXTRA = RECARGO_HORA_EXTRA;

  aDecimal = (valor) => new Decimal(valor ?? 0);

  redondear = (valor) =>
    this.aDecimal(valor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  sumar = (valores = []) =>
    this.redondear(
      valores.reduce((total, valor) => total.plus(this.aDecimal(valor)), new Decimal(0)),
    );

  multiplicar = (a, b) => this.redondear(this.aDecimal(a).times(this.aDecimal(b)));

  dividir = (a, b) => this.redondear(this.aDecimal(a).dividedBy(this.aDecimal(b)));

  valorHoraFijo = (salarioMensual) =>
    this.redondear(this.aDecimal(salarioMensual).dividedBy(HORAS_MENSUALES));

  valorHoraExtra = (valorHora) =>
    this.redondear(this.aDecimal(valorHora).times(RECARGO_HORA_EXTRA));

  factorFrecuencia = (frecuencia) => {
    if (frecuencia === "MENSUAL") {
      return new Decimal(1);
    }
    if (frecuencia === "QUINCENAL") {
      return new Decimal(1).dividedBy(2);
    }
    if (frecuencia === "SEMANAL") {
      return new Decimal(12).dividedBy(52);
    }
    throw new Error(`Frecuencia de pago desconocida: ${frecuencia}`);
  };

  sueldoPeriodo = (salarioMensual, frecuencia) =>
    this.redondear(this.aDecimal(salarioMensual).times(this.factorFrecuencia(frecuencia)));

  armarCuotas = (montoTotal, tasaInteres, nroCuotas) => {
    const n = Number(nroCuotas);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error("El número de cuotas debe ser un entero positivo.");
    }

    const capital = this.redondear(montoTotal);
    const interesTotal = this.redondear(capital.times(this.aDecimal(tasaInteres)));
    const totalPagar = this.redondear(capital.plus(interesTotal));
    const capitalCuota = this.redondear(capital.dividedBy(n));
    const interesCuota = this.redondear(interesTotal.dividedBy(n));

    const cuotas = [];
    let capitalAcumulado = new Decimal(0);
    let interesAcumulado = new Decimal(0);

    for (let numero = 1; numero <= n; numero += 1) {
      const esUltima = numero === n;
      const montoCapital = esUltima
        ? this.redondear(capital.minus(capitalAcumulado))
        : capitalCuota;
      const montoInteres = esUltima
        ? this.redondear(interesTotal.minus(interesAcumulado))
        : interesCuota;

      capitalAcumulado = capitalAcumulado.plus(montoCapital);
      interesAcumulado = interesAcumulado.plus(montoInteres);

      cuotas.push({
        nroCuota: numero,
        montoCapital: montoCapital.toFixed(2),
        montoInteres: montoInteres.toFixed(2),
        montoCuota: this.redondear(montoCapital.plus(montoInteres)).toFixed(2),
      });
    }

    return {
      cuotas,
      interesTotal: interesTotal.toFixed(2),
      totalPagar: totalPagar.toFixed(2),
    };
  };
}

export { PayrollCalculator };
export const payrollCalculator = new PayrollCalculator();
