import bcrypt from "bcrypt";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";

const COSTO_HASH = 12;
const MIN_CARACTERES = 8;
const MAX_BYTES = 72;

const HASH_DUMMY = "$2b$12$LybMgOxOi4wCQe0BWoOKXuuEnpNuJm8XqE5ORx8y1kLkuOfiu7zSO";

class PasswordService {
  validar = (password) => {
    if (typeof password !== "string" || password.length < MIN_CARACTERES) {
      throw new ErrorNegocio(
        `La contraseña debe tener al menos ${MIN_CARACTERES} caracteres.`,
        400,
      );
    }

    if (Buffer.byteLength(password, "utf8") > MAX_BYTES) {
      throw new ErrorNegocio(
        `La contraseña no puede superar los ${MAX_BYTES} bytes.`,
        400,
      );
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new ErrorNegocio(
        "La contraseña debe incluir al menos una letra y un número.",
        400,
      );
    }
  };

  hashear = (password) => bcrypt.hash(password, COSTO_HASH);

  verificar = (password, hash) => bcrypt.compare(password, hash);

  verificarContraDummy = (password) => bcrypt.compare(password, HASH_DUMMY);
}

export { PasswordService };
export const passwordService = new PasswordService();
