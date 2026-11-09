import { security } from "../../security/Security.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const PERFIL_PROTEGIDO = "Superusuario";

// 3–50 caracteres alfanuméricos, empezando por letra. Es la misma forma de
// los perfiles del seed (GerenteRRHH, Superusuario) y evita nombres con
// espacios o guiones que romperían la lectura del menú.
const NOMBRE_PERFIL = /^[A-Za-z][A-Za-z0-9]{2,49}$/;

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

  async listarPerfilesAdmin() {
    const { rows } = await this.#db.query(queries.findAllProfilesAdmin);
    return rows.map((fila) => this.#formatearPerfilConUso(fila));
  }

  async crearPerfil(nombre, descripcion) {
    const nombreLimpio = this.#validarNombre(nombre);
    const descripcionLimpia = this.#normalizarDescripcion(descripcion);

    try {
      const creado = await this.#db.transaction(async (cliente) => {
        const duplicado = await cliente.query(queries.findPerfilByNombre, [
          nombreLimpio,
        ]);
        if (duplicado.rows.length > 0) {
          throw new ErrorNegocio("Ya existe un perfil con ese nombre.", 409);
        }

        const perfil = await cliente.query(queries.insertPerfil, [
          nombreLimpio,
          descripcionLimpia,
        ]);
        const permisos = await cliente.query(queries.insertPermisosBasePerfil, [
          perfil.rows[0].id,
        ]);

        return { fila: perfil.rows[0], permisosBase: permisos.rowCount };
      });

      // El perfil nace con permisos: el mapa debe verlos ya, sin reiniciar.
      await security.loadPermission();

      return {
        ...this.#formatearPerfil(creado.fila),
        permisosBase: creado.permisosBase,
      };
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio("Ya existe un perfil con ese nombre.", 409);
      }
      throw error;
    }
  }

  async editarPerfil(perfilId, nombre, descripcion) {
    const id = this.#validarId(perfilId, "perfilId");
    const nombreLimpio = this.#validarNombre(nombre);
    const descripcionLimpia = this.#normalizarDescripcion(descripcion);
    const perfil = await this.#exigirPerfilExistente(id);

    if (
      perfil.nombre_perfil === PERFIL_PROTEGIDO &&
      nombreLimpio !== PERFIL_PROTEGIDO
    ) {
      throw new ErrorNegocio(
        `El perfil ${PERFIL_PROTEGIDO} no se puede renombrar.`,
        409,
      );
    }

    try {
      const duplicado = await this.#db.query(
        queries.findPerfilByNombreExcepto,
        [nombreLimpio, id],
      );
      if (duplicado.rows.length > 0) {
        throw new ErrorNegocio("Ya existe un perfil con ese nombre.", 409);
      }

      const { rows } = await this.#db.query(queries.updatePerfil, [
        nombreLimpio,
        descripcionLimpia,
        id,
      ]);

      return this.#formatearPerfil(rows[0]);
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio("Ya existe un perfil con ese nombre.", 409);
      }
      throw error;
    }
  }

  async cambiarEstadoPerfil(perfilId, activo) {
    const id = this.#validarId(perfilId, "perfilId");

    if (typeof activo !== "boolean") {
      throw new ErrorNegocio("activo debe ser un booleano.", 400);
    }

    const perfil = await this.#exigirPerfilExistente(id);

    if (perfil.nombre_perfil === PERFIL_PROTEGIDO && activo === false) {
      throw new ErrorNegocio(
        `El perfil ${PERFIL_PROTEGIDO} no se puede desactivar.`,
        409,
      );
    }

    if (perfil.activo === activo) {
      return { ...this.#formatearPerfil(perfil), cambio: false };
    }

    const { rows } = await this.#db.query(queries.updatePerfilActivo, [
      activo,
      id,
    ]);

    // loadPermission filtra pf.activo: al desactivar, sus llaves desaparecen;
    // al reactivar, vuelven.
    await security.loadPermission();

    return { ...this.#formatearPerfil(rows[0]), cambio: true };
  }

  #formatearPerfil = (fila) => ({
    id: fila.id,
    nombre: fila.nombre_perfil,
    descripcion: fila.descripcion,
    activo: fila.activo,
    protegido: fila.nombre_perfil === PERFIL_PROTEGIDO,
  });

  #formatearPerfilConUso = (fila) => ({
    ...this.#formatearPerfil(fila),
    usuarios: fila.usuarios,
    usuariosActivos: fila.usuarios_activos,
  });

  #validarNombre = (nombre) => {
    if (typeof nombre !== "string" || !NOMBRE_PERFIL.test(nombre.trim())) {
      throw new ErrorNegocio(
        "El nombre del perfil debe tener entre 3 y 50 caracteres alfanuméricos y empezar con una letra.",
        400,
      );
    }

    return nombre.trim();
  };

  #normalizarDescripcion = (descripcion) => {
    if (descripcion == null) {
      return null;
    }

    if (typeof descripcion !== "string") {
      throw new ErrorNegocio("La descripción debe ser texto.", 400);
    }

    const limpia = descripcion.trim();
    if (limpia.length > 200) {
      throw new ErrorNegocio(
        "La descripción no puede superar los 200 caracteres.",
        400,
      );
    }

    return limpia === "" ? null : limpia;
  };

  #exigirPerfilExistente = async (perfilId) => {
    const { rows } = await this.#db.query(queries.findPerfilById, [perfilId]);
    const perfil = rows[0];

    if (!perfil) {
      throw new ErrorNegocio("El perfil no existe.", 404);
    }

    return perfil;
  };

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
