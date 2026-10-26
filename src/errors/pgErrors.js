const TRADUCCIONES_PG = {
  "23503": "No se puede eliminar o actualizar porque existe información relacionada.",
  "23505": "Ya existe un registro con esa información.",
  "23514": "Los datos no cumplen con las restricciones del sistema.",
  "22P02": "Formato de datos inválido.",
  "23001": "No se puede eliminar porque está siendo utilizado.",
};

export const traducirErrorPg = (error) => {
  const codigo = error?.code;
  if (codigo && TRADUCCIONES_PG[codigo]) {
    return {
      traducido: true,
      mensaje: TRADUCCIONES_PG[codigo],
    };
  }
  return {
    traducido: false,
    mensaje: null,
  };
};
