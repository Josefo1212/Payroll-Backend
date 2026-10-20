import bcrypt from "bcrypt";
import { queries } from "../../queries/loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const MAX_BYTES_PASSWORD = 72;

function validarPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new ErrorNegocio(
      "La contraseña debe tener al menos 8 caracteres.",
      400,
    );
  }

  if (Buffer.byteLength(password, "utf8") > MAX_BYTES_PASSWORD) {
    throw new ErrorNegocio(
      "La contraseña no puede superar los 72 bytes.",
      400,
    );
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ErrorNegocio(
      "La contraseña debe incluir al menos una letra y un número.",
      400,
    );
  }
}

export class User {
  #db;
  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

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
      perfil_id,
      perfiles,
    } = datos ?? {};

    if (!cedula || !primer_nombre || !primer_apellido || !username || !password) {
      throw new ErrorNegocio(
        "Faltan datos obligatorios: cedula, primer_nombre, primer_apellido, username y password.",
        400,
      );
    }

    validarPassword(password);

    const solicitados = Array.isArray(perfiles)
      ? perfiles
      : perfil_id != null
        ? [perfil_id]
        : [];
    const perfilesAsignados = [...new Set(solicitados)];

    if (perfilesAsignados.length === 0) {
      throw new ErrorNegocio(
        "Debe asignarse al menos un perfil al usuario.",
        400,
      );
    }

    if (!perfilesAsignados.every((id) => Number.isInteger(id) && id > 0)) {
      throw new ErrorNegocio("Los perfiles deben ser ids enteros positivos.", 400);
    }

    try {
      return await this.#db.transaction(async (cliente) => {
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

        const perfilesActivos = await cliente.query(
          queries.findActiveProfilesByIds,
          [perfilesAsignados],
        );
        if (perfilesActivos.rows.length !== perfilesAsignados.length) {
          throw new ErrorNegocio(
            "Algún perfil no existe o está inactivo.",
            400,
          );
        }

        const passwordHash = await bcrypt.hash(password, 12);

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

        await cliente.query(queries.insertUsuarioPerfil, [
          usuario.rows[0].id,
          perfilesAsignados,
        ]);

        return { ...usuario.rows[0], perfiles: perfilesAsignados };
      });
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio("Datos duplicados: cédula, email o username ya registrados.", 409);
      }
      throw error;
    }
  }

  async cambiarClave(actual, nueva) {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }

    if (typeof actual !== "string" || actual === "") {
      throw new ErrorNegocio("La contraseña actual es obligatoria.", 400);
    }

    validarPassword(nueva);

    const { rows } = await this.#db.query(queries.findPasswordHashById, [
      usuarioId,
    ]);
    const usuario = rows[0];
    if (!usuario) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }

    const coincide = await bcrypt.compare(actual, usuario.password_hash);
    if (!coincide) {
      throw new ErrorNegocio("La contraseña actual es incorrecta.", 401);
    }

    const passwordHash = await bcrypt.hash(nueva, 12);
    await this.#db.query(queries.updatePassword, [passwordHash, usuarioId]);

    if (this.#req?.session) {
      this.#req.session.debeCambiarClave = false;
    }

    return { ok: true };
  }
}
