// Parámetros de bloqueo de cuentas. Viven acá (no hardcodeados en el
// servicio) para poder ajustarlos sin tocar la lógica del login. Se pueden
// sobrescribir por .env.
export const MAX_INTENTOS_FALLIDOS = Number(
  process.env.LOGIN_MAX_ATTEMPTS || 5,
);
export const MINUTOS_BLOQUEO = Number(process.env.LOGIN_BLOCK_MINUTES || 15);
