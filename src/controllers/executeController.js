import { security } from "../security/Security.js";

// Único punto de entrada al negocio. El controlador no conoce reglas de
// negocio ni SQL: solo delega en executeMethod, que ya validó forma, permiso
// y reflexión, y traduce su `status`/`body` a HTTP.
class ExecuteController {
  ejecutar = async (request, response) => {
    try {
      const { status, body } = await security.executeMethod(
        request.body,
        request.session,
      );
      response.status(status).json(body);
    } catch (error) {
      console.error("Error en POST /execute:", error);
      response.status(500).json({ error: "Error interno del servidor" });
    }
  };
}

export const executeController = new ExecuteController();
