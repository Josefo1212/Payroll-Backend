import bcrypt from "bcrypt";
import { db } from "../database/Database.js";
import { queries } from "../queries/loader.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";
import { MAX_INTENTOS_FALLIDOS, MINUTOS_BLOQUEO } from "../config/security.js";

// RF-14: todo login fallido queda en el log con su motivo.
const registrarFallo = (username, motivo) => {
  console.warn(
    `[RF-14] Login fallido: username="${username}" motivo=${motivo} fecha=${new Date().toISOString()}`,
  );
};

// Autentica contra la base con bcrypt. Devuelve el usuario o null si las
// credenciales no coinciden (mismo resultado para usuario inexistente y
// clave incorrecta: no se filtra cuál de los dos falló). Lanza
// ErrorNegocio 423 si la cuenta está bloqueada y el bloqueo no expiró.
export const authenticateUser = async (username, password) => {
  const result = await db.query(queries.findUserByUsername, [username]);
  const user = result.rows[0];

  if (!user) {
    registrarFallo(username, "usuario_inexistente");
    return null;
  }

  if (!user.activo) {
    registrarFallo(username, "cuenta_inactiva");
    return null;
  }

  if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
    registrarFallo(username, "cuenta_bloqueada");
    throw new ErrorNegocio(
      `Cuenta bloqueada. Intenta de nuevo después de ${MINUTOS_BLOQUEO} minutos.`,
      423,
    );
  }

  const coincide = await bcrypt.compare(password, user.password_hash);

  if (!coincide) {
    registrarFallo(username, "clave_incorrecta");
    // El contador se calcula en la base: dos intentos simultáneos no se pisan.
    await db.query(queries.registerFailedAttempt, [
      user.id,
      MINUTOS_BLOQUEO,
      MAX_INTENTOS_FALLIDOS,
    ]);
    return null;
  }

  await db.query(queries.resetAttemptsAndAccess, [user.id]);
  return user;
};
