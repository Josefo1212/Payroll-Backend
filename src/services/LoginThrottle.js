const RETARDO_MAX = Number(process.env.LOGIN_FAIL_DELAY_MS ?? 400);

const pausaCredenciales = async (retardoMax = RETARDO_MAX) => {
  if (!(retardoMax > 0)) {
    return;
  }
  const minimo = Math.floor(retardoMax / 2);
  const espera = minimo + Math.floor(Math.random() * (retardoMax - minimo + 1));
  await new Promise((resolve) => setTimeout(resolve, espera));
};

export { pausaCredenciales, RETARDO_MAX };
