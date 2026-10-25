import { randomUUID } from "node:crypto";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { tokenService } from "../../services/TokenService.js";

const COOKIE_ACCESS = "access_token";
const COOKIE_REFRESH = "refresh_token";
const MENSAJE = "Sesión no válida, vuelve a iniciar sesión.";

export class Token {
  #db;
  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  async refresh() {
    const presentado = this.#leerRefresh();
    if (!presentado) {
      throw new ErrorNegocio(MENSAJE, 401);
    }

    const hash = tokenService.hashRefresh(presentado);
    const { rows } = await this.#db.query(queries.findRefreshTokenByHash, [hash]);
    const fila = rows[0];

    if (!fila) {
      throw new ErrorNegocio(MENSAJE, 401);
    }

    if (fila.revocado_en || fila.reemplazado_por) {
      await this.#db.query(queries.revokeFamily, [fila.familia_id]);
      console.warn(
        `Refresh reusado: familia ${fila.familia_id} revocada por completo.`,
      );
      throw new ErrorNegocio(MENSAJE, 401);
    }

    if (new Date(fila.expira_en) <= new Date()) {
      throw new ErrorNegocio(MENSAJE, 401);
    }

    const { rows: perfiles } = await this.#db.query(sessionQueries.findProfilesByUserId, [
      fila.usuario_id,
    ]);
    if (perfiles.length === 0) {
      throw new ErrorNegocio(MENSAJE, 401);
    }

    const { valor, hash: hashNuevo } = tokenService.generarRefresh();
    const expira = tokenService.expiracionRefresh();

    const nuevoId = await this.#db.transaction(async (cliente) => {
      const { rows: creada } = await cliente.query(queries.insertRefreshToken, [
        fila.usuario_id,
        fila.familia_id,
        hashNuevo,
        expira,
        this.#req?.ip ?? null,
        this.#req?.get?.("user-agent") ?? null,
      ]);
      const id = creada[0].id;
      await cliente.query(queries.revokeRefreshToken, [fila.id, id]);
      return id;
    });

    const detalle = perfiles.map((p) => ({ id: p.perfil_id, nombre: p.nombre_perfil }));
    const access = await tokenService.firmarAccess({
      userID: fila.usuario_id,
      userName: this.#req?.session?.userName ?? null,
      perfiles: detalle.map(({ id }) => id),
    });

    const res = this.#req?.res;
    if (res) {
      res.cookie(COOKIE_ACCESS, access, tokenService.opcionesCookie());
      res.cookie(COOKIE_REFRESH, valor, tokenService.opcionesCookie({ refresh: true }));
    }

    return { userID: fila.usuario_id, refreshID: nuevoId };
  }

  #leerRefresh() {
    const cookies = this.#req?.cookies;
    if (cookies && cookies[COOKIE_REFRESH]) {
      return cookies[COOKIE_REFRESH];
    }

    const crudo = this.#req?.headers?.cookie;
    if (!crudo) {
      return null;
    }

    const par = crudo
      .split(";")
      .map((parte) => parte.trim())
      .find((parte) => parte.startsWith(`${COOKIE_REFRESH}=`));

    return par ? decodeURIComponent(par.slice(COOKIE_REFRESH.length + 1)) : null;
  }
}
