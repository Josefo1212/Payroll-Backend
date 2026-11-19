import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { esGestorNomina, personaIdDeSesion } from "./_scope.js";
import { reciboPdfService } from "../../services/ReciboPdfService.js";

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

  // El PDF se genera en memoria y viaja por /execute: el cliente no necesita
  // otra ruta ni otro permiso. El gestor descarga cualquiera; el empleado solo
  // el propio, y esa pertenencia se valida acá, no en el mapa de permisos.
  async generarPdf(reciboId) {
    const recibo = await this.#exigirRecibo(reciboId);

    if (!esGestorNomina(this.#req)) {
      const personaId = await personaIdDeSesion(this.#db, this.#req);
      if (recibo.persona_id !== personaId) {
        throw new ErrorNegocio("No autorizado para ver este recibo.", 403);
      }
    }

    const { rows: detalle } = await this.#db.query(queries.findDetallePorRecibo, [
      recibo.id,
    ]);
    const contenido = await reciboPdfService.generar(recibo, detalle);

    return {
      nombreArchivo: reciboPdfService.nombreArchivo(recibo),
      mimeType: "application/pdf",
      tamanioBytes: contenido.length,
      contenidoBase64: contenido.toString("base64"),
    };
  }
}
