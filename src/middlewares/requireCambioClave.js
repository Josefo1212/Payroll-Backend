export const requerirSinCambioClave = (req, res, next) => {
  if (req?.session?.debeCambiarClave) {
    return res.status(403).json({
      error: "Debes cambiar tu contraseña antes de continuar.",
    });
  }
  return next();
};
