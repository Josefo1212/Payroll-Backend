import { randomUUID } from "node:crypto";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { passwordService } from "../../services/PasswordService.js";
import { tokenService } from "../../services/TokenService.js";
import {
  MAX_INTENTOS_FALLIDOS as MAX_INTENTOS,
  MINUTOS_BLOQUEO,
} from "../../config/security.js";

const COOKIE_ACCESS = "access_token";
const COOKIE_REFRESH = "refresh_token";

const RETARDO_MAX = Number(process.env.LOGIN_FAIL_DELAY_MS ?? 400);

const pausaCredenciales = async (retardoMax = RETARDO_MAX) => {
  if (!(retardoMax > 0)) {
    return;
  }
  const minimo = Math.floor(retardoMax / 2);
  const espera = minimo + Math.floor(Math.random() * (retardoMax - minimo + 1));
  await new Promise((resolve) => setTimeout(resolve, espera));
};

const MENSAJE_CREDENCIALES = "Usuario o contraseña incorrectos";

export class Session {
  #db;
  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  sessionExist() {
    return Boolean(this.#req?.session?.userID);
  }

  getSession() {
    const sesion = this.#req?.session;
    if (!sesion?.userID) {
      return null;
    }

    return {
      userID: sesion.userID,
      userName: sesion.userName,
      profiles: Array.isArray(sesion.detallesPerfiles) ? sesion.detallesPerfiles : [],
      debeCambiarClave: Boolean(sesion.debeCambiarClave),
    };
  }

  async login(username, password) {
    if (this.sessionExist()) {
      return this.getSession();
    }

    const usuario = await this.#authenticate(username, password);

    await this.#resetAttemptsAndAccess(usuario.id);

    const { rows } = await this.#db.query(queries.findProfilesByUserId, [usuario.id]);
    const profiles = rows.map((fila) => ({
      id: fila.perfil_id,
      nombre: fila.nombre_perfil,
    }));

    if (profiles.length === 0) {
      console.log(`Login fallido: el usuario ${usuario.id} no tiene perfiles asignados.`);
      throw new ErrorNegocio("El usuario no tiene perfiles asignados.", 403);
    }

    const sesion = await this.#createSession(usuario, profiles);

    await this.#emitirTokens(usuario, profiles);

    console.log(`Login ok: usuario ${usuario.id}.`);
    return sesion;
  }

  async logout() {
    const sesion = this.#req?.session;
    if (!sesion?.userID) {
      return { ok: true };
    }

    const userID = sesion.userID;
    await this.#db.query(queries.revokeAllUserTokens, [userID]);
    await new Promise((resolve, reject) => {
      sesion.destroy((error) => (error ? reject(error) : resolve()));
    });
    this.#req?.res?.clearCookie(COOKIE_ACCESS, tokenService.opcionesCookie());
    this.#req?.res?.clearCookie(
      COOKIE_REFRESH,
      tokenService.opcionesCookie({ refresh: true }),
    );
    console.log(`Logout: usuario ${userID}.`);
    return { ok: true };
  }

  async #rechazar(password, mensaje, status, log) {
    await passwordService.verificarContraDummy(password);
    await pausaCredenciales();
    console.log(log);
    throw new ErrorNegocio(mensaje, status);
  }

  async #authenticate(username, password) {
    if (
      typeof username !== "string" ||
      username.trim() === "" ||
      typeof password !== "string" ||
      password === ""
    ) {
      throw new ErrorNegocio("Usuario y contraseña son obligatorios.", 400);
    }

    const { rows } = await this.#db.query(queries.findUserByUsername, [
      username.trim(),
    ]);
    const usuario = rows[0];

    if (!usuario) {
      await this.#rechazar(
        password,
        MENSAJE_CREDENCIALES,
        401,
        "Login fallido: credenciales inválidas.",
      );
    }

    if (!usuario.activo) {
      await this.#rechazar(
        password,
        "La cuenta está desactivada.",
        403,
        `Login denegado: usuario ${usuario.id} inactivo.`,
      );
    }

    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      await this.#rechazar(
        password,
        "La cuenta está bloqueada temporalmente por intentos fallidos.",
        423,
        `Login denegado: usuario ${usuario.id} bloqueado.`,
      );
    }

    const coincide = await passwordService.verificar(password, usuario.password_hash);
    if (!coincide) {
      const { rows: intentos } = await this.#db.query(queries.registerFailedAttempt, [
        usuario.id,
        MINUTOS_BLOQUEO,
        MAX_INTENTOS,
      ]);
      await pausaCredenciales();
      console.log(
        `Login fallido: contraseña incorrecta para el usuario ${usuario.id} ` +
          `(intentos: ${intentos[0]?.intentos_fallidos ?? "?"}).`,
      );
      throw new ErrorNegocio(MENSAJE_CREDENCIALES, 401);
    }

    return usuario;
  }

  async #resetAttemptsAndAccess(usuarioId) {
    await this.#db.query(queries.resetAttemptsAndAccess, [usuarioId]);
  }

  async #createSession(usuario, profiles) {
    await new Promise((resolve, reject) => {
      this.#req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    this.#req.session.userID = usuario.id;
    this.#req.session.userName = usuario.nombre || usuario.username;
    this.#req.session.profiles = profiles.map(({ id }) => id);
    this.#req.session.detallesPerfiles = profiles;
    this.#req.session.debeCambiarClave = Boolean(usuario.debe_cambiar_clave);

    await new Promise((resolve, reject) => {
      this.#req.session.save((error) => (error ? reject(error) : resolve()));
    });

    return {
      userID: usuario.id,
      userName: this.#req.session.userName,
      profiles,
      debeCambiarClave: this.#req.session.debeCambiarClave,
    };
  }

  async #emitirTokens(usuario, profiles) {
    const access = await tokenService.firmarAccess({
      userID: usuario.id,
      userName: this.#req.session.userName,
      perfiles: profiles.map(({ id }) => id),
    });

    const { valor, hash } = tokenService.generarRefresh();
    const familiaId = randomUUID();

    await this.#db.query(queries.insertRefreshToken, [
      usuario.id,
      familiaId,
      hash,
      tokenService.expiracionRefresh(),
      this.#req?.ip ?? null,
      this.#req?.get?.("user-agent") ?? null,
    ]);

    const res = this.#req?.res;
    if (res) {
      res.cookie(COOKIE_ACCESS, access, tokenService.opcionesCookie());
      res.cookie(COOKIE_REFRESH, valor, tokenService.opcionesCookie({ refresh: true }));
    }

    return { access, refresh: valor, familiaId };
  }
}

export { pausaCredenciales };
