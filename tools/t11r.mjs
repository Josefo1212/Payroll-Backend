import { security } from "../src/security/Security.js";

await security.loadPermission();

const casos = [];
async function test(nombre, jsonData, session) {
  const r = await security.executeMethod(jsonData, session);
  casos.push({ nombre, status: r.status });
}

const superu = { userID: 1, userName: "admin", profiles: [2] };
await test("400_subsys", { subsystem: "Seguridad_", class: "Usuario", method: "registrar", params: [] }, superu);
await test("400_class", { subsystem: "Seguridad", class: "Usuario_", method: "registrar", params: [] }, superu);
await test("400_method", { subsystem: "Seguridad", class: "Usuario", method: "registrar_", params: [] }, superu);
await test("400_params", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: {} }, superu);
await test("403_sinperm", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [] }, { userID: 9, userName: "t", profiles: [] });
await test("501_clase", { subsystem: "Seguridad", class: "Xxx", method: "registrar", params: [] }, superu);
await test("501_metodo", { subsystem: "Seguridad", class: "Usuario", method: "zzz", params: [] }, superu);
await test("p_constructor", { subsystem: "Seguridad", class: "Usuario", method: "constructor", params: [] }, superu);
await test("p_toString", { subsystem: "Seguridad", class: "Usuario", method: "toString", params: [] }, superu);
await test("p_proto", { subsystem: "Seguridad", class: "__proto__", method: "registrar", params: [] }, superu);
console.log(casos);
process.exit(0);
