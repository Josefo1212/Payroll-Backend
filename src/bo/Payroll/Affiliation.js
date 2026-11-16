import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { textoService } from "../../services/TextoService.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export class Affiliation {
  #db;

  constructor(db) {
    this.#db = db;
  }

  #validarFecha = (fecha, campo) => {
    if (typeof fecha !== "string" || !FECHA_VALIDA.test(fecha)) {
      throw new ErrorNegocio(`${campo} debe tener formato YYYY-MM-DD.`, 400);
    }
  };

  async registrar(personaId, tipoAporteId, nroAfiliacion, fechaInscripcion) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }

    const idTipo = Number(tipoAporteId);
    if (!Number.isInteger(idTipo) || idTipo <= 0) {
      throw new ErrorNegocio("tipo_aporte_id debe ser un id entero positivo.", 400);
    }

    const nroLimpio = textoService.requerido(nroAfiliacion, "nro_afiliacion", 30);

    this.#validarFecha(fechaInscripcion, "fecha_inscripcion");

    const { rows: tipos } = await this.#db.query(queries.findTipoAporteById, [idTipo]);
    if (!tipos[0]) {
      throw new ErrorNegocio("El tipo de aporte de ley no existe.", 404);
    }

    try {
      const { rows } = await this.#db.query(queries.insertAfiliacion, [
        personaId,
        idTipo,
        nroLimpio,
        fechaInscripcion,
      ]);
      return rows[0];
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio(
          "La persona ya está afiliada a ese tipo de aporte de ley.",
          409,
        );
      }
      if (error?.code === "23503") {
        throw new ErrorNegocio("La persona no existe.", 400);
      }
      throw error;
    }
  }

  async listar(personaId) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.listarAfiliacionesPorPersona, [
      personaId,
    ]);
    return rows;
  }

  async darDeBaja(afiliacionId, fechaBaja) {
    if (typeof afiliacionId !== "string" || afiliacionId.trim() === "") {
      throw new ErrorNegocio("El id de la afiliación es obligatorio.", 400);
    }
    this.#validarFecha(fechaBaja, "fecha_baja");

    const { rows } = await this.#db.query(queries.darDeBajaAfiliacion, [
      afiliacionId,
      fechaBaja,
    ]);
    if (!rows[0]) {
      throw new ErrorNegocio("La afiliación no existe o ya está dada de baja.", 404);
    }
    return rows[0];
  }
}
