import { esOrigenPermitido } from "../config/http.js";

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defensa CSRF por origen, complementaria a SameSite=Lax. Solo se aplica a
// métodos que cambian estado: un GET no debe modificar nada.
//
// - Con Origin: debe estar en la lista permitida.
// - Sin Origin pero con Referer: se compara el origen del Referer.
// - Sin Origin ni Referer: se deja pasar. No hay navegador que haga un POST
//   cross-site sin Origin, y los scripts de verificación (curl, Node) no lo
//   mandan; bloquearlos rompería los E2E sin aportar seguridad.
export const verificarOrigen = (req, res, next) => {
  if (METODOS_SEGUROS.has(req.method)) {
    return next();
  }

  const origen = req.headers.origin;
  if (origen) {
    return esOrigenPermitido(origen)
      ? next()
      : res.status(403).json({ error: "Origen no permitido." });
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      const { origin } = new URL(referer);
      return esOrigenPermitido(origin)
        ? next()
        : res.status(403).json({ error: "Origen no permitido." });
    } catch {
      return res.status(403).json({ error: "Origen no permitido." });
    }
  }

  return next();
};
