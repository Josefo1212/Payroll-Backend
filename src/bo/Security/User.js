import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { passwordService } from "../../services/PasswordService.js";

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
      laboral,
    } = datos ?? {};

    if (!cedula || !primer_nombre || !primer_apellido || !username || !password) {
      throw new ErrorNegocio(
        "Faltan datos obligatorios: cedula, primer_nombre, primer_apellido, username y password.",
        400,
      );
    }

    passwordService.validar(password);

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

    if (laboral) {
      if (!laboral.cargo_id || !laboral.fecha_inicio || !laboral.tipo_pago || !laboral.frecuencia_pago || laboral.monto === undefined || laboral.monto === null) {
        throw new ErrorNegocio("Datos laborales incompletos: cargo_id, fecha_inicio, tipo_pago, frecuencia_pago y monto son obligatorios.", 400);
      }
      if (!["POR_HORA", "SALARIO_FIJO"].includes(laboral.tipo_pago)) {
        throw new ErrorNegocio("tipo_pago inválido. Debe ser POR_HORA o SALARIO_FIJO.", 400);
      }
      if (!["SEMANAL", "QUINCENAL", "MENSUAL"].includes(laboral.frecuencia_pago)) {
        throw new ErrorNegocio("frecuencia_pago inválido. Debe ser SEMANAL, QUINCENAL o MENSUAL.", 400);
      }
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

        if (laboral) {
          const cargo = await cliente.query(queries.findCargoById, [Number(laboral.cargo_id)]);
          if (cargo.rows.length === 0 || cargo.rows[0].activo === false) {
            throw new ErrorNegocio("El cargo indicado no existe o está inactivo.", 400);
          }
        }

        const passwordHash = await passwordService.hashear(password);

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

        let contratoId = null;
        if (laboral) {
          const vigenteDesde = laboral.vigente_desde || laboral.fecha_inicio;
          const contrato = await cliente.query(queries.insertContrato, [
            persona.rows[0].id,
            Number(laboral.cargo_id),
            laboral.fecha_inicio,
            laboral.fecha_fin ?? null,
            laboral.tipo_pago,
            laboral.frecuencia_pago,
            laboral.horas_semanales ?? null,
          ]);
          contratoId = contrato.rows[0].id;
          await cliente.query(queries.insertContratoSalario, [
            contratoId,
            laboral.monto,
            vigenteDesde,
            laboral.vigente_hasta ?? null,
            laboral.motivo ?? null,
          ]);
        }

        return { ...usuario.rows[0], perfiles: perfilesAsignados, contratoId };
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

    passwordService.validar(nueva);

    const { rows } = await this.#db.query(queries.findPasswordHashById, [
      usuarioId,
    ]);
    const usuario = rows[0];
    if (!usuario) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }

    const coincide = await passwordService.verificar(actual, usuario.password_hash);
    if (!coincide) {
      throw new ErrorNegocio("La contraseña actual es incorrecta.", 401);
    }

    const passwordHash = await passwordService.hashear(nueva);
    await this.#db.query(queries.updatePassword, [passwordHash, usuarioId]);

    if (this.#req?.session) {
      this.#req.session.debeCambiarClave = false;
    }

    return { ok: true };
  }

  async listarPerfiles() {
    const { rows } = await this.#db.query(queries.findAllActiveProfiles);
    return rows.map(({ id, nombre_perfil, descripcion }) => ({
      id,
      nombre: nombre_perfil,
      descripcion,
    }));
  }
}
