// Extrae solo los campos de un error que son seguros para el log. Los errores
// de PostgreSQL traen `detail` con los valores que violaron una restricción
// (cédula, email, etc.), así que nunca se registra el objeto completo.
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
