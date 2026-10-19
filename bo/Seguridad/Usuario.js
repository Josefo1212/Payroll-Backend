import bcrypt from "bcrypt";
import { queries } from "../../src/queries/loader.js";
import { ErrorNegocio } from "../../src/errors/ErrorNegocio.js";

// Objeto de negocio del subsistema Seguridad. Los métodos van en el
// prototipo (método normal, no función flecha): executeMethod los busca
// con hasOwnProperty sobre Clase.prototype.
export class Usuario {
  constructor(db, session) {
    this.db = db;
    this.session = session;
  }

  // Registra una Persona y su Usuario en una sola transacción: si algo
  // falla a mitad de camino no queda persona sin usuario ni usuario sin
  // persona. `datos` viene del arreglo params de executeMethod.
  async registrar(datos) {
    const {
      cedula,
      primer_nombre,
      primer_apellido,
      segundo_nombre,
      segundo_apellido,
      fecha_nacimiento,
      sexo,
      estado_civil,
      nro_tlf,
      email,
      direccion,
      rif,
      username,
      password,
    } = datos ?? {};

    if (!cedula || !primer_nombre || !primer_apellido || !username || !password) {
      throw new ErrorNegocio(
        "Faltan datos obligatorios: cedula, primer_nombre, primer_apellido, username y password.",
        400,
      );
    }

    try {
      return await this.db.transaction(async (cliente) => {
        const duplicados = await cliente.query(queries.existePersona, [
          cedula,
          email ?? null,
        ]);
        if (duplicados.rows[0].cedula || duplicados.rows[0].email) {
          throw new ErrorNegocio(
            "Ya existe una persona con esa cédula o email.",
            409,
          );
        }

        const usuarioDuplicado = await cliente.query(queries.existeUsuario, [
          username,
        ]);
        if (usuarioDuplicado.rows[0].username) {
          throw new ErrorNegocio("Ya existe un usuario con ese username.", 409);
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const persona = await cliente.query(queries.insertPersona, [
          cedula,
          primer_nombre,
          segundo_nombre ?? null,
          primer_apellido,
          segundo_apellido ?? null,
          fecha_nacimiento ?? null,
          sexo ?? null,
          estado_civil ?? null,
          nro_tlf ?? null,
          email ?? null,
          direccion ?? null,
          rif ?? null,
        ]);

        const usuario = await cliente.query(queries.insertUsuario, [
          persona.rows[0].id,
          username,
          passwordHash,
        ]);

        return usuario.rows[0];
      });
    } catch (error) {
      // Carrera entre el EXISTS y el INSERT: si otro proceso insertó lo
      // mismo en el medio, el UNIQUE de la tabla manda y se traduce al
      // mismo 409 del chequeo explícito.
      if (error?.code === "23505") {
        throw new ErrorNegocio("Datos duplicados: cédula, email o username ya registrados.", 409);
      }
      throw error;
    }
  }
}
