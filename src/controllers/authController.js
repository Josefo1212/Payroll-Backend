import { authenticateUser } from "../services/authService.js";

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

    request.session.userID = user.id;
    request.session.userName = user.nombre || user.username;
    request.session.Profile = user.rol || "usuario";

    response.status(200).json({
      mensaje: "Login exitoso",
      user: {
        id: user.id,
        username: user.username,
        nombre: request.session.userName,
        perfil: request.session.Profile,
      },
    });
  } catch (error) {
    console.error("Error en login:", error);
    response.status(500).json({ error: "Error interno del servidor" });
  }
};

export const getCurrentUser = (request, response) => {
  response.status(200).json({
    userID: request.session.userID,
    userName: request.session.userName,
    Profile: request.session.Profile,
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
