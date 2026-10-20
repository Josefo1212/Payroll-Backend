import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db } from "../database/Database.js";
import { queries } from "../queries/loader.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";

// Directorio raíz de los objetos de negocio, resuelto desde este archivo
// (src/security/ → ../bo). Se puede inyectar otro en el constructor para
// las pruebas que usan un src/bo temporal.
const BO_DIR_POR_DEFECTO = fileURLToPath(new URL("../bo", import.meta.url));

// Los BO viven en src/bo/<Subsistema>/<Clase>.js y exportan la clase con el mismo
// nombre. El descubrimiento se hace al arrancar (y en cada refreshBo()) leyendo
// el directorio real con fs: el cliente nunca elige rutas, solo se importan
// archivos que existían en src/bo en el último descubrimiento.
const NOMBRE_VALIDO = /^[A-Za-z0-9]+$/;

// Node formatea ERR_MODULE_NOT_FOUND como:
//   Cannot find module '<specifier>' imported from <parent>
// Extrae el specifier del módulo que no se encontró. Si no se puede leer,
// devuelve null.
const moduloFaltante = (error) => {
  const coincidencia = /Cannot find module '([^']+)'/.exec(error?.message ?? "");
  return coincidencia ? coincidencia[1] : null;
};

// ¿El módulo que no se encontró ES el archivo del BO (y no un import roto
// dentro de él)? Compara por ruta absoluta y por URL file://.
const faltaElBo = (error, ruta) => {
  const faltante = moduloFaltante(error);
  if (faltante == null) {
    return false;
  }
  return faltante === ruta || faltante === pathToFileURL(ruta).href;
};

// Objeto de seguridad: resuelve los permisos en memoria (O(1) por petición) y
// despacha los métodos de negocio por reflexión. Los mapas se cargan una vez
// al arrancar con loadPermission() y se reemplazan de una vez: nunca quedan a
// medio armar.
class Security {
  // Llave `Subsistema_Clase_metodo_perfilId` → true.
  PermissionMethodMap = new Map();

  // Llave `Subsistema_opcion_perfilId` → datos de la opción (para el menú).
  PermissionOptionMap = new Map();

  // Llave `Subsistema/Clase` → la clase del objeto de negocio ya importada.
  ClaseCache = new Map();

  // Llave `Subsistema/Clase` → ruta absoluta del archivo .js del BO. Se arma
  // con descubrimiento en disco (refreshBo), no con una lista escrita a mano.
  BoMap = new Map();

  // Id del perfil 'Publico' (null si no existe): sus permisos los tiene
  // cualquiera, con o sin sesión.
  PublicProfileId = null;

  constructor(conexion, { boDir = BO_DIR_POR_DEFECTO } = {}) {
    this.db = conexion;
    this.boDir = boDir;
    this.refreshBo();
  }

  // Descubre los BO en disco: cada subcarpeta de src/bo es un subsistema y cada
  // archivo .js dentro es una clase. Solo entran nombres que cumplan el regex
  // alfanumérico (nada de ".", "..", ni separadores de ruta). Reemplaza el
  // mapa de una vez y descarta la caché de clases. Node cachea import() por
  // URL: un archivo NUEVO se carga, pero los cambios en uno existente no se
  // reimportan hasta reiniciar el proceso (nodemon lo hace en desarrollo).
  refreshBo = () => {
    const nuevoMapa = new Map();

    let subsistemas;
    try {
      subsistemas = readdirSync(this.boDir, { withFileTypes: true });
    } catch (error) {
      // Sin carpeta src/bo no hay BO: no es fatal, el servidor arranca sin ninguno.
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
    // Redescubre src/bo en cada carga: un BO nuevo se ve sin reiniciar.
    this.refreshBo();

    const [metodos, opciones, publico] = await Promise.all([
      this.db.query(queries.loadPermissionMethods),
      this.db.query(queries.loadPermissionOptions),
      this.db.query(queries.findPublicProfileId),
    ]);

    const mapasMetodos = new Map();
    for (const fila of metodos.rows) {
      mapasMetodos.set(
        `${fila.subsistema}_${fila.clase}_${fila.metodo}_${fila.perfil_id}`,
        true,
      );
    }

    const mapasOpciones = new Map();
    for (const fila of opciones.rows) {
      mapasOpciones.set(`${fila.subsistema}_${fila.opcion}_${fila.perfil_id}`, {
        id: fila.opcion_id,
        nombre: fila.opcion,
        orden: fila.orden,
        descripcion: fila.descripcion,
        subsistema: fila.subsistema,
        perfilId: fila.perfil_id,
      });
    }

    // Reemplazo atómico: hasta acá se siguen usando los mapas viejos.
    this.PermissionMethodMap = mapasMetodos;
    this.PermissionOptionMap = mapasOpciones;
    this.PublicProfileId = publico.rows[0]?.id ?? null;

    console.log(
      `Permisos cargados: ${mapasMetodos.size} método(s) y ${mapasOpciones.size} opción(es)` +
        ` (perfil público: ${this.PublicProfileId ?? "ninguno"}).`,
    );
  };

  setPermissionMethod = (subsistema, clase, metodo, perfilId, permitido = true) => {
    const llave = `${subsistema}_${clase}_${metodo}_${perfilId}`;
    if (permitido) {
      this.PermissionMethodMap.set(llave, true);
    } else {
      this.PermissionMethodMap.delete(llave);
    }
  };

  setPermissionOption = (subsistema, opcion, perfilId, datos = null) => {
    const llave = `${subsistema}_${opcion}_${perfilId}`;
    if (datos) {
      this.PermissionOptionMap.set(llave, datos);
    } else {
      this.PermissionOptionMap.delete(llave);
    }
  };

  // Consulta de los mapas ya cargados (los pide el esquema del profe).
  getPermissionMethod = (key) => this.PermissionMethodMap.has(key);

  getPermissionOption = (key) => this.PermissionOptionMap.get(key) ?? null;

  // Opciones visibles para un conjunto de perfiles, sin duplicados (una
  // opción compartida por dos perfiles aparece una sola vez) y ordenadas por
  // subsistema y luego por `orden`. El BO no conoce las claves internas del
  // mapa: pide acá y recibe la forma pública.
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

  // Despacho de un método de negocio. El orden es innegociable:
  // 1) forma, 2) sesión viva, 3) permiso, 4) reflexión y 5) ejecución. Nunca
  // se invierte: validar el permiso después de la reflexión dejaría que el
  // cliente elija qué archivo se carga antes de estar autorizado. Se recibe
  // `req` completo
  // (no solo la sesión): express-session reemplaza req.session al hacer
  // regenerate, y los objetos de negocio construidos acá leen this.req.session
  // sobre el objeto vivo. Devuelve { status, body }.
  executeMethod = async (jsonData, req) => {
    const { subsystem, class: clase, method, params } = jsonData ?? {};

    const esNombreValido = (valor) =>
      typeof valor === "string" && /^[A-Za-z0-9]+$/.test(valor);

    // 1. Forma.
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
    // 2. Sesión viva: si hay un usuario autenticado, se relee su estado y sus
    //    perfiles actuales. Así una cuenta desactivada (o sin perfiles) deja
    //    de autorizar aunque la cookie siga vigente. Es una consulta indexada
    //    por petición autenticada; las peticiones públicas no la pagan.
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
    }

    // 3. Permiso, resuelto en memoria con los perfiles efectivos: los de la
    //    sesión más el del perfil 'Publico' (si existe), que autoriza a
    //    cualquiera aunque no haya sesión. Basta con que uno autorice (OR).
    const perfiles = Array.isArray(req?.session?.profiles) ? req.session.profiles : [];
    const perfilesEfectivos =
      this.PublicProfileId != null && !perfiles.includes(this.PublicProfileId)
        ? [...perfiles, this.PublicProfileId]
        : perfiles;

    const autorizado = perfilesEfectivos.some((perfilId) =>
      this.getPermissionMethod(`${subsystem}_${clase}_${method}_${perfilId}`),
    );

    if (!autorizado) {
      // Sin sesión el problema no es el permiso: hay que autenticarse.
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

    // 4. Reflexión. La ruta sale del BoMap (descubierto en disco al arrancar,
    //    refrescable con refreshBo()); la clase se cachea por `Subsistema/Clase`.
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
        // pathToFileURL(ruta).href es la forma portable (también en Windows):
        // import() de una ruta cruda con letra de unidad falla como URL.
        const modulo = await import(pathToFileURL(ruta).href);
        // El archivo debe exportar la clase con el mismo nombre que el archivo.
        Clase = modulo[clase];
      } catch (error) {
        // Solo es 501 si falta el archivo del BO. Si el módulo no encontrado
        // es otro (un import roto DENTRO del BO), se propaga para que se vea
        // como error del servidor, no como "método inexistente".
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

    // Solo métodos de negocio: propios del prototipo, que sean función y
    // distintos de `constructor`. `constructor` también es propio del
    // prototipo, por eso se excluye aparte. Así se descartan `constructor`,
    // `toString`, `__proto__` y todo lo que herede de Object.
    const esMetodoDeNegocio =
      method !== "constructor" &&
      Object.prototype.hasOwnProperty.call(Clase.prototype, method) &&
      typeof Clase.prototype[method] === "function";

    if (!esMetodoDeNegocio) {
      return { status: 501, body: { error: "Método no encontrado." } };
    }

    // 5. Ejecución: el objeto de negocio recibe el componente de BD y la
    //    petición (de la que lee this.req.session, siempre viva). Un
    //    ErrorNegocio del BO se traduce a su código; cualquier otro error
    //    se propaga (no se oculta).
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
