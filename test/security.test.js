import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { Security } from "../src/security/Security.js";
import { crearDbFalso, crearReq } from "./helpers.js";

// bo/ temporal con dos subsistemas, un archivo con nombre inválido y una
// carpeta con nombre inválido. Se arma una sola vez y se borra al final.
const raiz = mkdtempSync(join(tmpdir(), "bo-"));
after(() => rmSync(raiz, { recursive: true, force: true }));

mkdirSync(join(raiz, "Demo"));
mkdirSync(join(raiz, "Otro"));
mkdirSync(join(raiz, "mal nombre"));

writeFileSync(
  join(raiz, "Demo", "Saludo.js"),
  `export class Saludo {
     hola(nombre) { return "hola " + nombre; }
     secreto() { return "no deberia verse"; }
   }`,
);
writeFileSync(
  join(raiz, "Otro", "Cosa.js"),
  `export class Cosa { ping() { return "pong"; } }`,
);
// Nombre inválido: debe ignorarse (ni se importa).
writeFileSync(join(raiz, "Demo", "mal-nombre.js"), `export class X { y() {} }`);
writeFileSync(join(raiz, "Demo", "notas.txt"), `no es js`);

const dbFalso = crearDbFalso({});
const seguridad = () => {
  const s = new Security(dbFalso, { boDir: raiz });
  s.setPermissionMethod("Demo", "Saludo", "hola", 1);
  s.setPermissionMethod("Demo", "Saludo", "secreto", 1);
  return s;
};

test("descubre los BO de bo/ sin lista escrita a mano", () => {
  const s = new Security(dbFalso, { boDir: raiz });
  assert.equal(s.BoMap.has("Demo/Saludo"), true);
  assert.equal(s.BoMap.has("Otro/Cosa"), true);
});

test("ignora archivos y carpetas con nombre inválido", () => {
  const s = new Security(dbFalso, { boDir: raiz });
  assert.equal(s.BoMap.has("Demo/mal-nombre"), false);
  assert.equal(s.BoMap.has("mal nombre/Demo"), false);
  assert.equal(s.BoMap.has("Demo/notas"), false);
});

test("un BO descubierto se invoca por reflexión", async () => {
  const s = seguridad();
  const { status, body } = await s.executeMethod(
    { subsystem: "Demo", class: "Saludo", method: "hola", params: ["Ana"] },
    crearReq({ userID: 1, profiles: [1] }),
  );
  assert.equal(status, 200);
  assert.equal(body, "hola Ana");
});

test("../x sigue dando 400", async () => {
  const s = seguridad();
  const { status } = await s.executeMethod(
    { subsystem: "../", class: "Saludo", method: "hola", params: [] },
    crearReq({ userID: 1, profiles: [1] }),
  );
  assert.equal(status, 400);
});

test("una clase fuera de bo/ da 501", async () => {
  const s = seguridad();
  s.setPermissionMethod("Demo", "NoExiste", "hola", 1);
  const { status } = await s.executeMethod(
    { subsystem: "Demo", class: "NoExiste", method: "hola", params: [] },
    crearReq({ userID: 1, profiles: [1] }),
  );
  assert.equal(status, 501);
});

test("refreshBo guarda rutas válidas y se importan vía pathToFileURL", async () => {
  const s = new Security(dbFalso, { boDir: raiz });
  const ruta = s.BoMap.get("Demo/Saludo");

  // Ruta absoluta construida con node:path (portable, sin "/" concatenados).
  assert.equal(isAbsolute(ruta), true);
  assert.equal(ruta, join(raiz, "Demo", "Saludo.js"));

  // import(pathToFileURL(ruta).href) carga el BO temporal sin problemas.
  const modulo = await import(pathToFileURL(ruta).href);
  assert.equal(typeof modulo.Saludo, "function");
});

test("un import roto dentro del BO se propaga (no es 501)", async () => {
  writeFileSync(
    join(raiz, "Demo", "Roto.js"),
    `import { noExiste } from "./no-esta.js";\nexport class Roto { hola() {} }`,
  );

  const s = new Security(dbFalso, { boDir: raiz });
  s.setPermissionMethod("Demo", "Roto", "hola", 1);

  // El módulo que falta es el import interno, no el archivo del BO: debe
  // propagarse para verse como 500 en el handler de errores.
  await assert.rejects(
    () =>
      s.executeMethod(
        { subsystem: "Demo", class: "Roto", method: "hola", params: [] },
        crearReq({ userID: 1, profiles: [1] }),
      ),
    (error) => error?.code === "ERR_MODULE_NOT_FOUND",
  );

  rmSync(join(raiz, "Demo", "Roto.js"));
  s.refreshBo();
});

test("refreshBo descubre un BO nuevo sin reiniciar", async () => {
  const s = seguridad();
  // Permiso concedido, pero la clase aún no existe en disco: 501.
  s.setPermissionMethod("Demo", "Nuevo", "saludar", 1);
  const antes = await s.executeMethod(
    { subsystem: "Demo", class: "Nuevo", method: "saludar", params: [] },
    crearReq({ userID: 1, profiles: [1] }),
  );
  assert.equal(antes.status, 501);

  writeFileSync(
    join(raiz, "Demo", "Nuevo.js"),
    `export class Nuevo { saludar() { return "nuevo"; } }`,
  );

  s.refreshBo();

  const despues = await s.executeMethod(
    { subsystem: "Demo", class: "Nuevo", method: "saludar", params: [] },
    crearReq({ userID: 1, profiles: [1] }),
  );
  assert.equal(despues.status, 200);
  assert.equal(despues.body, "nuevo");

  // Limpieza para no dejar rastro en el bo/ temporal compartido.
  rmSync(join(raiz, "Demo", "Nuevo.js"));
  s.refreshBo();
});
