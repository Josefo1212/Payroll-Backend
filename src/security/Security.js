import { db } from "../database/Database.js";
import { queries } from "../queries/loader.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";

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

  constructor(conexion) {
    this.db = conexion;
  }

  loadPermission = async () => {
    const [metodos, opciones] = await Promise.all([
      this.db.query(queries.loadPermissionMethods),
      this.db.query(queries.loadPermissionOptions),
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
      });
    }

    // Reemplazo atómico: hasta acá se siguen usando los mapas viejos.
    this.PermissionMethodMap = mapasMetodos;
    this.PermissionOptionMap = mapasOpciones;

    console.log(
      `Permisos cargados: ${mapasMetodos.size} método(s) y ${mapasOpciones.size} opción(es).`,
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

  // Despacho de un método de negocio. El orden es innegociable:
  // 1) forma, 2) permiso, 3) reflexión y 4) ejecución. Nunca se invierte:
  // validar el permiso después de la reflexión dejaría que el cliente elija
  // qué archivo se carga antes de estar autorizado. Devuelve { status, body }.
  executeMethod = async (jsonData, session) => {
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

    // 2. Permiso, resuelto en memoria con los perfiles de la sesión. Basta
    //    con que uno autorice (OR).
    const perfiles = Array.isArray(session?.profiles) ? session.profiles : [];
    const autorizado = perfiles.some((perfilId) =>
      this.PermissionMethodMap.has(`${subsystem}_${clase}_${method}_${perfilId}`),
    );

    if (!autorizado) {
      console.warn(
        `403: ${subsystem}/${clase}/${method} sin permiso para los perfiles [${perfiles}].`,
      );
      return {
        status: 403,
        body: { error: "No autorizado para ejecutar el método." },
      };
    }

    // 3. Reflexión. La ruta se arma solo con nombres ya validados por el
    //    regex; la clase se cachea por `Subsistema/Clase`.
    const llaveClase = `${subsystem}/${clase}`;
    let Clase = this.ClaseCache.get(llaveClase);

    if (!Clase) {
      try {
        const modulo = await import(
          new URL(`../../bo/${subsystem}/${clase}.js`, import.meta.url)
        );
        Clase = modulo[clase];
      } catch (error) {
        // Solo "archivo no encontrado" es 501; un error de sintaxis debe
        // verse, no disfrazarse de método inexistente.
        if (error?.code !== "ERR_MODULE_NOT_FOUND") {
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

    // 4. Ejecución: el objeto de negocio recibe el componente de BD y la
    //    sesión. Un ErrorNegocio del BO se traduce a su código; cualquier
    //    otro error se propaga (no se oculta).
    const objeto = new Clase(this.db, session);
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
