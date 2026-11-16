import { ErrorNegocio } from "../errors/ErrorNegocio.js";

// Los límites replican los varchar de la BD. Validar acá convierte el 22001
// de PostgreSQL ("value too long for type character varying") en un 400 que
// nombra el campo. El recorte con trim evita guardar espacios sobrantes y
// hace que "   " no cuente como texto.
class TextoService {
  requerido = (valor, campo, maximo) => {
    const limpio = typeof valor === "string" ? valor.trim() : "";
    if (!limpio) {
      throw new ErrorNegocio(`El campo ${campo} es obligatorio.`, 400);
    }
    if (limpio.length > maximo) {
      throw new ErrorNegocio(
        `El campo ${campo} admite hasta ${maximo} caracteres.`,
        400,
      );
    }
    return limpio;
  };

  opcional = (valor, campo, maximo) => {
    if (valor === undefined || valor === null || valor === "") {
      return null;
    }
    if (typeof valor !== "string") {
      throw new ErrorNegocio(`El campo ${campo} debe ser texto.`, 400);
    }
    const limpio = valor.trim();
    if (!limpio) {
      return null;
    }
    if (limpio.length > maximo) {
      throw new ErrorNegocio(
        `El campo ${campo} admite hasta ${maximo} caracteres.`,
        400,
      );
    }
    return limpio;
  };
}

export { TextoService };
export const textoService = new TextoService();
