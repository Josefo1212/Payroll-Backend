import { EventEmitter } from "node:events";
import session from "express-session";
import bcrypt from "bcrypt";
import { db } from "../src/database/Database.js";
import { queries } from "../src/queries/loader.js";
import { Security } from "../src/security/Security.js";
import { Sesion } from "../bo/Seguridad/Sesion.js";

// ---------------------------------------------------------------------------
// Database falso: responde a las consultas por su texto SQL (el mismo que
// aparece en queries.yaml), sin tocar PostgreSQL.
// ---------------------------------------------------------------------------

const HASH_CLAVE = await bcrypt.hash("Password123", 4);

// Hash bcrypt (cost 12) de un valor aleatorio, igual que en Sesion.js.
const HASH_DUMMY = "$2b$12$LybMgOxOi4wCQe0BWoOKXuuEnpNuJm8XqE5ORx8y1kLkuOfiu7zSO";

const USUARIO_OK = {
  id: 1,
  username: "admin",
  password_hash: HASH_CLAVE,
  persona_id: 10,
  nombre: "Admin Prueba",
  activo: true,
  intentos_fallidos: 0,
  bloqueado_hasta: null,
};

// Fábrica de Database falso. `opciones.usuario` fija la fila de
// findUserByUsername; los intentos/bloqueos que se registran en memoria.
function crearDbFalso({ usuario = USUARIO_OK, perfiles = [1, 2], publicoId = null } = {}) {
  const llamadas = [];
  const estado = {
    intentos: usuario?.intentos_fallidos ?? 0,
    bloqueadoHasta: usuario?.bloqueado_hasta ?? null,
  };

  const dbFalso = {
    llamadas,
    estado,
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });

      if (texto === queries.loadPermissionMethods) {
        return { rows: [] };
      }
      if (texto === queries.loadPermissionOptions) {
        return { rows: [] };
      }
      if (texto === queries.findPublicProfileId) {
        return { rows: publicoId == null ? [] : [{ id: publicoId }] };
      }
      if (texto === queries.findUserByUsername) {
        return { rows: usuario ? [usuario] : [] };
      }
      if (texto === queries.findProfilesByUserId) {
        return { rows: perfiles.map((perfil_id) => ({ perfil_id })) };
      }
      if (texto === queries.registerFailedAttempt) {
        estado.intentos += 1;
        if (estado.intentos >= params[2]) {
          estado.bloqueadoHasta = new Date(Date.now() + params[1] * 60_000);
        }
        return {
          rows: [{ intentos_fallidos: estado.intentos, bloqueado_hasta: estado.bloqueadoHasta }],
        };
      }
      if (texto === queries.resetAttemptsAndAccess) {
        estado.intentos = 0;
        estado.bloqueadoHasta = null;
        return { rows: [{ id: params[0] }] };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  return dbFalso;
}

// ---------------------------------------------------------------------------
// Doble de sesión: session.regenerate reemplaza req.session por un objeto
// nuevo y session.destroy deja req.session ausente, tal como express-session.
// ---------------------------------------------------------------------------

function crearSesionFalsa(inicial = {}) {
  const sesion = { ...inicial };

  sesion.regenerate = (callback) => {
    for (const clave of Object.keys(sesion)) {
      if (clave !== "regenerate" && clave !== "save" && clave !== "destroy") {
        delete sesion[clave];
      }
    }
    callback(null);
  };

  sesion.save = (callback) => {
    callback(null);
  };

  sesion.destroy = (callback) => {
    for (const clave of Object.keys(sesion)) {
      delete sesion[clave];
    }
    sesion.destruida = true;
    callback(null);
  };

  return sesion;
}

function crearReq(inicial = {}) {
  const inicialSesion = crearSesionFalsa(inicial);
  const req = {};
  let sesion = inicialSesion;

  // express-session deja req.session en undefined tras destroy(); el
  // handler de /api/execute usa justamente eso para limpiar la cookie.
  Object.defineProperty(req, "session", {
    configurable: true,
    enumerable: true,
    get() {
      return sesion?.destruida ? undefined : sesion;
    },
    set(valor) {
      sesion = valor;
    },
  });

  return req;
}

// Doble mínimo de respuesta para probar el handler de /api/execute.
function crearRes() {
  const res = {
    statusCode: null,
    body: null,
    cookieLimpiada: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.body = cuerpo;
      return this;
    },
    clearCookie(nombre) {
      this.cookieLimpiada = nombre;
      return this;
    },
  };
  return res;
}

// Respuesta express-session falsa para simular peticiones HTTP reales.
function crearResHttp() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (nombre, valor) => {
    res.headers[nombre.toLowerCase()] = valor;
  };
  res.getHeader = (nombre) => res.headers[nombre.toLowerCase()];
  res.end = () => res.emit("finish");
  res.json = () => res.end();
  res.writeHead = () => res;
  return res;
}

// Simula una petición a la cookie store: la sesión viaja en la cookie.
function peticion(sesionInicial = {}) {
  const req = {
    sessionID: "sid-fijo",
    session: crearSesionFalsa(sesionInicial),
  };
  const res = crearResHttp();
  return new Promise((resolve) => {
    session({
      secret: "secreto-de-prueba",
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 60_000 },
    })(req, res, () => resolve({ req, res }));
  });
}

export {
  crearDbFalso,
  crearReq,
  crearRes,
  crearSesionFalsa,
  peticion,
  queries,
  Security,
  Sesion,
  HASH_CLAVE,
  HASH_DUMMY,
  USUARIO_OK,
};
