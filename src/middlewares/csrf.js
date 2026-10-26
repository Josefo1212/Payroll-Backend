export const verificarOrigenCsrf = (req, res, next) => {
  const metodo = req.method;
  if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") {
    return next();
  }

  const origen = req.headers.origin;
  const referer = req.headers.referer;

  const origenPermitido = process.env.FRONTEND_URL || "http://localhost:5173";

  if (origen) {
    if (origen === origenPermitido) {
      return next();
    }
    return res.status(403).json({ error: "Origen no permitido." });
  }

  if (referer) {
    try {
      const url = new URL(referer);
      const origenReferer = `${url.protocol}//${url.host}`;
      if (origenReferer === origenPermitido) {
        return next();
      }
    } catch {
      // Si no se puede parsear, continuar con política restrictiva
    }
    return res.status(403).json({ error: "Origen no permitido." });
  }

  // Sin Origin ni Referer: en desarrollo con herramientas puede ocurrir
  // Se mantiene comportamiento restrictivo pero se permite si es mismo host
  // Para este proyecto se requiere Origin/Referer
  return res.status(403).json({ error: "Origen no permitido." });
};
