// node-pg entrega las columnas DATE como Date a medianoche LOCAL. Usar
// toISOString() en zonas con offset positivo devuelve el día anterior.
export const aFechaISO = (valor) => {
  if (typeof valor === "string") {
    return valor.slice(0, 10);
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const anio = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  }
  return valor;
};
