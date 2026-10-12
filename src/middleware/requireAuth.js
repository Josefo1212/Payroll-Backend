export const requireAuth = (request, response, next) => {
  if (!request.session.userID) {
    return response.status(401).json({ error: "No autorizado. Debes iniciar sesión." });
  }

  next();
};
