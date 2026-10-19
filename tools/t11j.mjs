import { security } from "../src/security/Security.js";

await security.loadPermission();

const superu = { userID: 1, userName: "admin", profiles: [2] };
async function test(nombre, jsonData, session) {
  const r = await security.executeMethod(jsonData, session);
  if (r.status === 403) {
    // Si es 403 por permiso cuando debería ser 501, aquí falla
    // pero ejecutamos y vemos
  }
  return { nombre, status: r.status };
}

const out = [];
out.push(await test("400_subsys", { subsystem: "Seguridad_", class: "Usuario", method: "registrar", params: [] }, superu));
out.push(await test("400_class", { subsystem: "Seguridad", class: "Usuario_", method: "registrar", params: [] }, superu));
out.push(await test("400_method", { subsystem: "Seguridad", class: "Usuario", method: "registrar_", params: [] }, superu));
out.push(await test("400_params", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: {} }, superu));
out.push(await test("403_sinperm", { subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [] }, { userID: 9, userName: "t", profiles: [] }));
out.push(await test("501_clase", { subsystem: "Seguridad", class: "Xxx", method: "registrar", params: [] }, superu));
out.push(await test("501_metodo", { subsystem: "Seguridad", class: "Usuario", method: "zzz", params: [] }, superu));
out.push(await test("p_constructor", { subsystem: "Seguridad", class: "Usuario", method: "constructor", params: [] }, superu));
out.push(await test("p_toString", { subsystem: "Seguridad", class: "Usuario", method: "toString", params: [] }, superu));
out.push(await test("p_proto", { subsystem: "Seguridad", class: "__proto__", method: "registrar", params: [] }, superu));
console.log(JSON.stringify(out));
process.exit(0);
