export const MAX_INTENTOS_FALLIDOS = Number(
  process.env.LOGIN_MAX_ATTEMPTS || 5,
);
export const MINUTOS_BLOQUEO = Number(process.env.LOGIN_BLOCK_MINUTES || 15);

// Límite por IP de intentos fallidos de login (fuerza bruta distribuida).
// Es independiente del bloqueo por cuenta: aquel protege una cuenta, este
// protege el endpoint desde una misma IP.
export const MAX_FALLOS_LOGIN_POR_IP = Number(
  process.env.LOGIN_RATE_MAX || 10,
);
export const MINUTOS_VENTANA_LOGIN = Number(
  process.env.LOGIN_RATE_WINDOW_MINUTES || 15,
);
