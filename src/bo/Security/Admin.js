import { security } from "../../security/Security.js";

export class Admin {
  async reloadPermissions() {
    security.refreshBo();
    await security.loadPermission();

    return {
      metodos: security.PermissionMethodMap.size,
      opciones: security.PermissionOptionMap.size,
    };
  }
}
