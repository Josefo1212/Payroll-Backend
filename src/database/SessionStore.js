import session from "express-session";
import { datosSegurosDeError } from "../errors/logError.js";

const UNA_HORA_MS = 60 * 60 * 1000;
const TTL_POR_DEFECTO_MS = 24 * UNA_HORA_MS;
const LIMPIEZA_CADA_MS = 15 * 60 * 1000;

// Store de sesiones sobre PostgreSQL. Sustituye al MemoryStore de
// express-session, que guarda las sesiones en el proceso: se pierden al
// reiniciar, no se comparten entre instancias, no se pueden invalidar desde
// otro nodo y su mapa crece sin límite (fuga de memoria).
//
// El contrato es el de session.Store: get/set/destroy/touch con callback.
// Cualquier error se registra con datosSegurosDeError (sin filas ni
// credenciales) y se propaga al callback para que express-session decida.
export class PostgresSessionStore extends session.Store {
  #pool;
  #ttlMs;
  #temporizador;

  constructor(pool, { ttlMs = TTL_POR_DEFECTO_MS } = {}) {
    super();
    this.#pool = pool;
    this.#ttlMs = ttlMs;

    // unref: el temporizador no mantiene vivo el proceso al apagar.
    this.#temporizador = setInterval(() => {
      void this.borrarVencidas();
    }, LIMPIEZA_CADA_MS);
    this.#temporizador.unref?.();
  }

  get = (sid, callback) => {
    this.#pool
      .query(
        "SELECT sess FROM sesion WHERE sid = $1 AND expira_en > now()",
        [sid],
      )
      .then(({ rows }) => callback(null, rows[0]?.sess ?? null))
      .catch((error) => this.#fallar("get", error, callback));
  };

  set = (sid, sess, callback = () => {}) => {
    const expira = new Date(Date.now() + this.#ttlMs);
    this.#pool
      .query(
        `INSERT INTO sesion (sid, sess, expira_en)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid) DO UPDATE
            SET sess = EXCLUDED.sess,
                expira_en = EXCLUDED.expira_en`,
        [sid, JSON.stringify(sess), expira],
      )
      .then(() => callback(null))
      .catch((error) => this.#fallar("set", error, callback));
  };

  destroy = (sid, callback = () => {}) => {
    this.#pool
      .query("DELETE FROM sesion WHERE sid = $1", [sid])
      .then(() => callback(null))
      .catch((error) => this.#fallar("destroy", error, callback));
  };

  // touch solo renueva la vigencia: express-session lo llama en peticiones
  // que no modificaron la sesión (resave: false).
  touch = (sid, _sess, callback = () => {}) => {
    const expira = new Date(Date.now() + this.#ttlMs);
    this.#pool
      .query("UPDATE sesion SET expira_en = $2 WHERE sid = $1", [sid, expira])
      .then(() => callback(null))
      .catch((error) => this.#fallar("touch", error, callback));
  };

  borrarVencidas = async () => {
    try {
      await this.#pool.query("DELETE FROM sesion WHERE expira_en <= now()");
    } catch (error) {
      console.error(
        "SessionStore: fallo el barrido de sesiones vencidas:",
        datosSegurosDeError(error),
      );
    }
  };

  cerrar = () => clearInterval(this.#temporizador);

  #fallar = (operacion, error, callback) => {
    console.error(`SessionStore.${operacion}:`, datosSegurosDeError(error));
    callback(error);
  };
}
