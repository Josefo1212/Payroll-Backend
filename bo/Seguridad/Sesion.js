import bcrypt from "bcrypt";
import { queries } from "../../src/queries/loader.js";
import { ErrorNegocio } from "../../src/errors/ErrorNegocio.js";

// Máximo de intentos fallidos y minutos de bloqueo (configurables por .env).
const MAX_INTENTOS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const MINUTOS_BLOQUEO = Number(process.env.LOGIN_BLOCK_MINUTES || 15);

// Pausa uniforme (200–400 ms) solo en los fallos de credenciales, para frenar
// fuerza bruta. LOGIN_FAIL_DELAY_MS = 0 la desactiva (así corren las pruebas).
const RETARDO_MAX = Number(process.env.LOGIN_FAIL_DELAY_MS ?? 400);

// Espera aleatoria en [retardoMax/2, retardoMax]. Con 0 no espera. Se recibe
// el valor como parámetro para poder probar la espera sin depurar el módulo.
const pausaCredenciales = async (retardoMax = RETARDO_MAX) => {
  if (!(retardoMax > 0)) {
    return;
  }
  const minimo = Math.floor(retardoMax / 2);
  const espera = minimo + Math.floor(Math.random() * (retardoMax - minimo + 1));
  await new Promise((resolve) => setTimeout(resolve, espera));
};

// Hash bcrypt de un valor aleatorio: se compara cuando el usuario no existe
// para que el tiempo de respuesta no revele cuál de los dos fallos fue.
const HASH_DUMMY = "$2b$12$LybMgOxOi4wCQe0BWoOKXuuEnpNuJm8XqE5ORx8y1kLkuOfiu7zSO";

const MENSAJE_CREDENCIALES = "Usuario o contraseña incorrectos";

// Objeto de negocio de autenticación: se invoca por el endpoint único de
// reflexión, no por rutas REST. Recibe (db, req); la sesión se lee de
// this.req.session en cada llamada porque express-session la reemplaza al
// hacer regenerate.
export class Sesion {
  #db;
  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  // --- Métodos públicos (visibles por reflexión) -------------------------

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
      profiles: Array.isArray(sesion.profiles) ? sesion.profiles : [],
    };
  }

  async login(username, password) {
    // Sesión vigente: se devuelve tal cual, sin volver a autenticar.
    if (this.sessionExist()) {
      return this.getSession();
    }

    const usuario = await this.#authenticate(username, password);

    await this.#resetAttemptsAndAccess(usuario.id);

    // Los perfiles son los que autorizan en los mapas de permisos.
    const { rows } = await this.#db.query(queries.findProfilesByUserId, [usuario.id]);
    const profiles = rows.map((fila) => fila.perfil_id);

    if (profiles.length === 0) {
      console.log(`Login fallido: el usuario ${usuario.id} no tiene perfiles asignados.`);
      throw new ErrorNegocio("El usuario no tiene perfiles asignados.", 403);
    }

    const sesion = await this.#createSession(usuario, profiles);

    console.log(`Login ok: usuario ${usuario.id} (${usuario.username}).`);
    return sesion;
  }

  async logout() {
    // Sin sesión no hay nada que destruir: es idempotente y no debe fallar.
    const sesion = this.#req?.session;
    if (!sesion?.userID) {
      return { ok: true };
    }

    const userID = sesion.userID;
    await new Promise((resolve, reject) => {
      sesion.destroy((error) => (error ? reject(error) : resolve()));
    });
    console.log(`Logout: usuario ${userID}.`);
    return { ok: true };
  }

  // --- Métodos privados (no se ven por reflexión) ------------------------

  // Valida la forma y busca el usuario. Siempre compara contra algo (hash
  // dummy si el usuario no existe) para no filtrar existencia por tiempo.
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
      await bcrypt.compare(password, HASH_DUMMY);
      await pausaCredenciales();
      console.log(`Login fallido: usuario inexistente "${username}".`);
      throw new ErrorNegocio(MENSAJE_CREDENCIALES, 401);
    }

    if (!usuario.activo) {
      console.log(`Login denegado: usuario ${usuario.id} inactivo.`);
      throw new ErrorNegocio("La cuenta está desactivada.", 403);
    }

    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      console.log(`Login denegado: usuario ${usuario.id} bloqueado.`);
      throw new ErrorNegocio(
        "La cuenta está bloqueada temporalmente por intentos fallidos.",
        423,
      );
    }

    const coincide = await bcrypt.compare(password, usuario.password_hash);
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

  // regenerate + save promisificados. Hay que hacerlo SIEMPRE sobre el
  // objeto req: al regenerar, express-session reemplaza req.session por uno
  // nuevo, y es sobre ese nuevo donde se guardan los datos.
  async #createSession(usuario, profiles) {
    await new Promise((resolve, reject) => {
      this.#req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    this.#req.session.userID = usuario.id;
    this.#req.session.userName = usuario.nombre || usuario.username;
    this.#req.session.profiles = profiles;

    await new Promise((resolve, reject) => {
      this.#req.session.save((error) => (error ? reject(error) : resolve()));
    });

    // Jamás se devuelve password_hash.
    return {
      userID: usuario.id,
      userName: this.#req.session.userName,
      profiles,
    };
  }
}

// Se exporta para las pruebas del tiempo de espera (no se ve por reflexión:
// executeMethod solo acepta métodos propios del prototipo de la clase).
export { pausaCredenciales };
