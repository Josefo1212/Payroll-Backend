import "./_guard.mjs";
import { security } from "../../src/security/Security.js";
import { reqDe } from "./_req.mjs";

await security.loadPermission();

const sesionSinPermiso = { userID: 9999, userName: "test", profiles: [] };
const sesionSuper = { userID: 1, userName: "admin_prueba", profiles: [2] };

const casos = [];

async function test(nombre, jsonData, session) {
  const r = await security.executeMethod(jsonData, reqDe(session));
  casos.push({ nombre, status: r.status, body: r.body });
}

await test("400_forma_subsystem_invalido", { subsystem: "Seguridad_", class: "Usuario", method: "registrar", params: [] }, sesionSuper);
await test("400_forma_class_invalido", { subsystem: "Seguridad", class: "Usuario_", method: "registrar", params: [] }, sesionSuper);
await test("400_forma_method_invalido", { subsystem: "Seguridad", class: "Usuario", method: "registrar_", params: [] }, sesionSuper);
await test("400_forma_params_no_array", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: {} }, sesionSuper);
await test("403_sin_permiso", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [] }, sesionSinPermiso);
await test("501_clase_inexistente", { subsystem: "Seguridad", class: "Xxx", method: "registrar", params: [] }, sesionSuper);
await test("501_metodo_inexistente", { subsystem: "Seguridad", class: "Usuario", method: "zzz", params: [] }, sesionSuper);
await test("proto_constructor", { subsystem: "Seguridad", class: "Usuario", method: "constructor", params: [] }, sesionSuper);
await test("proto_toString", { subsystem: "Seguridad", class: "Usuario", method: "toString", params: [] }, sesionSuper);
await test("proto___proto__", { subsystem: "Seguridad", class: "__proto__", method: "registrar", params: [] }, sesionSuper);

console.table(casos);
process.exit(0);
