// T11: caminos de error de executeMethod.
// El orden es forma -> permiso -> reflexion -> ejecucion. Para llegar a la
// reflexion (501) hay que conceder el permiso en memoria; si no, el 403
// tapa el caso. No toca la base: setPermissionMethod solo cambia el mapa.
import { security } from "../src/security/Security.js";
import { reqDe } from "./_req.mjs";

await security.loadPermission();

const superu = { userID: 1, userName: "admin", profiles: [2] };
const esperados = [];
const probar = async (nombre, jsonData, session, esperado) => {
  const r = await security.executeMethod(jsonData, reqDe(session));
  esperados.push({ nombre, status: r.status, esperado });
};

// 1. Forma.
await probar("400_subsys", { subsystem: "Seguridad_", class: "Usuario", method: "registrar", params: [] }, superu, 400);
await probar("400_class", { subsystem: "Seguridad", class: "Usuario_", method: "registrar", params: [] }, superu, 400);
await probar("400_method", { subsystem: "Seguridad", class: "Usuario", method: "registrar_", params: [] }, superu, 400);
await probar("400_params", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: {} }, superu, 400);

// 2. Permiso.
await probar("403_sinperm", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [] }, { userID: 9, userName: "t", profiles: [] }, 403);

// 3. Reflexion: se concede permiso para llegar a la busqueda del BO/metodo.
security.setPermissionMethod("Seguridad", "Xxx", "registrar", 2);
await probar("501_clase", { subsystem: "Seguridad", class: "Xxx", method: "registrar", params: [] }, superu, 501);

security.setPermissionMethod("Seguridad", "Usuario", "zzz", 2);
await probar("501_metodo", { subsystem: "Seguridad", class: "Usuario", method: "zzz", params: [] }, superu, 501);

// constructor tambien es propio del prototipo: debe quedar excluido.
security.setPermissionMethod("Seguridad", "Usuario", "constructor", 2);
await probar("501_constructor", { subsystem: "Seguridad", class: "Usuario", method: "constructor", params: [] }, superu, 501);

// toString no es propio del prototipo: tambien debe quedar fuera.
security.setPermissionMethod("Seguridad", "Usuario", "toString", 2);
await probar("501_toString", { subsystem: "Seguridad", class: "Usuario", method: "toString", params: [] }, superu, 501);

// __proto__ tiene guion bajo -> lo corta el regex de forma (400).
await probar("400_proto_class", { subsystem: "Seguridad", class: "__proto__", method: "registrar", params: [] }, superu, 400);
await probar("400_proto_method", { subsystem: "Seguridad", class: "Usuario", method: "__proto__", params: [] }, superu, 400);

console.table(esperados);

const fallidos = esperados.filter((caso) => caso.status !== caso.esperado);
if (fallidos.length > 0) {
  console.error("FALLARON:", fallidos);
  process.exit(1);
}
console.log("T11 OK");
process.exit(0);
