import { security } from "../../security/Security.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

export class Menu {
  #req;

  constructor(db, req) {
    this.#req = req;
  }

  // Opciones de menú del usuario. Sin argumento devuelve la unión de todos los
  // perfiles de la sesión (lógica OR histórica). Con `perfilId` devuelve solo
  // ese perfil, siempre que pertenezca a la sesión: el front manda el perfil
  // activo para que el sidebar no muestre lo que otro perfil del mismo
  // usuario tiene asignado.
  getOptions(perfilId) {
    const profiles = Array.isArray(this.#req?.session?.profiles)
      ? this.#req.session.profiles.map(Number)
      : [];

    if (perfilId === undefined || perfilId === null) {
      if (profiles.length === 0) {
        return [];
      }

      return security.getOptionsByProfiles(profiles).map(
        ({ id, nombre, descripcion, subsistema }) => ({
          id,
          nombre,
          descripcion,
          subsistema,
        }),
      );
    }

    const id = Number(perfilId);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorNegocio("perfilId debe ser un entero positivo.", 400);
    }

    // Sin sesión no hay perfil que validar: el menú anónimo es vacío.
    if (!this.#req?.session?.userID) {
      return [];
    }

    if (!profiles.includes(id)) {
      throw new ErrorNegocio("El perfil no pertenece a la sesión.", 403);
    }

    return security.getOptionsByProfiles([id]).map(
      ({ id: opcionId, nombre, descripcion, subsistema }) => ({
        id: opcionId,
        nombre,
        descripcion,
        subsistema,
      }),
    );
  }
}
