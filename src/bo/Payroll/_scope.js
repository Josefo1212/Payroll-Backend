import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const PERFILES_GESTORES = new Set([
  "RRHH",
  "GerenteRRHH",
  "Administrador",
  "Superusuario",
]);

export const esGestorNomina = (req) => {
  const detalles = Array.isArray(req?.session?.detallesPerfiles)
    ? req.session.detallesPerfiles
    : [];
  return detalles.some((perfil) => PERFILES_GESTORES.has(perfil?.nombre));
};

export const usuarioIdDeSesion = (req) => {
  const usuarioId = req?.session?.userID;
  if (!usuarioId) {
    throw new ErrorNegocio("Debes iniciar sesión.", 401);
  }
  return usuarioId;
};

export const personaIdDeSesion = async (db, req) => {
  const usuarioId = usuarioIdDeSesion(req);
  const { rows } = await db.query(queries.findPersonaByUsuario, [usuarioId]);
  const personaId = rows[0]?.persona_id;
  if (!personaId) {
    throw new ErrorNegocio("El usuario no tiene una persona asociada.", 403);
  }
  return personaId;
};
