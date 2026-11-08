import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_VALOR = new Set(["MONTO_FIJO", "PORCENTAJE_SALARIO"]);

export class Concept {
  #db;

  constructor(db) {
    this.#db = db;
  }

  #validarFecha = (fecha, campo) => {
    if (typeof fecha !== "string" || !FECHA_VALIDA.test(fecha)) {
      throw new ErrorNegocio(`${campo} debe tener formato YYYY-MM-DD.`, 400);
    }
  };

  async listar() {
    const { rows } = await this.#db.query(queries.findAllConceptos);
    return rows;
  }

  async asignarRecurrente(
    personaId,
    conceptoId,
    valor,
    vigenteDesde,
    tipoValor = "MONTO_FIJO",
    vigenteHasta = null,
    observacion = null,
  ) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }

    const idConcepto = Number(conceptoId);
    if (!Number.isInteger(idConcepto) || idConcepto <= 0) {
      throw new ErrorNegocio("concepto_id debe ser un id entero positivo.", 400);
    }

    if (!TIPOS_VALOR.has(tipoValor)) {
      throw new ErrorNegocio("tipo_valor debe ser MONTO_FIJO o PORCENTAJE_SALARIO.", 400);
    }

    const monto = Number(valor);
    if (!Number.isFinite(monto) || monto < 0) {
      throw new ErrorNegocio("El valor debe ser un número mayor o igual a cero.", 400);
    }
    if (tipoValor === "PORCENTAJE_SALARIO" && monto > 1) {
      throw new ErrorNegocio("El porcentaje se expresa como fracción (0.10 = 10%).", 400);
    }

    this.#validarFecha(vigenteDesde, "vigente_desde");
    if (vigenteHasta != null) {
      this.#validarFecha(vigenteHasta, "vigente_hasta");
      if (vigenteHasta < vigenteDesde) {
        throw new ErrorNegocio("vigente_hasta no puede ser anterior a vigente_desde.", 400);
      }
    }

    const { rows } = await this.#db.query(queries.findConceptoById, [idConcepto]);
    const concepto = rows[0];
    if (!concepto || !concepto.activo) {
      throw new ErrorNegocio("El concepto no existe o está inactivo.", 404);
    }

    try {
      const { rows: creado } = await this.#db.query(queries.insertConceptoPersona, [
        personaId,
        idConcepto,
        tipoValor,
        monto.toFixed(4),
        vigenteDesde,
        vigenteHasta,
        observacion,
      ]);
      return creado[0];
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio(
          "Ese concepto ya está asignado a la persona con la misma fecha de vigencia.",
          409,
        );
      }
      if (error?.code === "23503") {
        throw new ErrorNegocio("La persona no existe.", 400);
      }
      throw error;
    }
  }

  async quitarRecurrente(id, fechaHasta) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ErrorNegocio("El id del concepto recurrente es obligatorio.", 400);
    }
    this.#validarFecha(fechaHasta, "vigente_hasta");

    const { rows } = await this.#db.query(queries.findConceptoPersonaById, [id]);
    if (!rows[0]) {
      throw new ErrorNegocio("El concepto recurrente no existe.", 404);
    }
    if (rows[0].vigente_hasta != null) {
      throw new ErrorNegocio("El concepto recurrente ya está cerrado.", 409);
    }

    const { rows: cerrado } = await this.#db.query(queries.closeConceptoPersona, [
      id,
      fechaHasta,
    ]);
    return cerrado[0];
  }

  async listarRecurrentes(personaId) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.listarRecurrentesPorPersona, [personaId]);
    return rows;
  }
}
