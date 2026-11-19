import PDFDocument from "pdfkit";
import Decimal from "decimal.js";

const MARGEN = 48;
const ANCHO_PAGINA = 595.28;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;

const COLOR_TINTA = "#0f172a";
const COLOR_SUAVE = "#64748b";
const COLOR_LINEA = "#e2e8f0";
const COLOR_CABECERA = "#0f172a";
const COLOR_SECCION = "#f1f5f9";

// Los DECIMAL llegan como texto desde node-pg. Se formatean con decimal.js
// para no perder centavos ni pasar por coma flotante.
const monto = (valor) => new Decimal(valor ?? 0).toFixed(2);

const cantidad = (valor) => {
  if (valor == null || valor === "") {
    return "—";
  }
  const numero = new Decimal(valor);
  return numero.isInteger() ? numero.toFixed(0) : numero.toFixed(2);
};

// pg entrega las columnas date como Date local (medianoche) y las de texto
// como YYYY-MM-DD. Se aceptan las dos formas.
const fecha = (valor) => {
  if (!valor) {
    return "—";
  }
  if (valor instanceof Date) {
    const dia = String(valor.getDate()).padStart(2, "0");
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${valor.getFullYear()}`;
  }
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : String(valor);
};

const fechaHora = (valor) => {
  const base = fecha(valor);
  if (base === "—" || !(valor instanceof Date)) {
    return base;
  }
  const horas = String(valor.getHours()).padStart(2, "0");
  const minutos = String(valor.getMinutes()).padStart(2, "0");
  return `${base} ${horas}:${minutos}`;
};

const CLAVE_FECHA = (valor) => {
  if (!valor) {
    return "periodo";
  }
  if (valor instanceof Date) {
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }
  const partes = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor));
  return partes ? partes[1] : "periodo";
};

const COLUMNAS = [
  { titulo: "Concepto", x: MARGEN, ancho: 250, align: "left" },
  { titulo: "Tipo", x: 302, ancho: 78, align: "left" },
  { titulo: "Cant.", x: 384, ancho: 50, align: "right" },
  { titulo: "Monto", x: 440, ancho: 107, align: "right" },
];

const SECCIONES = [
  { tipo: "ASIGNACION", titulo: "ASIGNACIONES" },
  { tipo: "DEDUCCION", titulo: "DEDUCCIONES" },
  { tipo: "APORTE_PATRONAL", titulo: "APORTE PATRONAL (costo del patrono)" },
];

const ALTO_PIE = 62;

const espacioDisponible = (doc) => doc.page.height - ALTO_PIE - doc.page.margins.bottom;

const asegurarEspacio = (doc, alto) => {
  if (doc.y + alto > espacioDisponible(doc)) {
    doc.addPage();
  }
};

const dibujarPie = (doc, recibo) => {
  // El pie se dibuja dentro del área de texto: si cae por debajo del margen
  // inferior, pdfkit lo interpreta como desborde y agrega una página, lo que
  // dentro de `pageAdded` sería una recursión infinita.
  const y = doc.page.height - doc.page.margins.bottom - 22;
  const anterior = doc.y;
  doc
    .moveTo(MARGEN, y)
    .lineTo(ANCHO_PAGINA - MARGEN, y)
    .lineWidth(0.5)
    .strokeColor(COLOR_LINEA)
    .stroke();
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLOR_SUAVE)
    .text(
      `Recibo ${recibo.id} · documento generado por el Sistema de Nómina`,
      MARGEN,
      y + 8,
      { width: ANCHO_UTIL, align: "left", lineBreak: false },
    );
  doc.y = anterior;
};

const dibujarEncabezado = (doc, recibo) => {
  doc.rect(0, 0, ANCHO_PAGINA, 84).fill(COLOR_CABECERA);

  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#ffffff")
    .text("RECIBO DE PAGO", MARGEN, 26);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#cbd5e1")
    .text("Sistema de Nómina", MARGEN, 50);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#ffffff")
    .text(`N° ${String(recibo.id).slice(0, 8).toUpperCase()}`, 0, 26, {
      width: ANCHO_PAGINA - MARGEN,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#cbd5e1")
    .text(`Estado: ${recibo.estado ?? "—"}`, 0, 44, {
      width: ANCHO_PAGINA - MARGEN,
      align: "right",
    });

  doc.fillColor(COLOR_TINTA);
  doc.y = 108;
};

const dato = (doc, etiqueta, valor, x, y, ancho) => {
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLOR_SUAVE)
    .text(etiqueta.toUpperCase(), x, y, { width: ancho });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(COLOR_TINTA)
    .text(valor ?? "—", x, y + 10, { width: ancho });
};

const dibujarDatos = (doc, recibo) => {
  const y = 112;
  const anchoColumna = 232;
  const xDerecha = MARGEN + ANCHO_UTIL - anchoColumna;

  const nombre = [recibo.primer_nombre, recibo.primer_apellido]
    .filter(Boolean)
    .join(" ");

  dato(doc, "Empleado", nombre || "—", MARGEN, y, anchoColumna);
  dato(doc, "Período", `${fecha(recibo.fecha_inicio)} al ${fecha(recibo.fecha_fin)}`, xDerecha, y, anchoColumna);
  dato(doc, "Cédula", recibo.cedula ?? "—", MARGEN, y + 34, anchoColumna);
  dato(doc, "Frecuencia", recibo.frecuencia ?? "—", xDerecha, y + 34, anchoColumna);
  dato(doc, "Fecha de emisión", fecha(recibo.fecha_emision), MARGEN, y + 68, anchoColumna);

  const pago =
    recibo.estado === "PAGADO"
      ? [fecha(recibo.fecha_pago), recibo.metodo_pago].filter(Boolean).join(" · ")
      : "Pendiente de pago";
  dato(doc, "Pago", pago, xDerecha, y + 68, anchoColumna);

  doc.y = y + 102;
};

const dibujarCabeceraTabla = (doc) => {
  asegurarEspacio(doc, 22);
  const y = doc.y;
  doc.rect(MARGEN, y, ANCHO_UTIL, 20).fill(COLOR_CABECERA);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
  for (const columna of COLUMNAS) {
    doc.text(columna.titulo, columna.x + 4, y + 6, {
      width: columna.ancho - 8,
      align: columna.align,
    });
  }
  doc.fillColor(COLOR_TINTA);
  doc.y = y + 24;
};

const dibujarSeccion = (doc, titulo) => {
  asegurarEspacio(doc, 26);
  const y = doc.y;
  doc.rect(MARGEN, y, ANCHO_UTIL, 18).fill(COLOR_SECCION);
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(COLOR_TINTA)
    .text(titulo, MARGEN + 4, y + 5, { width: ANCHO_UTIL - 8 });
  doc.fillColor(COLOR_TINTA);
  doc.y = y + 20;
};

const dibujarFila = (doc, linea) => {
  const alto =
    Math.max(
      doc.heightOfString(linea.nombre_concepto ?? "", { width: COLUMNAS[0].ancho - 8 }),
      11,
    ) + 8;

  asegurarEspacio(doc, alto);
  const y = doc.y;

  const celdas = [
    linea.nombre_concepto ?? "",
    linea.tipo_concepto ?? "",
    cantidad(linea.cantidad_unidades),
    monto(linea.monto),
  ];

  doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_TINTA);
  COLUMNAS.forEach((columna, indice) => {
    doc.text(celdas[indice], columna.x + 4, y + 4, {
      width: columna.ancho - 8,
      align: columna.align,
    });
  });

  doc
    .moveTo(MARGEN, y + alto)
    .lineTo(ANCHO_PAGINA - MARGEN, y + alto)
    .lineWidth(0.3)
    .strokeColor(COLOR_LINEA)
    .stroke();

  doc.y = y + alto;
};

const filaTotal = (doc, etiqueta, valor, { destacada = false } = {}) => {
  const alto = destacada ? 24 : 18;
  asegurarEspacio(doc, alto);
  const y = doc.y;
  const x = MARGEN + ANCHO_UTIL - 250;

  if (destacada) {
    doc.rect(x, y, 250, alto).fill(COLOR_CABECERA);
  }

  doc
    .font(destacada ? "Helvetica-Bold" : "Helvetica")
    .fontSize(destacada ? 11 : 9)
    .fillColor(destacada ? "#ffffff" : COLOR_TINTA)
    .text(etiqueta, x + 8, y + (destacada ? 7 : 4), { width: 130 });
  doc
    .font(destacada ? "Helvetica-Bold" : "Helvetica")
    .fontSize(destacada ? 11 : 9)
    .fillColor(destacada ? "#ffffff" : COLOR_TINTA)
    .text(valor, x + 130, y + (destacada ? 7 : 4), { width: 112, align: "right" });

  doc.fillColor(COLOR_TINTA);
  doc.y = y + alto;
};

const dibujarTotales = (doc, recibo, aportePatronal) => {
  doc.y += 10;
  asegurarEspacio(doc, 90);

  filaTotal(doc, "Total asignaciones", monto(recibo.total_asignaciones));
  filaTotal(doc, "Total deducciones", monto(recibo.total_deducciones));
  filaTotal(doc, "Neto a pagar", monto(recibo.monto_total), { destacada: true });

  doc.y += 8;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_SUAVE)
    .text(
      `Aporte patronal (costo del patrono, no forma parte del neto): ${monto(aportePatronal)}`,
      MARGEN,
      doc.y,
      { width: ANCHO_UTIL, align: "right" },
    );
  doc.fillColor(COLOR_TINTA);
};

class ReciboPdfService {
  nombreArchivo = (recibo) => {
    const cedula = String(recibo.cedula ?? "empleado").replace(/[^A-Za-z0-9-]/g, "");
    return `recibo-${cedula}-${CLAVE_FECHA(recibo.fecha_inicio)}.pdf`;
  };

  generar = (recibo, detalle = []) => {
    const documento = new PDFDocument({
      size: "A4",
      margin: MARGEN,
      info: {
        Title: `Recibo de pago ${recibo.id}`,
        Author: "Sistema de Nómina",
        Subject: `Recibo de ${recibo.primer_nombre ?? ""} ${recibo.primer_apellido ?? ""}`,
      },
    });

    const partes = [];
    documento.on("data", (parte) => partes.push(parte));

    const terminado = new Promise((resolve, reject) => {
      documento.on("end", () => resolve(Buffer.concat(partes)));
      documento.on("error", reject);
    });

    documento.on("pageAdded", () => {
      dibujarPie(documento, recibo);
      documento.y = documento.page.margins.top;
    });

    dibujarEncabezado(documento, recibo);
    dibujarDatos(documento, recibo);
    dibujarCabeceraTabla(documento);

    const lineas = Array.isArray(detalle) ? detalle : [];
    for (const seccion of SECCIONES) {
      const filas = lineas.filter((linea) => linea.tipo_concepto === seccion.tipo);
      if (filas.length === 0) {
        continue;
      }
      dibujarSeccion(documento, seccion.titulo);
      filas.forEach((linea) => dibujarFila(documento, linea));
    }

    const aportePatronal = lineas
      .filter((linea) => linea.tipo_concepto === "APORTE_PATRONAL")
      .reduce((total, linea) => total.plus(monto(linea.monto)), new Decimal(0));

    dibujarTotales(documento, recibo, aportePatronal);
    dibujarPie(documento, recibo);

    documento.end();
    return terminado;
  };
}

export const reciboPdfService = new ReciboPdfService();
export { ReciboPdfService };
