import { security } from "../../security/Security.js";

export class Menu {
  #req;

  constructor(db, req) {
    this.#req = req;
  }

  getOptions() {
    const profiles = Array.isArray(this.#req?.session?.profiles)
      ? this.#req.session.profiles
      : [];

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
}
