const VENTANA_POR_DEFECTO_MS = 15 * 60 * 1000;
const MAXIMO_POR_DEFECTO = 10;
const MAX_ENTRADAS = 5_000;

// Limita por IP los intentos fallidos de una ruta (login). No cuenta los
// aciertos ni los 429: un usuario que entra bien varias veces no se bloquea,
// y el bloqueo por cuenta (usuario.bloqueado_hasta) sigue siendo la defensa
// principal. Este límite frena la fuerza bruta distribuida contra muchas
// cuentas desde una misma IP.
//
// `ahora` se inyecta para poder probar el paso del tiempo sin esperar.
export const crearLimiteDeFallos = ({
  maximo = MAXIMO_POR_DEFECTO,
  ventanaMs = VENTANA_POR_DEFECTO_MS,
  ahora = Date.now,
} = {}) => {
  const fallos = new Map();

  const vigente = (ip, instante) => {
    const registro = fallos.get(ip);
    return registro && registro.reiniciaEn > instante ? registro : null;
  };

  // Barrido perezoso: evita que un atacante que rota IPs haga crecer el mapa
  // sin límite. No se usa setInterval para no dejar temporizadores vivos.
  const podar = (instante) => {
    if (fallos.size < MAX_ENTRADAS) {
      return;
    }
    for (const [ip, registro] of fallos) {
      if (registro.reiniciaEn <= instante) {
        fallos.delete(ip);
      }
    }
  };

  const middleware = (req, res, next) => {
    const instante = ahora();
    const ip = req.ip || req.socket?.remoteAddress || "desconocida";
    const registro = vigente(ip, instante);

    if (registro && registro.conteo >= maximo) {
      const segundos = Math.max(1, Math.ceil((registro.reiniciaEn - instante) / 1000));
      res.set("Retry-After", String(segundos));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Vuelve a intentar en ${segundos} segundos.`,
      });
    }

    res.on("finish", () => {
      // El 429 ya lo puso este middleware: no se cuenta a sí mismo.
      if (res.statusCode === 429) {
        return;
      }

      const momento = ahora();
      if (res.statusCode >= 400) {
        podar(momento);
        const previo = vigente(ip, momento);
        fallos.set(ip, {
          conteo: (previo?.conteo ?? 0) + 1,
          reiniciaEn: previo?.reiniciaEn ?? momento + ventanaMs,
        });
        return;
      }

      fallos.delete(ip);
    });

    return next();
  };

  return {
    middleware,
    limpiar: () => fallos.clear(),
    fallos,
  };
};
