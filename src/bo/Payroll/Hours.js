import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { personaIdDeSesion } from "./_scope.js";
import { aFechaISO } from "./_fechas.js";
import { textoService } from "../../services/TextoService.js";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

const formatearFecha = (fecha) => fecha.toISOString().slice(0, 10);

export class Hours {
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

  #rangoPorDefecto = (fechaInicio, fechaFin) => {
    if (fechaInicio == null && fechaFin == null) {
      const ahora = new Date();
      const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
      const fin = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0));
      return { inicio: formatearFecha(inicio), fin: formatearFecha(fin) };
    }

    this.#validarFecha(fechaInicio, "fecha_inicio");
    this.#validarFecha(fechaFin, "fecha_fin");
    if (fechaFin < fechaInicio) {
      throw new ErrorNegocio("fecha_fin no puede ser anterior a fecha_inicio.", 400);
    }
    return { inicio: fechaInicio, fin: fechaFin };
  };

  async #exigirDiaEditable(fecha) {
    const { rows } = await this.#db.query(queries.findPeriodoNoBorradorPorFecha, [
      aFechaISO(fecha),
    ]);
    if (rows.length > 0) {
      throw new ErrorNegocio(
        "El día pertenece a un período procesado o pagado; no se puede modificar.",
        409,
      );
    }
  }

  async registrar(personaId, fecha, horasNormales, horasExtra = 0, observacion = null) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }
    this.#validarFecha(fecha, "fecha");

    const normales = Number(horasNormales ?? 0);
    const extra = Number(horasExtra ?? 0);
    if (!Number.isFinite(normales) || !Number.isFinite(extra)) {
      throw new ErrorNegocio("Las horas deben ser números.", 400);
    }
    if (normales < 0 || extra < 0) {
      throw new ErrorNegocio("Las horas no pueden ser negativas.", 400);
    }
    if (normales + extra <= 0) {
      throw new ErrorNegocio("Debe registrar al menos una hora.", 400);
    }

    const observacionLimpia = textoService.opcional(observacion, "observacion", 200);

    await this.#exigirDiaEditable(fecha);

    try {
      const { rows } = await this.#db.query(queries.insertRegistroHoras, [
        personaId,
        fecha,
        normales.toFixed(2),
        extra.toFixed(2),
        observacionLimpia,
        usuarioId,
      ]);
      return rows[0];
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio("Ya hay horas registradas para esa persona en esa fecha.", 409);
      }
      if (error?.code === "23503") {
        throw new ErrorNegocio("La persona no existe.", 400);
      }
      throw error;
    }
  }

  async registrarExtra(personaId, fecha, horasExtra, observacion = null) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }
    this.#validarFecha(fecha, "fecha");

    const extra = Number(horasExtra);
    if (!Number.isFinite(extra)) {
      throw new ErrorNegocio("Las horas extra deben ser un número.", 400);
    }
    if (extra <= 0) {
      throw new ErrorNegocio("Las horas extra deben ser mayores que cero.", 400);
    }
    if (extra > 999.99) {
      throw new ErrorNegocio("Las horas extra exceden el máximo permitido.", 400);
    }

    const observacionLimpia = textoService.opcional(observacion, "observacion", 200);

    await this.#exigirDiaEditable(fecha);

    try {
      const { rows } = await this.#db.query(queries.upsertHorasExtra, [
        personaId,
        fecha,
        extra.toFixed(2),
        observacionLimpia,
        usuarioId,
      ]);
      return rows[0];
    } catch (error) {
      if (error?.code === "23503") {
        throw new ErrorNegocio("La persona no existe.", 400);
      }
      if (error?.code === "22003") {
        throw new ErrorNegocio("Las horas extra acumuladas exceden el máximo permitido.", 400);
      }
      throw error;
    }
  }

  async listarExtrasPorPeriodo(periodoId) {
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findPeriodoById, [periodoId]);
    const periodo = rows[0];
    if (!periodo) {
      throw new ErrorNegocio("El período no existe.", 404);
    }

    const { rows: extras } = await this.#db.query(queries.findExtrasPorPeriodo, [
      aFechaISO(periodo.fecha_inicio),
      aFechaISO(periodo.fecha_fin),
    ]);
    return extras;
  }

  async quitarExtra(id) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ErrorNegocio("El id del registro es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findRegistroHorasConHoras, [id]);
    const registro = rows[0];
    if (!registro) {
      throw new ErrorNegocio("El registro de horas no existe.", 404);
    }
    if (Number(registro.horas_extra) <= 0) {
      throw new ErrorNegocio("El registro no tiene horas extra para quitar.", 409);
    }

    await this.#exigirDiaEditable(registro.fecha);

    // Si el día solo tenía extras, la fila completa deja de existir; si
    // también había horas normales, se conservan y solo se limpia la extra.
    if (Number(registro.horas_normales) <= 0) {
      await this.#db.query(queries.deleteRegistroHoras, [id]);
      return { ok: true, id, eliminado: true };
    }

    await this.#db.query(queries.updateHorasExtra, [id, "0.00"]);
    return { ok: true, id, eliminado: false };
  }

  async listarPorPersona(personaId, fechaInicio, fechaFin) {
    if (typeof personaId !== "string" || personaId.trim() === "") {
      throw new ErrorNegocio("persona_id es obligatorio.", 400);
    }
    this.#validarFecha(fechaInicio, "fecha_inicio");
    this.#validarFecha(fechaFin, "fecha_fin");
    if (fechaFin < fechaInicio) {
      throw new ErrorNegocio("fecha_fin no puede ser anterior a fecha_inicio.", 400);
    }

    const { rows } = await this.#db.query(queries.findHorasPorPersona, [
      personaId,
      fechaInicio,
      fechaFin,
    ]);
    return rows;
  }

  async listarPorPeriodo(periodoId) {
    if (typeof periodoId !== "string" || periodoId.trim() === "") {
      throw new ErrorNegocio("periodo_id es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findPeriodoById, [periodoId]);
    const periodo = rows[0];
    if (!periodo) {
      throw new ErrorNegocio("El período no existe.", 404);
    }

    const { rows: horas } = await this.#db.query(queries.findHorasPorPeriodo, [
      aFechaISO(periodo.fecha_inicio),
      aFechaISO(periodo.fecha_fin),
    ]);
    return horas;
  }

  async misHoras(fechaInicio, fechaFin) {
    const personaId = await personaIdDeSesion(this.#db, this.#req);
    const { inicio, fin } = this.#rangoPorDefecto(fechaInicio, fechaFin);

    const { rows } = await this.#db.query(queries.findHorasPorPersona, [
      personaId,
      inicio,
      fin,
    ]);
    return rows;
  }

  async eliminar(id) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ErrorNegocio("El id del registro es obligatorio.", 400);
    }

    const { rows } = await this.#db.query(queries.findRegistroHorasById, [id]);
    const registro = rows[0];
    if (!registro) {
      throw new ErrorNegocio("El registro de horas no existe.", 404);
    }

    await this.#exigirDiaEditable(registro.fecha);
    await this.#db.query(queries.deleteRegistroHoras, [id]);
    return { ok: true, id };
  }
}
