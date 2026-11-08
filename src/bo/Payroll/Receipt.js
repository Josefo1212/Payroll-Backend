import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { personaIdDeSesion } from "./_scope.js";

export class Receipt {
  #db;

  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  #exigirRecibo = async (reciboId) => {
    if (typeof reciboId !== "string" || reciboId.trim() === "") {
      throw new ErrorNegocio("recibo_id es obligatorio.", 400);
    }
    const { rows } = await this.#db.query(queries.findReciboPorId, [reciboId]);
    const recibo = rows[0];
    if (!recibo) {
      throw new ErrorNegocio("El recibo no existe.", 404);
    }
    return recibo;
  };

  async ver(reciboId) {
    const recibo = await this.#exigirRecibo(reciboId);
    const { rows: detalle } = await this.#db.query(queries.findDetallePorRecibo, [
      recibo.id,
    ]);
    return { recibo, detalle };
  }

  async listarPorPeriodo(periodoId) {
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findRecibosPorPeriodo, [periodoId]);
    return rows;
  }

  async misRecibos() {
    const personaId = await personaIdDeSesion(this.#db, this.#req);
    const { rows } = await this.#db.query(queries.findRecibosPorPersona, [personaId]);
    return rows;
  }

  async miDesglose(reciboId) {
    const personaId = await personaIdDeSesion(this.#db, this.#req);
    const recibo = await this.#exigirRecibo(reciboId);

    if (recibo.persona_id !== personaId) {
      throw new ErrorNegocio("No autorizado para ver este recibo.", 403);
    }

    const { rows: detalle } = await this.#db.query(queries.findDetallePorRecibo, [
      recibo.id,
    ]);
    return { recibo, detalle };
  }
}
