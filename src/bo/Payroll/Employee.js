import { queries } from "./loader.js";
import { queries as sessionQueries } from "../Session/loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { textoService } from "../../services/TextoService.js";
import { usuarioIdDeSesion } from "./_scope.js";
import { aFechaISO, esFechaISOValida } from "./_fechas.js";

const ESTADOS = new Set(["ACTIVO", "INACTIVO", "TODOS"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registro laboral: personas con su contrato y su despido. El despido es la
// única operación que escribe, y lo hace en una transacción que deja el
// sistema coherente (contrato, persona, usuario, tokens y sesiones).
export class Employee {
  #db;

  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  #exigirPersonaId = (personaId) => {
    if (typeof personaId !== "string" || !UUID.test(personaId.trim())) {
      throw new ErrorNegocio("persona_id debe ser un UUID válido.", 400);
    }
    return personaId.trim();
  };

  #exigirPersona = async (personaId) => {
    const { rows } = await this.#db.query(queries.findPersonaRegistro, [personaId]);
    const persona = rows[0];
    if (!persona) {
      throw new ErrorNegocio("La persona no existe.", 404);
    }
    return persona;
  };

  async listar(estado = "TODOS") {
    const filtro = estado ?? "TODOS";
    if (!ESTADOS.has(filtro)) {
      throw new ErrorNegocio("estado debe ser ACTIVO, INACTIVO o TODOS.", 400);
    }
    const { rows } = await this.#db.query(queries.listarPersonasRegistro, [filtro]);
    return rows;
  }

  async ver(personaId) {
    const id = this.#exigirPersonaId(personaId);
    const persona = await this.#exigirPersona(id);
    const [contratos, despidos] = await Promise.all([
      this.#db.query(queries.findContratosDePersona, [id]),
      this.#db.query(queries.findDespidosDePersona, [id]),
    ]);
    return {
      persona,
      contratos: contratos.rows,
      despidos: despidos.rows,
    };
  }

  async listarDespidos() {
    const { rows } = await this.#db.query(queries.listarDespidosRegistro);
    return rows;
  }

  async listarMotivos() {
    const { rows } = await this.#db.query(queries.listarMotivosDespido);
    return rows.map((fila) => fila.motivo);
  }

  async despedir(personaId, motivo, fecha, descripcion = null) {
    const id = this.#exigirPersonaId(personaId);

    const motivos = await this.listarMotivos();
    if (!motivos.includes(motivo)) {
      throw new ErrorNegocio(
        `motivo debe ser uno de: ${motivos.join(", ")}.`,
        400,
      );
    }
    if (!esFechaISOValida(fecha)) {
      throw new ErrorNegocio(
        "fecha debe ser una fecha real con formato YYYY-MM-DD.",
        400,
      );
    }
    if (fecha > aFechaISO(new Date())) {
      throw new ErrorNegocio("La fecha del despido no puede ser futura.", 400);
    }
    const nota = textoService.opcional(descripcion, "descripcion", 250);
    const registradoPor = usuarioIdDeSesion(this.#req);

    return this.#db.transaction(async (cliente) => {
      // Orden de bloqueo fijo: persona y después contrato, para no
      // interbloquear con otra operación que toque las mismas filas.
      const { rows: personas } = await cliente.query(
        queries.findPersonaForUpdate,
        [id],
      );
      const persona = personas[0];
      if (!persona) {
        throw new ErrorNegocio("La persona no existe.", 404);
      }
      if (persona.estado !== "ACTIVO") {
        throw new ErrorNegocio("La persona ya está inactiva.", 409);
      }

      const { rows: contratos } = await cliente.query(
        queries.findContratoVigenteForUpdate,
        [id],
      );
      const contrato = contratos[0];
      if (!contrato) {
        throw new ErrorNegocio(
          "La persona no tiene un contrato vigente.",
          409,
        );
      }

      const inicioContrato = aFechaISO(contrato.fecha_inicio);
      if (inicioContrato && fecha < inicioContrato) {
        throw new ErrorNegocio(
          "La fecha del despido no puede ser anterior al inicio del contrato.",
          400,
        );
      }

      const { rows: existentes } = await cliente.query(
        queries.findDespidoPorContrato,
        [contrato.id],
      );
      if (existentes[0]) {
        throw new ErrorNegocio(
          "El contrato ya tiene un despido registrado.",
          409,
        );
      }

      const { rows: insertados } = await cliente.query(queries.insertDespido, [
        id,
        contrato.id,
        motivo,
        fecha,
        nota,
        registradoPor,
      ]);

      const { rows: contratoFinal } = await cliente.query(
        queries.finalizarContrato,
        [contrato.id, fecha],
      );
      await cliente.query(queries.inactivarPersona, [id]);
      const { rows: usuarios } = await cliente.query(
        queries.desactivarUsuarioDePersona,
        [id],
      );
      const usuario = usuarios[0];

      let tokensRevocados = 0;
      let sesionesCerradas = 0;
      if (usuario) {
        const tokens = await cliente.query(sessionQueries.revokeAllUserTokens, [
          usuario.id,
        ]);
        tokensRevocados = tokens.rowCount ?? 0;

        const sesiones = await cliente.query(
          sessionQueries.borrarSesionesDeUsuario,
          [usuario.id],
        );
        sesionesCerradas = sesiones.rowCount ?? 0;
      }

      return {
        despido: insertados[0],
        contrato: contratoFinal[0],
        usuarioDesactivado: Boolean(usuario),
        sesionesCerradas,
        tokensRevocados,
      };
    });
  }
}
