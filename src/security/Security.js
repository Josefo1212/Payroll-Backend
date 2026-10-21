import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db } from "../database/Database.js";
import { queries } from "../queries/loader.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";
import {
  llaveMetodo,
  llaveOpcion,
} from "../services/PermissionKeyService.js";
import { tokenService } from "../services/TokenService.js";

const BO_DIR_POR_DEFECTO = fileURLToPath(new URL("../bo", import.meta.url));

const NOMBRE_VALIDO = /^[A-Za-z0-9]+$/;

const leerCookie = (req, nombre) => {
  if (req?.cookies?.[nombre]) {
    return req.cookies[nombre];
  }

  const crudo = req?.headers?.cookie;
  if (!crudo) {
    return null;
  }

  const par = crudo
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${nombre}=`));

  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
};

const moduloFaltante = (error) => {
  const coincidencia = /Cannot find module '([^']+)'/.exec(error?.message ?? "");
  return coincidencia ? coincidencia[1] : null;
};

const faltaElBo = (error, ruta) => {
  const faltante = moduloFaltante(error);
  if (faltante == null) {
    return false;
  }
  return faltante === ruta || faltante === pathToFileURL(ruta).href;
};

class Security {
  PermissionMethodMap = new Map();

  PermissionOptionMap = new Map();

  ClaseCache = new Map();

  BoMap = new Map();

  PublicProfileId = null;

  constructor(conexion, { boDir = BO_DIR_POR_DEFECTO } = {}) {
    this.db = conexion;
    this.boDir = boDir;
    this.refreshBo();
  }

  refreshBo = () => {
    const nuevoMapa = new Map();

    let subsistemas;
    try {
      subsistemas = readdirSync(this.boDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      subsistemas = [];
    }

    for (const subsistema of subsistemas) {
      if (!subsistema.isDirectory() || !NOMBRE_VALIDO.test(subsistema.name)) {
        continue;
      }

      let archivos;
      try {
        archivos = readdirSync(join(this.boDir, subsistema.name), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const archivo of archivos) {
        if (!archivo.isFile() || !archivo.name.endsWith(".js")) {
          continue;
        }
        const clase = archivo.name.slice(0, -".js".length);
        if (!NOMBRE_VALIDO.test(clase)) {
          continue;
        }

        nuevoMapa.set(
          `${subsistema.name}/${clase}`,
          join(this.boDir, subsistema.name, archivo.name),
        );
      }
    }

    this.BoMap = nuevoMapa;
    this.ClaseCache = new Map();

    console.log(`Objetos de negocio descubiertos: ${nuevoMapa.size}.`);
    return nuevoMapa.size;
  };

  loadPermission = async () => {
    this.refreshBo();

    const [metodos, opciones, publico] = await Promise.all([
      this.db.query(queries.loadPermissionMethods),
      this.db.query(queries.loadPermissionOptions),
      this.db.query(queries.findPublicProfileId),
    ]);

    const mapasMetodos = new Map();
    for (const fila of metodos.rows) {
      mapasMetodos.set(
        llaveMetodo(fila.subsistema, fila.clase, fila.metodo, fila.perfil_id),
        true,
      );
    }

    const mapasOpciones = new Map();
    for (const fila of opciones.rows) {
      mapasOpciones.set(llaveOpcion(fila.subsistema, fila.opcion, fila.perfil_id), {
        id: fila.opcion_id,
        nombre: fila.opcion,
        orden: fila.orden,
        descripcion: fila.descripcion,
        subsistema: fila.subsistema,
        perfilId: fila.perfil_id,
      });
    }

    this.PermissionMethodMap = mapasMetodos;
    this.PermissionOptionMap = mapasOpciones;
    this.PublicProfileId = publico.rows[0]?.id ?? null;

    console.log(
      `Permisos cargados: ${mapasMetodos.size} método(s) y ${mapasOpciones.size} opción(es)` +
        ` (perfil público: ${this.PublicProfileId ?? "ninguno"}).`,
    );
  };

  setPermissionMethod = (subsistema, clase, metodo, perfilId, permitido = true) => {
    const llave = llaveMetodo(subsistema, clase, metodo, perfilId);
    if (permitido) {
      this.PermissionMethodMap.set(llave, true);
    } else {
      this.PermissionMethodMap.delete(llave);
    }
  };

  setPermissionOption = (subsistema, opcion, perfilId, datos = null) => {
    const llave = llaveOpcion(subsistema, opcion, perfilId);
    if (datos) {
      this.PermissionOptionMap.set(llave, datos);
    } else {
      this.PermissionOptionMap.delete(llave);
    }
  };

  getPermissionMethod = (key) => this.PermissionMethodMap.has(key);

  getPermissionOption = (key) => this.PermissionOptionMap.get(key) ?? null;

  #hidratarDesdeAccess = async (req) => {
    const token = leerCookie(req, "access_token");
    if (!token) {
      return;
    }

    const payload = await tokenService.verificarAccess(token);
    if (!payload?.sub) {
      return;
    }

    req.session = req.session ?? {};
    req.session.userID = payload.sub;
    req.session.userName = payload.userName ?? null;
    req.session.profiles = Array.isArray(payload.perfiles) ? payload.perfiles : [];
    req.session.detallesPerfiles = [];
    req.session.origin = "access_token";
  };

  getOptionsByProfiles = (perfilIds = []) => {
    const ids = new Set(perfilIds);
    const porId = new Map();

    for (const datos of this.PermissionOptionMap.values()) {
      if (ids.has(datos.perfilId)) {
        porId.set(datos.id, datos);
      }
    }

    return [...porId.values()]
      .map(({ id, nombre, descripcion, orden, subsistema }) => ({
        id,
        nombre,
        descripcion,
        orden,
        subsistema,
      }))
      .sort(
        (a, b) =>
          a.subsistema.localeCompare(b.subsistema) || a.orden - b.orden,
      );
  };

  executeMethod = async (jsonData, req) => {
    const { subsystem, class: clase, method, params } = jsonData ?? {};

    const esNombreValido = (valor) =>
      typeof valor === "string" && /^[A-Za-z0-9]+$/.test(valor);

    if (
      !esNombreValido(subsystem) ||
      !esNombreValido(clase) ||
      !esNombreValido(method) ||
      !Array.isArray(params)
    ) {
      return {
        status: 400,
        body: {
          error:
            "Solicitud inválida: subsystem, class y method deben ser alfanuméricos y params un arreglo.",
        },
      };
    }
    if (req?.session?.userID) {
      const usuarioId = req.session.userID;
      const { rows } = await this.db.query(queries.findSessionState, [usuarioId]);
      const estado = rows[0];

      if (!estado?.activo) {
        await new Promise((resolve, reject) => {
          req.session.destroy((error) => (error ? reject(error) : resolve()));
        });
        console.warn(`401: la sesión del usuario ${usuarioId} ya no es válida.`);
        return {
          status: 401,
          body: { error: "Debes iniciar sesión." },
        };
      }

      req.session.profiles = Array.isArray(estado.perfiles) ? estado.perfiles : [];
      req.session.detallesPerfiles = Array.isArray(estado.perfiles_detalle)
        ? estado.perfiles_detalle
        : [];
      req.session.debeCambiarClave = Boolean(estado.debe_cambiar_clave);
    } else {
      await this.#hidratarDesdeAccess(req);
    }

    const perfiles = Array.isArray(req?.session?.profiles) ? req.session.profiles : [];
    const perfilesEfectivos =
      this.PublicProfileId != null && !perfiles.includes(this.PublicProfileId)
        ? [...perfiles, this.PublicProfileId]
        : perfiles;

    const autorizado = perfilesEfectivos.some((perfilId) =>
      this.getPermissionMethod(llaveMetodo(subsystem, clase, method, perfilId)),
    );

    if (!autorizado) {
      if (!req?.session?.userID) {
        console.warn(
          `401: ${subsystem}/${clase}/${method} sin sesión y sin permiso público.`,
        );
        return {
          status: 401,
          body: { error: "Debes iniciar sesión." },
        };
      }

      console.warn(
        `403: ${subsystem}/${clase}/${method} sin permiso para los perfiles [${perfiles}].`,
      );
      return {
        status: 403,
        body: { error: "No autorizado para ejecutar el método." },
      };
    }

    const llaveClase = `${subsystem}/${clase}`;
    let Clase = this.ClaseCache.get(llaveClase);

    if (!Clase) {
      const ruta = this.BoMap.get(llaveClase);
      if (!ruta) {
        return {
          status: 501,
          body: { error: "Objeto de negocio no encontrado." },
        };
      }

      try {
        const modulo = await import(pathToFileURL(ruta).href);
        Clase = modulo[clase];
      } catch (error) {
        if (error?.code !== "ERR_MODULE_NOT_FOUND" || !faltaElBo(error, ruta)) {
          throw error;
        }
        Clase = undefined;
      }

      if (typeof Clase !== "function") {
        return {
          status: 501,
          body: { error: "Objeto de negocio no encontrado." },
        };
      }

      this.ClaseCache.set(llaveClase, Clase);
    }

    const esMetodoDeNegocio =
      method !== "constructor" &&
      Object.prototype.hasOwnProperty.call(Clase.prototype, method) &&
      typeof Clase.prototype[method] === "function";

    if (!esMetodoDeNegocio) {
      return { status: 501, body: { error: "Método no encontrado." } };
    }

    const objeto = new Clase(this.db, req);
    try {
      const resultado = await objeto[method](...params);
      return { status: 200, body: resultado };
    } catch (error) {
      if (error instanceof ErrorNegocio) {
        return { status: error.status, body: { error: error.message } };
      }
      throw error;
    }
  };
}

export { Security };
export const security = new Security(db);
