// E2E del PDF del recibo (Payroll/Receipt/generarPdf) por HTTP, contra la BD
// apuntada por DATABASE_URL. Requiere las migraciones 001–017 aplicadas, el
// usuario de prueba y el seed de datos de demo (db/seed-datos-prueba.sql) con
// al menos un período procesado.
//
//   node scripts/manual/pdf_recibo_e2e.mjs --yes
//
// No escribe filas: solo genera PDFs en memoria y comprueba autorización.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const casos = [];
const check = (nombre, actual, esperado) => {
  casos.push({ nombre, actual, esperado });
  if (JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(
      `FALLÓ "${nombre}": esperado ${JSON.stringify(esperado)}, recibido ${JSON.stringify(actual)}`,
    );
  }
};

const crearCliente = (base) => {
  const cookies = new Map();
  const pedir = async (ruta, { method = "GET", body } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookies.size
          ? {
              Cookie: [...cookies]
                .map(([clave, valor]) => `${clave}=${valor}`)
                .join("; "),
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
      const par = linea.split(";")[0];
      const corte = par.indexOf("=");
      const nombre = par.slice(0, corte);
      const valor = par.slice(corte + 1);
      if (valor === "") {
        cookies.delete(nombre);
      } else {
        cookies.set(nombre, valor);
      }
    }

    return {
      status: respuesta.status,
      body: await respuesta.json().catch(() => null),
    };
  };
  return { pedir };
};

const ejecutar = (cliente, subsystem, clase, method, params = []) =>
  cliente.pedir("/api/execute", {
    method: "POST",
    body: { subsystem, class: clase, method, params },
  });

const login = async (cliente, username) => {
  const respuesta = await cliente.pedir("/api/login", {
    method: "POST",
    body: { username, password: "Password123" },
  });
  check(`login ${username}`, respuesta.status, 200);
  return respuesta;
};

const esPdf = (base64) => {
  const buffer = Buffer.from(base64 ?? "", "base64");
  return {
    cabecera: buffer.subarray(0, 4).toString("latin1"),
    bytes: buffer.length,
  };
};

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const { rows: recibos } = await db.query(
    `SELECT r.id, r.monto_total, p.cedula, u.username
       FROM recibo_pago r
       JOIN persona p ON p.id = r.persona_id
       JOIN usuario u ON u.persona_id = p.id
      WHERE u.username IN ('luis_gomez', 'carmen_diaz')
        AND r.estado <> 'ANULADO'
      ORDER BY u.username, r.fecha_emision DESC
      LIMIT 4`,
  );
  const reciboLuis = recibos.find((fila) => fila.username === "luis_gomez");
  const reciboCarmen = recibos.find((fila) => fila.username === "carmen_diaz");
  if (!reciboLuis || !reciboCarmen) {
    throw new Error(
      "Faltan recibos de demo para luis_gomez o carmen_diaz. Corré " +
        "db/seed-datos-prueba.sql y scripts/manual/demo_periodos.mjs.",
    );
  }

  // 1. El empleado descarga su propio recibo.
  const luis = crearCliente(base);
  await login(luis, "luis_gomez");

  const propios = await ejecutar(luis, "Payroll", "Receipt", "misRecibos");
  check("misRecibos de luis", propios.status, 200);
  check("luis ve sus recibos", propios.body.length >= 1, true);

  const pdfLuis = await ejecutar(luis, "Payroll", "Receipt", "generarPdf", [
    reciboLuis.id,
  ]);
  check("luis descarga su PDF", pdfLuis.status, 200);
  check("mimeType", pdfLuis.body.mimeType, "application/pdf");
  check(
    "nombre de archivo",
    pdfLuis.body.nombreArchivo.startsWith(`recibo-${reciboLuis.cedula}-`) &&
      pdfLuis.body.nombreArchivo.endsWith(".pdf"),
    true,
  );
  const contenidoLuis = esPdf(pdfLuis.body.contenidoBase64);
  check("cabecera del PDF", contenidoLuis.cabecera, "%PDF");
  check("tamaño del PDF", contenidoLuis.bytes, pdfLuis.body.tamanioBytes);
  check("el PDF no está vacío", contenidoLuis.bytes > 1000, true);

  // 2. Otro empleado no puede descargar el recibo ajeno.
  const carmen = crearCliente(base);
  await login(carmen, "carmen_diaz");
  const ajeno = await ejecutar(carmen, "Payroll", "Receipt", "generarPdf", [
    reciboLuis.id,
  ]);
  check("empleado ajeno recibe 403", ajeno.status, 403);

  const propioCarmen = await ejecutar(carmen, "Payroll", "Receipt", "generarPdf", [
    reciboCarmen.id,
  ]);
  check("carmen descarga el suyo", propioCarmen.status, 200);

  // 3. RRHH descarga el recibo de cualquier empleado.
  const rrhh = crearCliente(base);
  await login(rrhh, "rosa_vargas");
  const pdfRrhh = await ejecutar(rrhh, "Payroll", "Receipt", "generarPdf", [
    reciboLuis.id,
  ]);
  check("RRHH descarga el recibo ajeno", pdfRrhh.status, 200);
  check("cabecera del PDF de RRHH", esPdf(pdfRrhh.body.contenidoBase64).cabecera, "%PDF");

  // 4. Superusuario también.
  const admin = crearCliente(base);
  await login(admin, "admin_prueba");
  const pdfAdmin = await ejecutar(admin, "Payroll", "Receipt", "generarPdf", [
    reciboLuis.id,
  ]);
  check("Superusuario descarga el recibo", pdfAdmin.status, 200);

  // 5. Recibo inexistente y solicitud inválida.
  const inexistente = await ejecutar(admin, "Payroll", "Receipt", "generarPdf", [
    "99999999-9999-4999-8999-999999999999",
  ]);
  check("recibo inexistente", inexistente.status, 404);

  const sinId = await ejecutar(admin, "Payroll", "Receipt", "generarPdf", ["  "]);
  check("recibo_id vacío", sinId.status, 400);

  const anonimo = crearCliente(base);
  const sinSesion = await ejecutar(anonimo, "Payroll", "Receipt", "generarPdf", [
    reciboLuis.id,
  ]);
  check("sin sesión", sinSesion.status, 401);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("PDF RECIBO E2E OK");
process.exit(0);
