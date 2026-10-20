// Helpers de los scripts de verificación: executeMethod recibe la petición
// (req) completa y los BO leen req.session.
//
// - reqDe(session): envuelve un objeto de sesión plano. Sirve para las pruebas
//   de reflexión/permiso que no tocan la base ni la sesión real.
// - crearReq: doble de petición con sesión estilo express-session
//   (regenerate/save/destroy), reutilizado del arnés de pruebas, para los
//   flujos que sí hacen login/logout de verdad.
export { crearReq } from "../test/helpers.js";

export const reqDe = (session) => ({ session });
