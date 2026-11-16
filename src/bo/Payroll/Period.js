import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { PayrollWriter } from "./PayrollWriter.js";
import { textoService } from "../../services/TextoService.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const FRECUENCIAS = new Set(["SEMANAL", "QUINCENAL", "MENSUAL"]);
const METODOS_PAGO = new Set(["TRANSFERENCIA", "PAGO_MOVIL", "EFECTIVO", "CHEQUE"]);

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

  async crear(frecuencia, fechaInicio, fechaFin, descripcion = null) {
    if (!FRECUENCIAS.has(frecuencia)) {
      throw new ErrorNegocio("frecuencia debe ser SEMANAL, QUINCENAL o MENSUAL.", 400);
    }
    this.#validarFecha(fechaInicio, "fecha_inicio");
    this.#validarFecha(fechaFin, "fecha_fin");
    if (fechaFin < fechaInicio) {
      throw new ErrorNegocio("fecha_fin no puede ser anterior a fecha_inicio.", 400);
    }

    const descripcionLimpia = textoService.opcional(descripcion, "descripcion", 200);

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
        descripcionLimpia,
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
    await this.#exigirPeriodo(periodoId);

    return this.#db.transaction(async (cliente) => {
      // Bloquea el período: procesar y confirmar se serializan sobre la misma
      // fila para que no convivan borrador y recibo final.
      const { rows: bloqueados } = await cliente.query(
        queries.findPeriodoByIdForUpdate,
        [periodoId],
      );
      const periodo = bloqueados[0];
      if (!periodo) {
        throw new ErrorNegocio("El período no existe.", 404);
      }
      if (periodo.estado !== "BORRADOR") {
        throw new ErrorNegocio("Solo se puede procesar un período en BORRADOR.", 409);
      }

      // Un borrador sin confirmar tiene ediciones que el recibo final
      // ignoraría; primero se confirma o se elimina.
      const { rows: borradores } = await cliente.query(
        queries.findPreNominaByPeriodo,
        [periodo.id],
      );
      if (borradores.length > 0) {
        throw new ErrorNegocio(
          "El período tiene una pre-nómina sin confirmar; confírmala o elimínala antes de procesar.",
          409,
        );
      }

      const writer = new PayrollWriter(cliente);
      const conceptos = await writer.conceptosBase();
      const contratos = await writer.contratosDelPeriodo(periodo);

      const recibos = [];
      for (const contrato of contratos) {
        const { lineas, ...totales } = await writer.construirLineas(
          contrato,
          periodo,
          conceptos,
        );

        const recibo = await writer.escribirReciboFinal(cliente, {
          periodo,
          contrato,
          lineas,
          totales,
        });

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

    const referenciaLimpia = textoService.opcional(referenciaPago, "referencia_pago", 60);

    return this.#db.transaction(async (cliente) => {
      const { rows: recibos } = await cliente.query(queries.pagarRecibosPeriodo, [
        periodo.id,
        fechaPago,
        metodoPago,
        cuentaBancariaId,
        referenciaLimpia,
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
    // Se agregan en camelCase para el front; el resto de la fila queda igual.
    return rows.map((fila) => ({
      ...fila,
      preNominaId: fila.pre_nomina_id ?? null,
      preNominaVersion: fila.pre_nomina_version ?? null,
    }));
  }

  async ver(periodoId) {
    const periodo = await this.#exigirPeriodo(periodoId);
    const { rows: recibos } = await this.#db.query(queries.findRecibosPorPeriodo, [
      periodo.id,
    ]);
    const preNomina = periodo.pre_nomina_id
      ? { id: periodo.pre_nomina_id, version: periodo.pre_nomina_version }
      : null;
    return { periodo, recibos, preNomina };
  }
}
