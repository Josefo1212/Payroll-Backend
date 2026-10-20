import { security } from "../../src/security/Security.js";

// Objeto de negocio de administración de la seguridad. reloadPermissions
// permite aplicar cambios de permisos hechos en la BD sin reiniciar el
// servidor: loadPermission() reemplaza los mapas de forma atómica.
export class Admin {
  // Recarga los mapas en memoria y devuelve cuántos métodos y opciones
  // quedaron cargados.
  async reloadPermissions() {
    await security.loadPermission();

    return {
      metodos: security.PermissionMethodMap.size,
      opciones: security.PermissionOptionMap.size,
    };
  }
}
