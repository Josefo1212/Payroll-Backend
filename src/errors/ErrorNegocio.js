// Error de negocio: los objetos de negocio lo lanzan para señalar una
// respuesta HTTP concreta (400 datos inválidos, 409 conflicto, etc.) sin
// conocer Express. La capa de seguridad lo traduce a { status, body }.
class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = "ErrorNegocio";
    this.status = status;
  }
}

export { ErrorNegocio };
