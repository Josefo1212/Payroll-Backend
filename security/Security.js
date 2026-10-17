import { db } from "../src/database/Database.js";
import { queries } from "../src/queries/loader.js";

// Objeto de seguridad: resuelve los permisos en memoria (O(1) por petición) y
// despacha los métodos de negocio por reflexión. Los mapas se cargan una vez
// al arrancar con loadPermission() y se reemplazan de una vez: nunca quedan a
// medio armar.
class Security {
  // Llave `Subsistema_Clase_metodo_perfilId` → true.
  PermissionMethodMap = new Map();

  // Llave `Subsistema_opcion_perfilId` → datos de la opción (para el menú).
  PermissionOptionMap = new Map();

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
}

export { Security };
export const security = new Security(db);
