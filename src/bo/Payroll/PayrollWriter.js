import Decimal from "decimal.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { payrollCalculator } from "../../services/PayrollCalculator.js";
import { aFechaISO } from "./_fechas.js";

const MONEY = 2;
const TASA = 4;

// Cálculo y escritura de nómina compartidos por la pre-nómina (borrador) y el
// procesamiento final. Vive fuera de `metodo`: NO es invocable por /execute.
// Sin esto, el borrador y el recibo final serían dos copias del mismo cálculo
// que tarde o temprano divergen.
export class PayrollWriter {
  #db;

  constructor(db) {
    this.#db = db;
  }

  // --- catálogo y contratos ------------------------------------------------

  conceptosBase = async (db = this.#db) => {
    const codigos = ["SUELDO_BASE", "HORA_EXTRA", "CUOTA_PRESTAMO"];
    const resultado = {};

    for (const codigo of codigos) {
      const { rows } = await db.query(queries.findConceptoByCodigo, [codigo]);
      const concepto = rows[0];
      if (!concepto) {
        throw new ErrorNegocio(
          `Falta el concepto base "${codigo}". Corre la migración 004.`,
          500,
        );
      }
      resultado[codigo] = concepto;
    }

    return resultado;
  };

  contratosDelPeriodo = async (periodo, db = this.#db) => {
    const { rows } = await db.query(queries.findContratosVigentesPorFrecuencia, [
      aFechaISO(periodo.fecha_inicio),
      aFechaISO(periodo.fecha_fin),
      periodo.frecuencia,
    ]);
    return rows;
  };

  // --- cálculo -------------------------------------------------------------

  // Port literal del antiguo Period.#construirLineas. Cada línea lleva `origen`
  // para que el borrador sepa de dónde salió y si es editable.
  construirLineas = async (contrato, periodo, conceptos, db = this.#db) => {
    const calc = payrollCalculator;
    const lineas = [];
    const inicio = aFechaISO(periodo.fecha_inicio);
    const fin = aFechaISO(periodo.fecha_fin);

    if (contrato.monto_salario == null) {
      throw new ErrorNegocio(
        `La persona ${contrato.primer_nombre} ${contrato.primer_apellido} no tiene salario vigente en el período.`,
        409,
      );
    }

    const agregar = (linea) => {
      if (linea.monto.gt(0)) {
        lineas.push(linea);
      }
    };

    const { rows: horasRows } = await db.query(queries.sumaHorasPorPersonaPeriodo, [
      contrato.persona_id,
      inicio,
      fin,
    ]);
    const horasNormales = calc.aDecimal(horasRows[0]?.horas_normales ?? 0);
    const horasExtra = calc.aDecimal(horasRows[0]?.horas_extra ?? 0);

    const montoSalario = calc.aDecimal(contrato.monto_salario);
    const esPorHora = contrato.tipo_pago === "POR_HORA";

    const valorHora = esPorHora
      ? montoSalario
      : calc.valorHoraFijo(montoSalario);

    const sueldoBase = esPorHora
      ? calc.redondear(valorHora.times(horasNormales))
      : calc.sueldoPeriodo(montoSalario, contrato.frecuencia_pago);

    agregar({
      origen: "CALCULADA",
      conceptoId: conceptos.SUELDO_BASE.id,
      tipoConcepto: "ASIGNACION",
      categoria: "AJUSTE",
      afectaBaseLey: true,
      monto: sueldoBase,
      cantidadUnidades: esPorHora ? Number(horasNormales) : null,
      baseCalculo: null,
      tasaAplicada: null,
      novedadId: null,
      conceptoPersonaId: null,
      cuotaPrestamoId: null,
      parametroId: null,
    });

    if (horasExtra.gt(0)) {
      const valorExtra = calc.valorHoraExtra(valorHora);
      agregar({
        origen: "CALCULADA",
        conceptoId: conceptos.HORA_EXTRA.id,
        tipoConcepto: "ASIGNACION",
        categoria: "HORA_EXTRA",
        afectaBaseLey: true,
        monto: calc.redondear(valorExtra.times(horasExtra)),
        cantidadUnidades: Number(horasExtra),
        baseCalculo: valorHora,
        tasaAplicada: calc.aDecimal(calc.RECARGO_HORA_EXTRA),
        novedadId: null,
        conceptoPersonaId: null,
        cuotaPrestamoId: null,
        parametroId: null,
      });
    }

    const { rows: recurrentes } = await db.query(
      queries.findRecurrentesVigentesPorPersona,
      [contrato.persona_id, inicio, fin],
    );

    for (const recurrente of recurrentes) {
      const valor = calc.aDecimal(recurrente.valor);
      const monto =
        recurrente.tipo_valor === "PORCENTAJE_SALARIO"
          ? calc.redondear(sueldoBase.times(valor))
          : calc.redondear(valor);

      agregar({
        origen: "RECURRENTE",
        conceptoId: recurrente.concepto_id,
        tipoConcepto: recurrente.tipo_concepto,
        categoria: recurrente.categoria,
        afectaBaseLey: recurrente.afecta_base_ley,
        monto,
        cantidadUnidades: null,
        baseCalculo: recurrente.tipo_valor === "PORCENTAJE_SALARIO" ? sueldoBase : null,
        tasaAplicada:
          recurrente.tipo_valor === "PORCENTAJE_SALARIO" ? valor : null,
        novedadId: null,
        conceptoPersonaId: recurrente.id,
        cuotaPrestamoId: null,
        parametroId: null,
      });
    }

    const { rows: novedades } = await db.query(
      queries.findNovedadesAprobadasPorPersona,
      [contrato.persona_id, periodo.id],
    );

    for (const novedad of novedades) {
      let monto;
      if (novedad.monto != null) {
        monto = calc.redondear(novedad.monto);
      } else if (novedad.cantidad != null) {
        const tarifa =
          novedad.categoria === "HORA_EXTRA"
            ? calc.valorHoraExtra(valorHora)
            : valorHora;
        monto = calc.redondear(tarifa.times(calc.aDecimal(novedad.cantidad)));
      } else {
        continue;
      }

      agregar({
        origen: "NOVEDAD",
        conceptoId: novedad.concepto_id,
        tipoConcepto: novedad.tipo_concepto,
        categoria: novedad.categoria,
        afectaBaseLey: novedad.afecta_base_ley,
        monto,
        cantidadUnidades: novedad.cantidad == null ? null : Number(novedad.cantidad),
        baseCalculo: null,
        tasaAplicada: null,
        novedadId: novedad.id,
        conceptoPersonaId: null,
        cuotaPrestamoId: null,
        parametroId: null,
      });
    }

    const { rows: cuotas } = await db.query(queries.findCuotasPendientesPorPersona, [
      contrato.persona_id,
      fin,
    ]);

    for (const cuota of cuotas) {
      agregar({
        origen: "PRESTAMO",
        conceptoId: conceptos.CUOTA_PRESTAMO.id,
        tipoConcepto: "DEDUCCION",
        categoria: "PRESTAMO",
        afectaBaseLey: false,
        monto: calc.redondear(cuota.monto_cuota),
        cantidadUnidades: null,
        baseCalculo: null,
        tasaAplicada: null,
        novedadId: null,
        conceptoPersonaId: null,
        cuotaPrestamoId: cuota.id,
        parametroId: null,
      });
    }

    const baseLey = this.baseLeyDe(lineas);

    const { rows: afiliaciones } = await db.query(
      queries.findAfiliacionesVigentesPorPersona,
      [inicio, fin, contrato.persona_id],
    );

    for (const afiliacion of afiliaciones) {
      const base = this.acotarBase(baseLey, afiliacion);

      const tasaEmpleado = calc.aDecimal(afiliacion.tasa_empleado);
      if (tasaEmpleado.gt(0) && afiliacion.concepto_deduccion_id) {
        agregar({
          origen: "LEY",
          conceptoId: afiliacion.concepto_deduccion_id,
          tipoConcepto: "DEDUCCION",
          categoria: "LEY",
          afectaBaseLey: false,
          monto: calc.redondear(base.times(tasaEmpleado)),
          cantidadUnidades: null,
          baseCalculo: base,
          tasaAplicada: tasaEmpleado,
          novedadId: null,
          conceptoPersonaId: null,
          cuotaPrestamoId: null,
          parametroId: afiliacion.parametro_id,
        });
      }

      const tasaPatronal = calc.aDecimal(afiliacion.tasa_patronal);
      if (tasaPatronal.gt(0) && afiliacion.concepto_patronal_id) {
        agregar({
          origen: "LEY",
          conceptoId: afiliacion.concepto_patronal_id,
          tipoConcepto: "APORTE_PATRONAL",
          categoria: "LEY",
          afectaBaseLey: false,
          monto: calc.redondear(base.times(tasaPatronal)),
          cantidadUnidades: null,
          baseCalculo: base,
          tasaAplicada: tasaPatronal,
          novedadId: null,
          conceptoPersonaId: null,
          cuotaPrestamoId: null,
          parametroId: afiliacion.parametro_id,
        });
      }
    }

    return { lineas, ...this.calcularTotales(lineas) };
  };

  // Base de ley = asignaciones que la afectan. Los aportes patronales y las
  // deducciones quedan fuera.
  baseLeyDe = (lineas) =>
    payrollCalculator.sumar(
      lineas
        .filter((linea) => linea.afectaBaseLey && linea.tipoConcepto === "ASIGNACION")
        .map((linea) => linea.monto),
    );

  // El piso/tope es del parámetro, no de la persona: cada ley acota la base a
  // su manera (el SS tiene tope, el paro forzoso otro).
  acotarBase = (base, { piso_base: piso, tope_base: tope } = {}) => {
    const calc = payrollCalculator;
    let acotada = base;
    if (piso != null) {
      acotada = Decimal.max(acotada, calc.aDecimal(piso));
    }
    if (tope != null) {
      acotada = Decimal.min(acotada, calc.aDecimal(tope));
    }
    return calc.redondear(acotada);
  };

  // APORTE_PATRONAL es costo del patrono: no suma al neto ni a deducciones.
  calcularTotales = (lineas) => {
    const calc = payrollCalculator;
    const totalAsignaciones = calc.sumar(
      lineas
        .filter((linea) => linea.tipoConcepto === "ASIGNACION")
        .map((linea) => linea.monto),
    );
    const totalDeducciones = calc.sumar(
      lineas
        .filter((linea) => linea.tipoConcepto === "DEDUCCION")
        .map((linea) => linea.monto),
    );
    const totalAportePatronal = calc.sumar(
      lineas
        .filter((linea) => linea.tipoConcepto === "APORTE_PATRONAL")
        .map((linea) => linea.monto),
    );

    return {
      totalAsignaciones,
      totalDeducciones,
      totalAportePatronal,
      montoTotal: calc.redondear(totalAsignaciones.minus(totalDeducciones)),
    };
  };

  // Parámetros de ley que usan las líneas del recibo (para el recálculo).
  parametrosDeLineas = async (lineas, db = this.#db) => {
    const ids = [
      ...new Set(
        lineas
          .filter((linea) => linea.origen === "LEY" && linea.parametroId != null)
          .map((linea) => linea.parametroId),
      ),
    ];
    if (ids.length === 0) {
      return new Map();
    }

    const { rows } = await db.query(queries.findParametrosAportePorIds, [ids]);
    return new Map(rows.map((fila) => [fila.id, fila]));
  };

  // Recalcula las líneas de ley con la tasa CONGELADA en el borrador y el
  // piso/tope del parámetro guardado. Si el monto baja a 0 la línea se marca
  // `borrar`: el CHECK exige monto > 0, nunca se escribe 0.
  recalcularLey = (lineas, parametrosPorId = new Map()) => {
    const calc = payrollCalculator;
    const baseLey = this.baseLeyDe(lineas);

    return lineas
      .filter((linea) => linea.origen === "LEY" && linea.tasaAplicada != null)
      .map((linea) => {
        const parametro = parametrosPorId.get(linea.parametroId);
        const base = this.acotarBase(baseLey, parametro ?? {});
        const monto = calc.redondear(base.times(calc.aDecimal(linea.tasaAplicada)));
        return {
          ...linea,
          baseCalculo: base,
          monto,
          borrar: monto.lte(0),
        };
      });
  };

  // --- escritura -----------------------------------------------------------

  // Recibo final: `detalle_recibo` no guarda `origen`, así que se ignora.
  escribirReciboFinal = async (cliente, { periodo, contrato, lineas, totales }) => {
    const { rows } = await cliente.query(queries.insertRecibo, [
      contrato.persona_id,
      periodo.id,
      contrato.contrato_id,
      aFechaISO(periodo.fecha_fin),
      totales.totalAsignaciones.toFixed(MONEY),
      totales.totalDeducciones.toFixed(MONEY),
      totales.montoTotal.toFixed(MONEY),
    ]);
    const recibo = rows[0];

    for (const linea of lineas) {
      await cliente.query(queries.insertDetalleRecibo, [
        recibo.id,
        linea.conceptoId,
        linea.cuotaPrestamoId,
        linea.novedadId,
        linea.conceptoPersonaId,
        linea.parametroId,
        linea.baseCalculo == null ? null : linea.baseCalculo.toFixed(MONEY),
        linea.tasaAplicada == null ? null : linea.tasaAplicada.toFixed(TASA),
        linea.cantidadUnidades,
        linea.monto.toFixed(MONEY),
      ]);
    }

    return recibo;
  };

  // Recibo del borrador: guarda además `origen` (de dónde salió) y `editada`
  // (si RRHH la ajustó a mano).
  escribirReciboBorrador = async (
    cliente,
    { preNominaId, contrato, lineas, totales },
  ) => {
    const { rows } = await cliente.query(queries.insertPreNominaRecibo, [
      preNominaId,
      contrato.persona_id,
      contrato.contrato_id,
      totales.totalAsignaciones.toFixed(MONEY),
      totales.totalDeducciones.toFixed(MONEY),
      totales.montoTotal.toFixed(MONEY),
    ]);
    const recibo = rows[0];

    for (const linea of lineas) {
      await cliente.query(queries.insertPreNominaDetalle, [
        recibo.id,
        linea.conceptoId,
        linea.origen,
        linea.cuotaPrestamoId,
        linea.novedadId,
        linea.conceptoPersonaId,
        linea.parametroId,
        linea.baseCalculo == null ? null : linea.baseCalculo.toFixed(MONEY),
        linea.tasaAplicada == null ? null : linea.tasaAplicada.toFixed(TASA),
        linea.cantidadUnidades,
        linea.monto.toFixed(MONEY),
        linea.editada ?? false,
      ]);
    }

    return recibo;
  };
}
