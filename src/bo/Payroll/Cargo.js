import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

export class Cargo {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async actualizarValorHora(cargoId, valorHora) {
    const id = Number(cargoId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorNegocio("El cargo debe ser un id entero positivo.", 400);
    }

    const monto = Number(valorHora);
    if (!Number.isFinite(monto) || monto < 0) {
      throw new ErrorNegocio("El valor de la hora debe ser un número mayor o igual a cero.", 400);
    }

    const { rows } = await this.#db.query(queries.findCargoById, [id]);
    const cargo = rows[0];
    if (!cargo || !cargo.activo) {
      throw new ErrorNegocio("El cargo no existe o está inactivo.", 404);
    }

    const { rows: actualizados } = await this.#db.query(queries.updateCargoValorHora, [
      monto.toFixed(2),
      id,
    ]);

    return actualizados[0];
  }

  async listarCargosTarifa() {
    const { rows } = await this.#db.query(queries.findAllCargosTarifa);
    return rows;
  }
}
