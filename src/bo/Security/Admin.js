import { security } from "../../security/Security.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";

const PERFIL_PROTEGIDO = "Superusuario";

// 3–50 caracteres alfanuméricos, empezando por letra. Es la misma forma de
// los perfiles del seed (GerenteRRHH, Superusuario) y evita nombres con
// espacios o guiones que romperían la lectura del menú.
const NOMBRE_PERFIL = /^[A-Za-z][A-Za-z0-9]{2,49}$/;

// 2–80 caracteres alfanuméricos, empezando por letra. Sin `_`: la llave del
// mapa es `Subsistema_nombre_perfilId` y el guion bajo volvería ambiguas dos
// combinaciones distintas.
const NOMBRE_OPCION = /^[A-Za-z][A-Za-z0-9]{1,79}$/;

// Rango de `opcion.orden` en la BD (smallint). Se valida antes para no
// provocar un 22003 desde PostgreSQL.
const ORDEN_MAX = 32767;

// Opciones sin las cuales Superusuario no podría volver a administrar la
// seguridad desde el menú. La guarda vive por nombre: renombrarlas también
// está prohibido (si no, apuntaría a un nombre inexistente).
const OPCIONES_CRITICAS = new Set([
  "Security/Opciones",
  "Security/Permisos",
  "Security/Perfiles",
  "Security/Usuarios",
]);

// Métodos sin los cuales nadie podría volver a administrar permisos.
// Quitárselos a Superusuario dejaría la vista inservible para siempre.
const METODOS_CRITICOS = new Set([
  "Security/Admin/listarMetodos",
  "Security/Admin/listarPermisosMetodo",
  "Security/Admin/asignarPermisoMetodo",
  "Security/Admin/quitarPermisoMetodo",
  "Security/Admin/listarOpciones",
  "Security/Admin/crearOpcion",
  "Security/Admin/editarOpcion",
  "Security/Admin/cambiarEstadoOpcion",
  "Security/Admin/listarPermisosOpcion",
  "Security/Admin/asignarPermisoOpcion",
  "Security/Admin/quitarPermisoOpcion",
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

  async listarOpciones() {
    const { rows } = await this.#db.query(queries.findAllOptionsAdmin);
    return rows.map((fila) => this.#formatearOpcionConUso(fila));
  }

  async crearOpcion(subsistemaId, nombre, descripcion, orden) {
    const idSubsistema = this.#validarId(subsistemaId, "subsistemaId");
    const nombreLimpio = this.#validarNombreOpcion(nombre);
    const descripcionLimpia = this.#normalizarDescripcion(descripcion);
    const ordenLimpio = this.#validarOrden(orden);
    const subsistema = await this.#exigirSubsistema(idSubsistema);

    try {
      const duplicado = await this.#db.query(
        queries.findOpcionByNombreEnSubsistema,
        [idSubsistema, nombreLimpio],
      );
      if (duplicado.rows.length > 0) {
        throw new ErrorNegocio(
          "Ya existe una opción con ese nombre en el subsistema.",
          409,
        );
      }

      const { rows } = await this.#db.query(queries.insertOpcion, [
        idSubsistema,
        nombreLimpio,
        descripcionLimpia,
        ordenLimpio,
      ]);

      return {
        ...this.#formatearOpcion({
          ...rows[0],
          subsistema: subsistema.nombre,
        }),
        perfiles: 0,
      };
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio(
          "Ya existe una opción con ese nombre en el subsistema.",
          409,
        );
      }
      throw error;
    }
  }

  async editarOpcion(opcionId, nombre, descripcion, orden) {
    const id = this.#validarId(opcionId, "opcionId");
    const nombreLimpio = this.#validarNombreOpcion(nombre);
    const descripcionLimpia = this.#normalizarDescripcion(descripcion);
    const ordenLimpio = this.#validarOrden(orden);
    const opcion = await this.#exigirOpcionExistente(id);

    if (this.#esOpcionProtegida(opcion) && nombreLimpio !== opcion.opcion) {
      throw new ErrorNegocio(
        `La opción ${opcion.subsistema}/${opcion.opcion} no se puede renombrar.`,
        409,
      );
    }

    try {
      const duplicado = await this.#db.query(
        queries.findOpcionByNombreEnSubsistemaExcepto,
        [opcion.subsistema_id, nombreLimpio, id],
      );
      if (duplicado.rows.length > 0) {
        throw new ErrorNegocio(
          "Ya existe una opción con ese nombre en el subsistema.",
          409,
        );
      }

      const { rows } = await this.#db.query(queries.updateOpcion, [
        nombreLimpio,
        descripcionLimpia,
        ordenLimpio,
        id,
      ]);

      // El mapa guarda nombre, descripción y orden, y la llave incluye el
      // nombre: sin recarga el menú seguiría mostrando los valores viejos.
      await security.loadPermission();

      return this.#formatearOpcion({
        ...rows[0],
        subsistema: opcion.subsistema,
      });
    } catch (error) {
      if (error?.code === "23505") {
        throw new ErrorNegocio(
          "Ya existe una opción con ese nombre en el subsistema.",
          409,
        );
      }
      throw error;
    }
  }

  async cambiarEstadoOpcion(opcionId, activo) {
    const id = this.#validarId(opcionId, "opcionId");

    if (typeof activo !== "boolean") {
      throw new ErrorNegocio("activo debe ser un booleano.", 400);
    }

    const opcion = await this.#exigirOpcionExistente(id);

    if (this.#esOpcionProtegida(opcion) && activo === false) {
      throw new ErrorNegocio(
        `La opción ${opcion.subsistema}/${opcion.opcion} no se puede desactivar.`,
        409,
      );
    }

    if (opcion.activo === activo) {
      return { ...this.#formatearOpcion(opcion), cambio: false };
    }

    const { rows } = await this.#db.query(queries.updateOpcionActivo, [
      activo,
      id,
    ]);

    // loadPermission filtra o.activo: al desactivar, la opción desaparece de
    // todos los menús; al reactivar, vuelve.
    await security.loadPermission();

    return {
      ...this.#formatearOpcion({ ...rows[0], subsistema: opcion.subsistema }),
      cambio: true,
    };
  }

  async listarPermisosOpcion(perfilId) {
    const id = this.#validarId(perfilId, "perfilId");
    const perfil = await this.#exigirPerfil(id);

    const [catalogo, asignados] = await Promise.all([
      this.#db.query(queries.findAllActiveOptions),
      this.#db.query(queries.findPermisosOpcionPorPerfil, [id]),
    ]);

    const idsAsignados = new Set(asignados.rows.map((fila) => fila.opcion_id));

    return {
      perfil: {
        id: perfil.id,
        nombre: perfil.nombre_perfil,
        descripcion: perfil.descripcion,
      },
      opciones: catalogo.rows.map((fila) => ({
        ...this.#formatearOpcion(fila),
        asignado: idsAsignados.has(fila.id),
      })),
    };
  }

  async asignarPermisoOpcion(perfilId, opcionId) {
    const perfil = await this.#exigirPerfil(
      this.#validarId(perfilId, "perfilId"),
    );
    const opcion = await this.#exigirOpcion(
      this.#validarId(opcionId, "opcionId"),
    );

    // La base primero: si el INSERT falla, el mapa no miente.
    const { rowCount } = await this.#db.query(queries.insertPermisoOpcion, [
      perfil.id,
      opcion.id,
    ]);

    // `getOptionsByProfiles` lee estos seis campos; si falta uno, el menú
    // pinta undefined.
    security.setPermissionOption(
      opcion.subsistema,
      opcion.opcion,
      perfil.id,
      {
        id: opcion.id,
        nombre: opcion.opcion,
        orden: opcion.orden,
        descripcion: opcion.descripcion,
        subsistema: opcion.subsistema,
        perfilId: perfil.id,
      },
    );

    return {
      perfilId: perfil.id,
      perfil: perfil.nombre_perfil,
      opcionId: opcion.id,
      subsistema: opcion.subsistema,
      opcion: opcion.opcion,
      asignado: true,
      yaEstaba: rowCount === 0,
    };
  }

  async quitarPermisoOpcion(perfilId, opcionId) {
    const perfil = await this.#exigirPerfil(
      this.#validarId(perfilId, "perfilId"),
    );
    const opcion = await this.#exigirOpcion(
      this.#validarId(opcionId, "opcionId"),
    );

    if (
      perfil.nombre_perfil === PERFIL_PROTEGIDO &&
      this.#esOpcionProtegida(opcion)
    ) {
      throw new ErrorNegocio(
        `No se puede quitar ${opcion.subsistema}/${opcion.opcion}: es crítica para que Superusuario administre el menú.`,
        409,
      );
    }

    const { rowCount } = await this.#db.query(queries.deletePermisoOpcion, [
      perfil.id,
      opcion.id,
    ]);

    security.setPermissionOption(
      opcion.subsistema,
      opcion.opcion,
      perfil.id,
      null,
    );

    return {
      perfilId: perfil.id,
      perfil: perfil.nombre_perfil,
      opcionId: opcion.id,
      subsistema: opcion.subsistema,
      opcion: opcion.opcion,
      asignado: false,
      yaNoEstaba: rowCount === 0,
    };
  }

  async listarPerfilesAdmin() {
    const { rows } = await this.#db.query(queries.findAllProfilesAdmin);
    return rows.map((fila) => this.#formatearPerfilConUso(fila));
  }

  async crearPerfil(nombre, descripcion, perfilPlantillaId) {
    const nombreLimpio = this.#validarNombre(nombre);
    const descripcionLimpia = this.#normalizarDescripcion(descripcion);
    const plantillaId =
      perfilPlantillaId == null
        ? null
        : this.#validarId(perfilPlantillaId, "perfilPlantillaId");
    const plantilla =
      plantillaId === null ? null : await this.#exigirPerfil(plantillaId);

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
        const idNuevo = perfil.rows[0].id;
        const permisos = await cliente.query(queries.insertPermisosBasePerfil, [
          idNuevo,
        ]);

        if (!plantilla) {
          return {
            fila: perfil.rows[0],
            permisosBase: permisos.rowCount,
            conPlantilla: false,
          };
        }

        // Clonar métodos y opciones juntos deja al perfil coherente: no ve
        // entradas de menú que no puede ejecutar.
        await cliente.query(queries.insertPermisosDesdePlantillaMetodo, [
          idNuevo,
          plantilla.id,
        ]);
        await cliente.query(queries.insertPermisosDesdePlantillaOpcion, [
          idNuevo,
          plantilla.id,
        ]);

        const metodos = await cliente.query(
          queries.contarPermisosMetodoPerfil,
          [idNuevo],
        );
        const opciones = await cliente.query(
          queries.contarPermisosOpcionPerfil,
          [idNuevo],
        );

        return {
          fila: perfil.rows[0],
          permisosBase: permisos.rowCount,
          conPlantilla: true,
          permisosMetodo: metodos.rows[0].total,
          permisosOpcion: opciones.rows[0].total,
        };
      });

      // El perfil nace con permisos: el mapa debe verlos ya, sin reiniciar.
      await security.loadPermission();

      const base = {
        ...this.#formatearPerfil(creado.fila),
        permisosBase: creado.permisosBase,
      };

      if (!creado.conPlantilla) {
        return base;
      }

      return {
        ...base,
        permisosMetodo: creado.permisosMetodo,
        permisosOpcion: creado.permisosOpcion,
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

  #exigirSubsistema = async (subsistemaId) => {
    const { rows } = await this.#db.query(queries.findSubsistemaById, [
      subsistemaId,
    ]);
    const subsistema = rows[0];

    if (!subsistema || !subsistema.activo) {
      throw new ErrorNegocio("El subsistema no existe o está inactivo.", 404);
    }

    return subsistema;
  };

  // Para asignar/quitar: la opción debe poder verse en un menú.
  #exigirOpcion = async (opcionId) => {
    const opcion = await this.#exigirOpcionExistente(opcionId);

    if (!opcion.activo || !opcion.subsistema_activo) {
      throw new ErrorNegocio("La opción no existe o está inactiva.", 404);
    }

    return opcion;
  };

  // Para editar/cambiar estado: una opción inactiva se corrige antes de
  // reactivarla.
  #exigirOpcionExistente = async (opcionId) => {
    const { rows } = await this.#db.query(queries.findOpcionById, [opcionId]);
    const opcion = rows[0];

    if (!opcion) {
      throw new ErrorNegocio("La opción no existe.", 404);
    }

    return opcion;
  };

  #formatearOpcion = (fila) => {
    const nombre = fila.nombre ?? fila.opcion;

    return {
      id: fila.id,
      subsistemaId: fila.subsistema_id,
      subsistema: fila.subsistema,
      nombre,
      descripcion: fila.descripcion,
      orden: fila.orden,
      activo: fila.activo,
      protegida: OPCIONES_CRITICAS.has(`${fila.subsistema}/${nombre}`),
    };
  };

  #formatearOpcionConUso = (fila) => ({
    ...this.#formatearOpcion(fila),
    perfiles: fila.perfiles,
  });

  #esOpcionProtegida = (fila) =>
    OPCIONES_CRITICAS.has(`${fila.subsistema}/${fila.opcion ?? fila.nombre}`);

  #validarNombreOpcion = (nombre) => {
    if (typeof nombre !== "string" || !NOMBRE_OPCION.test(nombre.trim())) {
      throw new ErrorNegocio(
        "El nombre de la opción debe tener entre 2 y 80 caracteres alfanuméricos, empezar con una letra y no llevar guion bajo.",
        400,
      );
    }

    return nombre.trim();
  };

  #validarOrden = (orden) => {
    const numerico =
      typeof orden === "number" ||
      (typeof orden === "string" && orden.trim() !== "");
    const numero = numerico ? Number(orden) : Number.NaN;

    if (!Number.isInteger(numero) || numero < 0 || numero > ORDEN_MAX) {
      throw new ErrorNegocio(
        `El orden debe ser un entero entre 0 y ${ORDEN_MAX}.`,
        400,
      );
    }

    return numero;
  };
}
