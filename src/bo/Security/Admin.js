import { security } from "../../security/Security.js";

// Objeto de negocio de administración de la seguridad. reloadPermissions
// permite aplicar cambios de permisos hechos en la BD sin reiniciar el
// servidor: loadPermission() reemplaza los mapas de forma atómica.
export class Admin {
  // Recarga los mapas en memoria y devuelve cuántos métodos y opciones
  // quedaron cargados. Refresca también el descubrimiento de BO para que un
  // objeto de negocio nuevo se vea sin reiniciar el servidor.
  async reloadPermissions() {
    security.refreshBo();
    await security.loadPermission();

    return {
      metodos: security.PermissionMethodMap.size,
      opciones: security.PermissionOptionMap.size,
    };
  }
}
