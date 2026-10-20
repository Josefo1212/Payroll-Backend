import { security } from "../../security/Security.js";

// Objeto de negocio del menú: arma las opciones visibles (lo que el usuario
// VE) a partir de los perfiles de la sesión y del mapa de permisos de opción
// ya cargado en memoria. Se invoca por el endpoint único de reflexión.
export class Menu {
  #req;

  constructor(db, req) {
    this.#req = req;
  }

  // Opciones de los perfiles de la sesión, sin duplicados y ordenadas. Sin
  // sesión no hay perfiles: arreglo vacío.
  getOptions() {
    const profiles = Array.isArray(this.#req?.session?.profiles)
      ? this.#req.session.profiles
      : [];

    if (profiles.length === 0) {
      return [];
    }

    // El filtrado real por perfil lo hace acá el mapa; el permiso del método
    // es solo la puerta de entrada. Se devuelve la forma pública sin `orden`
    // ni `perfilId`, que son detalles internos.
    return security.getOptionsByProfiles(profiles).map(
      ({ id, nombre, descripcion, subsistema }) => ({
        id,
        nombre,
        descripcion,
        subsistema,
      }),
    );
  }
}
