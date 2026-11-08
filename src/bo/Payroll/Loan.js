import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { payrollCalculator } from "../../services/PayrollCalculator.js";
import { personaIdDeSesion } from "./_scope.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

const formatearFecha = (fecha) => fecha.toISOString().slice(0, 10);

export class Loan {
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

  #vencimiento = (fechaOtorgamiento, frecuencia, numeroCuota) => {
    const base = new Date(`${fechaOtorgamiento}T00:00:00Z`);
    if (frecuencia === "SEMANAL") {
      base.setUTCDate(base.getUTCDate() + 7 * numeroCuota);
    } else if (frecuencia === "QUINCENAL") {
      base.setUTCDate(base.getUTCDate() + 15 * numeroCuota);
    } else if (frecuencia === "MENSUAL") {
      base.setUTCMonth(base.getUTCMonth() + numeroCuota);
    } else {
      throw new ErrorNegocio(`Frecuencia de pago desconocida: ${frecuencia}.`, 400);
    }
    return formatearFecha(base);
  };

  async crear(personaId, fechaOtorgamiento, montoTotal, nroCuotas, tasaInteres = 0) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }
    this.#validarFecha(fechaOtorgamiento, "fecha_otorgamiento");

    const monto = Number(montoTotal);
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new ErrorNegocio("monto_total debe ser un número mayor que cero.", 400);
    }

    const cuotas = Number(nroCuotas);
    if (!Number.isInteger(cuotas) || cuotas <= 0 || cuotas > 120) {
      throw new ErrorNegocio("nro_cuotas debe ser un entero entre 1 y 120.", 400);
    }

    const tasa = Number(tasaInteres ?? 0);
    if (!Number.isFinite(tasa) || tasa < 0 || tasa > 1) {
      throw new ErrorNegocio("tasa_interes se expresa como fracción (0.10 = 10%).", 400);
    }

    const { rows: contratos } = await this.#db.query(
      queries.findContratoVigentePorPersona,
      [personaId],
    );
    const contrato = contratos[0];
    if (!contrato) {
      throw new ErrorNegocio("La persona no tiene un contrato vigente.", 404);
    }

    const { cuotas: distribucion } = payrollCalculator.armarCuotas(monto, tasa, cuotas);
    const cuotaPeriodica = distribucion[0].montoCuota;

    return this.#db.transaction(async (cliente) => {
      const { rows: prestamos } = await cliente.query(queries.insertPrestamo, [
        personaId,
        fechaOtorgamiento,
        monto.toFixed(2),
        cuotas,
        cuotaPeriodica,
        tasa.toFixed(4),
        usuarioId,
      ]);
      const prestamo = prestamos[0];

      const detalleCuotas = [];
      for (const cuota of distribucion) {
        const vencimiento = this.#vencimiento(
          fechaOtorgamiento,
          contrato.frecuencia_pago,
          cuota.nroCuota,
        );
        const { rows } = await cliente.query(queries.insertCuotaPrestamo, [
          prestamo.id,
          cuota.nroCuota,
          vencimiento,
          cuota.montoCapital,
          cuota.montoInteres,
          cuota.montoCuota,
        ]);
        detalleCuotas.push({ ...cuota, id: rows[0].id, fechaVencimiento: vencimiento });
      }

      return { prestamo, cuotas: detalleCuotas };
    });
  }

  async listar(personaId) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findPrestamosPorPersona, [personaId]);
    return rows;
  }

  async saldos(prestamoId) {
    if (typeof prestamoId !== "string" || prestamoId.trim() === "") {
      throw new ErrorNegocio("prestamo_id es obligatorio.", 400);
    }

    const { rows: prestamos } = await this.#db.query(queries.findPrestamoById, [prestamoId]);
    if (!prestamos[0]) {
      throw new ErrorNegocio("El préstamo no existe.", 404);
    }

    const { rows } = await this.#db.query(queries.saldoPrestamo, [prestamoId]);
    return {
      prestamoId,
      cuotasPendientes: Number(rows[0].cuotas_pendientes),
      saldoPendiente: rows[0].saldo_pendiente,
    };
  }

  async anular(prestamoId) {
    if (typeof prestamoId !== "string" || prestamoId.trim() === "") {
      throw new ErrorNegocio("prestamo_id es obligatorio.", 400);
    }

    const { rows: prestamos } = await this.#db.query(queries.findPrestamoById, [prestamoId]);
    const prestamo = prestamos[0];
    if (!prestamo) {
      throw new ErrorNegocio("El préstamo no existe.", 404);
    }
    if (!["SOLICITADO", "ACTIVO"].includes(prestamo.estado)) {
      throw new ErrorNegocio("Solo se pueden anular préstamos solicitados o activos.", 409);
    }

    const { rows: descontadas } = await this.#db.query(
      queries.contarCuotasDescontadas,
      [prestamoId],
    );
    if (Number(descontadas[0].descontadas) > 0) {
      throw new ErrorNegocio("No se puede anular un préstamo con cuotas ya descontadas.", 409);
    }

    const { rows } = await this.#db.query(queries.anularPrestamo, [prestamoId]);
    return rows[0];
  }

  async misPrestamos() {
    const personaId = await personaIdDeSesion(this.#db, this.#req);
    return this.listar(personaId);
  }
}
