import { security } from "../../security/Security.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const PERFIL_PROTEGIDO = "Superusuario";

// Métodos sin los cuales nadie podría volver a administrar permisos.
// Quitárselos a Superusuario dejaría la vista inservible para siempre.
const METODOS_CRITICOS = new Set([
  "Security/Admin/listarMetodos",
  "Security/Admin/listarPermisosMetodo",
  "Security/Admin/asignarPermisoMetodo",
  "Security/Admin/quitarPermisoMetodo",
  "Security/User/listarPerfiles",
]);

export class Admin {
  #db;
  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  async reloadPermissions() {
    security.refreshBo();
    await security.loadPermission();

    return {
      metodos: security.PermissionMethodMap.size,
      opciones: security.PermissionOptionMap.size,
    };
  }

  async listarMetodos() {
    const { rows } = await this.#db.query(queries.findAllActiveMethods);
    return rows.map((fila) => this.#formatearMetodo(fila));
  }

  async listarPermisosMetodo(perfilId) {
    const id = this.#validarId(perfilId, "perfilId");
    const perfil = await this.#exigirPerfil(id);

    const [catalogo, asignados] = await Promise.all([
      this.#db.query(queries.findAllActiveMethods),
      this.#db.query(queries.findPermisosMetodoPorPerfil, [id]),
    ]);

    const idsAsignados = new Set(asignados.rows.map((fila) => fila.metodo_id));

    return {
      perfil: {
        id: perfil.id,
        nombre: perfil.nombre_perfil,
        descripcion: perfil.descripcion,
      },
      metodos: catalogo.rows.map((fila) => ({
        ...this.#formatearMetodo(fila),
        asignado: idsAsignados.has(fila.id),
      })),
    };
  }

  async asignarPermisoMetodo(perfilId, metodoId) {
    const perfil = await this.#exigirPerfil(
      this.#validarId(perfilId, "perfilId"),
    );
    const metodo = await this.#exigirMetodo(
      this.#validarId(metodoId, "metodoId"),
    );

    // La base primero: si el INSERT falla, el mapa no miente.
    const { rowCount } = await this.#db.query(queries.insertPermisoMetodo, [
      perfil.id,
      metodo.id,
    ]);

    security.setPermissionMethod(
      metodo.subsistema,
      metodo.clase,
      metodo.metodo,
      perfil.id,
      true,
    );

    return {
      perfilId: perfil.id,
      perfil: perfil.nombre_perfil,
      metodoId: metodo.id,
      subsistema: metodo.subsistema,
      clase: metodo.clase,
      metodo: metodo.metodo,
      asignado: true,
      yaEstaba: rowCount === 0,
    };
  }

  async quitarPermisoMetodo(perfilId, metodoId) {
    const perfil = await this.#exigirPerfil(
      this.#validarId(perfilId, "perfilId"),
    );
    const metodo = await this.#exigirMetodo(
      this.#validarId(metodoId, "metodoId"),
    );

    if (
      perfil.nombre_perfil === PERFIL_PROTEGIDO &&
      this.#esCritico(metodo)
    ) {
      throw new ErrorNegocio(
        `No se puede quitar ${metodo.subsistema}/${metodo.clase}/${metodo.metodo}: es crítico para que Superusuario administre permisos.`,
        409,
      );
    }

    const { rowCount } = await this.#db.query(queries.deletePermisoMetodo, [
      perfil.id,
      metodo.id,
    ]);

    security.setPermissionMethod(
      metodo.subsistema,
      metodo.clase,
      metodo.metodo,
      perfil.id,
      false,
    );

    return {
      perfilId: perfil.id,
      perfil: perfil.nombre_perfil,
      metodoId: metodo.id,
      subsistema: metodo.subsistema,
      clase: metodo.clase,
      metodo: metodo.metodo,
      asignado: false,
      yaNoEstaba: rowCount === 0,
    };
  }

  #formatearMetodo = (fila) => ({
    id: fila.id,
    subsistema: fila.subsistema,
    clase: fila.clase,
    metodo: fila.metodo,
    descripcion: fila.descripcion,
    critico: this.#esCritico(fila),
  });

  #esCritico = (fila) =>
    METODOS_CRITICOS.has(`${fila.subsistema}/${fila.clase}/${fila.metodo}`);

  // El borde se valida antes de tocar la base: nunca se consulta con NaN.
  #validarId = (valor, campo) => {
    const numerico =
      typeof valor === "number" ||
      (typeof valor === "string" && valor.trim() !== "");
    const id = numerico ? Number(valor) : Number.NaN;

    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorNegocio(`${campo} debe ser un id entero positivo.`, 400);
    }

    return id;
  };

  #exigirPerfil = async (perfilId) => {
    const { rows } = await this.#db.query(queries.findPerfilById, [perfilId]);
    const perfil = rows[0];

    if (!perfil || !perfil.activo) {
      throw new ErrorNegocio("El perfil no existe o está inactivo.", 404);
    }

    return perfil;
  };

  #exigirMetodo = async (metodoId) => {
    const { rows } = await this.#db.query(queries.findMetodoById, [metodoId]);
    const metodo = rows[0];

    if (
      !metodo ||
      !metodo.activo ||
      !metodo.clase_activa ||
      !metodo.subsistema_activo
    ) {
      throw new ErrorNegocio("El método no existe o está inactivo.", 404);
    }

    return metodo;
  };
}
