const llaveMetodo = (subsistema, clase, metodo, perfilId) =>
  `${subsistema}_${clase}_${metodo}_${perfilId}`;

const llaveOpcion = (subsistema, opcion, perfilId) =>
  `${subsistema}_${opcion}_${perfilId}`;

export { llaveMetodo, llaveOpcion };
