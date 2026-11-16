import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { textoService } from "../../services/TextoService.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export class Novedad {
  #db;

  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  async registrar(personaId, conceptoId, periodoId, fecha, cantidad = null, monto = null, observacion = null) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_nomina_id es obligatorio.", 400);
    }
    if (typeof fecha !== "string" || !FECHA_VALIDA.test(fecha)) {
      throw new ErrorNegocio("fecha debe tener formato YYYY-MM-DD.", 400);
    }

    const idConcepto = Number(conceptoId);
    if (!Number.isInteger(idConcepto) || idConcepto <= 0) {
      throw new ErrorNegocio("concepto_id debe ser un id entero positivo.", 400);
    }

    const cantidadNum = cantidad == null ? null : Number(cantidad);
    const montoNum = monto == null ? null : Number(monto);
    if (cantidadNum != null && (!Number.isFinite(cantidadNum) || cantidadNum < 0)) {
      throw new ErrorNegocio("cantidad debe ser un número mayor o igual a cero.", 400);
    }
    if (montoNum != null && (!Number.isFinite(montoNum) || montoNum < 0)) {
      throw new ErrorNegocio("monto debe ser un número mayor o igual a cero.", 400);
    }
    if (cantidadNum == null && montoNum == null) {
      throw new ErrorNegocio("Debe indicar cantidad o monto.", 400);
    }

    const observacionLimpia = textoService.opcional(observacion, "observacion", 200);

    const { rows: periodos } = await this.#db.query(queries.findPeriodoById, [periodoId]);
    const periodo = periodos[0];
    if (!periodo) {
      throw new ErrorNegocio("El período no existe.", 404);
    }
    if (periodo.estado !== "BORRADOR") {
      throw new ErrorNegocio("Solo se pueden registrar novedades en un período BORRADOR.", 409);
    }

    const { rows: conceptos } = await this.#db.query(queries.findConceptoById, [idConcepto]);
    const concepto = conceptos[0];
    if (!concepto || !concepto.activo) {
      throw new ErrorNegocio("El concepto no existe o está inactivo.", 404);
    }

    const { rows } = await this.#db.query(queries.insertNovedad, [
      personaId,
      idConcepto,
      periodoId,
      fecha,
      cantidadNum == null ? null : cantidadNum.toFixed(2),
      montoNum == null ? null : montoNum.toFixed(2),
      observacionLimpia,
      usuarioId,
    ]);
    return rows[0];
  }

  async aprobar(id) {
    return this.#cambiarEstado(id, "aprobarNovedad");
  }

  async rechazar(id) {
    return this.#cambiarEstado(id, "rechazarNovedad");
  }

  #cambiarEstado = async (id, consulta) => {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    if (typeof id !== "string" || id.trim() === "") {
      throw new ErrorNegocio("El id de la novedad es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries[consulta], [id, usuarioId]);
    if (!rows[0]) {
      throw new ErrorNegocio("La novedad no existe o ya fue gestionada.", 404);
    }
    return rows[0];
  };

  async listarPorPeriodo(periodoId) {
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_nomina_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findNovedadesPorPeriodo, [periodoId]);
    return rows;
  }
}
