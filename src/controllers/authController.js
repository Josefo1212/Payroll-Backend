import { authenticateUser } from "../services/authService.js";
import { db } from "../database/Database.js";
import { queries } from "../queries/loader.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";

export const login = async (request, response) => {
  const { username, password } = request.body;

  if (!username || !password) {
    return response.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    const user = await authenticateUser(username, password);

    if (!user) {
      return response.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const perfiles = await db.query(queries.findProfilesByUserId, [user.id]);

    // Todo sale de la sesión: userID para requireAuth, profiles (arreglo
    // de ids) para los permisos de executeMethod.
    request.session.userID = user.id;
    request.session.userName = user.nombre || user.username;
    request.session.profiles = perfiles.rows.map((fila) => fila.perfil_id);

    response.status(200).json({
      mensaje: "Login exitoso",
      user: {
        id: user.id,
        username: user.username,
        nombre: request.session.userName,
        profiles: request.session.profiles,
      },
    });
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      return response.status(error.status).json({ error: error.message });
    }
    console.error("Error en login:", error);
    response.status(500).json({ error: "Error interno del servidor" });
  }
};

export const getCurrentUser = (request, response) => {
  response.status(200).json({
    userName: request.session.userName,
    profiles: request.session.profiles,
  });
};

export const logout = (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      return response.status(500).json({ error: "Error al cerrar la sesión" });
    }

    response.clearCookie("connect.sid");
    response.status(200).json({ mensaje: "Sesión cerrada correctamente" });
  });
};
