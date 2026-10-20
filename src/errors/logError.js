const SQLSTATE = /^[0-9A-Z]{5}$/;

const datosSegurosDeError = (error) => {
  const datos = {
    nombre: error?.name,
    codigo: error?.code,
  };

  if (typeof error?.code === "string" && SQLSTATE.test(error.code)) {
    datos.restriccion = error.constraint;
    datos.tabla = error.table;
  } else {
    datos.mensaje = error?.message;
  }

  return Object.fromEntries(
    Object.entries(datos).filter(([, valor]) => valor != null),
  );
};

export { datosSegurosDeError };
