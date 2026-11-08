import Decimal from "decimal.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { payrollCalculator } from "../../services/PayrollCalculator.js";
import { aFechaISO } from "./_fechas.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const FRECUENCIAS = new Set(["SEMANAL", "QUINCENAL", "MENSUAL"]);
const METODOS_PAGO = new Set(["TRANSFERENCIA", "PAGO_MOVIL", "EFECTIVO", "CHEQUE"]);

const MONEY = 2;
const TASA = 4;

export class Period {
  #db;

  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  #validarFecha = (fecha, campo) => {
    if (typeof fecha !== "string" || !FECHA_VALIDA.test(fecha)) {
      throw new ErrorNegocio(`${campo} debe tener formato YYYY-MM-DD.`, 400);
    }
  };

  #exigirPeriodo = async (periodoId, db = this.#db) => {
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_id es obligatorio.", 400);
    }
    const { rows } = await db.query(queries.findPeriodoById, [periodoId]);
    const periodo = rows[0];
    if (!periodo) {
      throw new ErrorNegocio("El período no existe.", 404);
    }
    return periodo;
  };

  #conceptosBase = async (db) => {
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

  #construirLineas = async (db, contrato, periodo, conceptos) => {
    const calc = payrollCalculator;
    const lineas = [];
    const inicio = aFechaISO(periodo.fecha_inicio);
    const fin = aFechaISO(periodo.fecha_fin);

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

    const baseLey = calc.sumar(
      lineas
        .filter((linea) => linea.afectaBaseLey && linea.tipoConcepto === "ASIGNACION")
        .map((linea) => linea.monto),
    );

    const { rows: afiliaciones } = await db.query(
      queries.findAfiliacionesVigentesPorPersona,
      [inicio, fin, contrato.persona_id],
    );

    for (const afiliacion of afiliaciones) {
      let base = baseLey;
      if (afiliacion.piso_base != null) {
        base = Decimal.max(base, calc.aDecimal(afiliacion.piso_base));
      }
      if (afiliacion.tope_base != null) {
        base = Decimal.min(base, calc.aDecimal(afiliacion.tope_base));
      }
      base = calc.redondear(base);

      const tasaEmpleado = calc.aDecimal(afiliacion.tasa_empleado);
      if (tasaEmpleado.gt(0) && afiliacion.concepto_deduccion_id) {
        agregar({
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
    const montoTotal = calc.redondear(totalAsignaciones.minus(totalDeducciones));

    return { lineas, totalAsignaciones, totalDeducciones, montoTotal };
  };

  async crear(frecuencia, fechaInicio, fechaFin, descripcion = null) {
    if (!FRECUENCIAS.has(frecuencia)) {
      throw new ErrorNegocio("frecuencia debe ser SEMANAL, QUINCENAL o MENSUAL.", 400);
    }
    this.#validarFecha(fechaInicio, "fecha_inicio");
    this.#validarFecha(fechaFin, "fecha_fin");
    if (fechaFin < fechaInicio) {
      throw new ErrorNegocio("fecha_fin no puede ser anterior a fecha_inicio.", 400);
    }

    const { rows: existentes } = await this.#db.query(queries.findPeriodoPorFechas, [
      frecuencia,
      fechaInicio,
      fechaFin,
    ]);
    if (existentes.length > 0) {
      throw new ErrorNegocio("Ya existe un período con esa frecuencia y fechas.", 409);
    }

    try {
      const { rows } = await this.#db.query(queries.insertPeriodo, [
        fechaInicio,
        fechaFin,
        frecuencia,
        descripcion,
      ]);
      return rows[0];
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio("Ya existe un período con esa frecuencia y fechas.", 409);
      }
      throw error;
    }
  }

  async procesar(periodoId) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    const periodo = await this.#exigirPeriodo(periodoId);
    if (periodo.estado !== "BORRADOR") {
      throw new ErrorNegocio("Solo se puede procesar un período en BORRADOR.", 409);
    }

    return this.#db.transaction(async (cliente) => {
      const conceptos = await this.#conceptosBase(cliente);

      const { rows: contratos } = await cliente.query(
        queries.findContratosVigentesPorFrecuencia,
        [aFechaISO(periodo.fecha_inicio), aFechaISO(periodo.fecha_fin), periodo.frecuencia],
      );

      const recibos = [];
      for (const contrato of contratos) {
        if (contrato.monto_salario == null) {
          throw new ErrorNegocio(
            `La persona ${contrato.primer_nombre} ${contrato.primer_apellido} no tiene salario vigente en el período.`,
            409,
          );
        }

        const { lineas, totalAsignaciones, totalDeducciones, montoTotal } =
          await this.#construirLineas(cliente, contrato, periodo, conceptos);

        const { rows: recibosCreados } = await cliente.query(queries.insertRecibo, [
          contrato.persona_id,
          periodo.id,
          contrato.contrato_id,
          aFechaISO(periodo.fecha_fin),
          totalAsignaciones.toFixed(MONEY),
          totalDeducciones.toFixed(MONEY),
          montoTotal.toFixed(MONEY),
        ]);
        const recibo = recibosCreados[0];

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

        await cliente.query(queries.marcarNovedadesAplicadas, [
          periodo.id,
          contrato.persona_id,
        ]);

        for (const linea of lineas) {
          if (linea.cuotaPrestamoId) {
            await cliente.query(queries.marcarCuotaDescontada, [linea.cuotaPrestamoId]);
          }
        }

        recibos.push(recibo);
      }

      await cliente.query(queries.marcarPrestamosPagados);
      const { rows: actualizado } = await cliente.query(queries.updatePeriodoEstado, [
        periodo.id,
        "PROCESADO",
        usuarioId,
        new Date(),
      ]);

      return { periodo: actualizado[0], recibos };
    });
  }

  async pagar(periodoId, fechaPago, metodoPago, referenciaPago = null, cuentaBancariaId = null) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    const periodo = await this.#exigirPeriodo(periodoId);
    if (periodo.estado !== "PROCESADO") {
      throw new ErrorNegocio("Solo se puede pagar un período PROCESADO.", 409);
    }
    this.#validarFecha(fechaPago, "fecha_pago");
    if (!METODOS_PAGO.has(metodoPago)) {
      throw new ErrorNegocio(
        "metodo_pago debe ser TRANSFERENCIA, PAGO_MOVIL, EFECTIVO o CHEQUE.",
        400,
      );
    }

    return this.#db.transaction(async (cliente) => {
      const { rows: recibos } = await cliente.query(queries.pagarRecibosPeriodo, [
        periodo.id,
        fechaPago,
        metodoPago,
        cuentaBancariaId,
        referenciaPago,
        usuarioId,
      ]);
      const { rows: actualizado } = await cliente.query(queries.updatePeriodoEstado, [
        periodo.id,
        "PAGADO",
        usuarioId,
        new Date(),
      ]);

      return {
        periodo: actualizado[0],
        recibosPagados: recibos.length,
      };
    });
  }

  async anular(periodoId) {
    const periodo = await this.#exigirPeriodo(periodoId);
    if (periodo.estado !== "PROCESADO") {
      throw new ErrorNegocio(
        "Solo se puede anular un período PROCESADO (no pagado).",
        409,
      );
    }

    return this.#db.transaction(async (cliente) => {
      await cliente.query(queries.revertirCuotasDelPeriodo, [periodo.id]);
      await cliente.query(queries.revertirNovedadesAplicadas, [periodo.id]);
      await cliente.query(queries.deleteDetallesPorPeriodo, [periodo.id]);
      const { rows: borrados } = await cliente.query(queries.deleteRecibosPorPeriodo, [
        periodo.id,
      ]);
      await cliente.query(queries.reactivarPrestamosPorCuotasPendientes);
      await cliente.query(queries.resetPeriodo, [periodo.id]);

      return {
        periodoId: periodo.id,
        estado: "BORRADOR",
        recibosEliminados: borrados.length,
      };
    });
  }

  async listar() {
    const { rows } = await this.#db.query(queries.listarPeriodos);
    return rows;
  }

  async ver(periodoId) {
    const periodo = await this.#exigirPeriodo(periodoId);
    const { rows: recibos } = await this.#db.query(queries.findRecibosPorPeriodo, [
      periodo.id,
    ]);
    return { periodo, recibos };
  }
}
