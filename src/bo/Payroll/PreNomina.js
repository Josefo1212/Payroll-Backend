import Decimal from "decimal.js";
import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { PayrollWriter } from "./PayrollWriter.js";
import { payrollCalculator } from "../../services/PayrollCalculator.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Una línea es editable si RRHH puede ajustarla. RECURRENTE, NOVEDAD,
// PRESTAMO y LEY vienen de otra tabla y se corrigen en su origen.
const ORIGENES_EDITABLES = new Set(["CALCULADA", "MANUAL"]);
// Una línea manual no puede ser de ley, préstamo ni hora extra: eso sale de
// afiliaciones, cuotas y registro_horas. Solo asignaciones/deducciones libres.
const CATEGORIAS_MANUAL = new Set(["OPCIONAL", "BONO", "AJUSTE"]);
const CODIGOS_RESERVADOS = new Set(["SUELDO_BASE", "HORA_EXTRA", "CUOTA_PRESTAMO"]);
const MONTO_MAXIMO = "9999999999.99";
const CANTIDAD_MAXIMA = "999999.99";
const NUMERO_POSITIVO = /^\d+(\.\d{1,2})?$/;

export class PreNomina {
  #db;

  #req;

  constructor(db, req) {
    this.#db = db;
    this.#req = req;
  }

  // --- validaciones de borde ----------------------------------------------

  #exigirSesion = () => {
    const usuarioId = this.#req?.session?.userID;
    if (!usuarioId) {
      throw new ErrorNegocio("Debes iniciar sesión.", 401);
    }
    return usuarioId;
  };

  #validarUuid = (valor, campo) => {
    if (typeof valor !== "string" || !UUID.test(valor)) {
      throw new ErrorNegocio(`${campo} debe ser un UUID válido.`, 400);
    }
    return valor;
  };

  #validarVersion = (version) => {
    if (!Number.isInteger(version) || version < 1) {
      throw new ErrorNegocio("version debe ser un entero mayor o igual a 1.", 400);
    }
    return version;
  };

  // Dinero exacto: se valida el texto antes de convertirlo. Un número binario
  // como 0.1 + 0.2 llega como 0.30000000000000004 y se rechaza.
  #validarMonto = (valor) => {
    const texto = String(valor ?? "").trim();
    if (!NUMERO_POSITIVO.test(texto)) {
      throw new ErrorNegocio(
        "monto debe ser un número positivo con hasta 2 decimales.",
        400,
      );
    }
    const monto = new Decimal(texto);
    if (monto.lte(0)) {
      throw new ErrorNegocio("monto debe ser mayor que cero.", 400);
    }
    if (monto.gt(MONTO_MAXIMO)) {
      throw new ErrorNegocio("monto excede el máximo permitido.", 400);
    }
    return monto;
  };

  #validarCantidad = (valor) => {
    if (valor == null) {
      return null;
    }
    const texto = String(valor).trim();
    if (!NUMERO_POSITIVO.test(texto)) {
      throw new ErrorNegocio(
        "cantidadUnidades debe ser un número no negativo con hasta 2 decimales.",
        400,
      );
    }
    const cantidad = new Decimal(texto);
    if (cantidad.gt(CANTIDAD_MAXIMA)) {
      throw new ErrorNegocio("cantidadUnidades excede el máximo permitido.", 400);
    }
    return cantidad;
  };

  #validarPayload = (payload) => {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.recibos)) {
      throw new ErrorNegocio("El cuerpo debe traer el arreglo recibos.", 400);
    }
    if (payload.recibos.length === 0) {
      throw new ErrorNegocio("No se enviaron recibos para guardar.", 400);
    }
    return payload.recibos;
  };

  // --- carga ---------------------------------------------------------------

  #exigirBorrador = async (db, preNominaId, { bloquear = false } = {}) => {
    const consulta = bloquear
      ? queries.findPreNominaByIdForUpdate
      : queries.findPreNominaById;
    const { rows } = await db.query(consulta, [preNominaId]);
    const borrador = rows[0];
    if (!borrador) {
      throw new ErrorNegocio("La pre-nómina no existe.", 404);
    }
    return borrador;
  };

  #exigirPeriodoBorrador = async (db, periodoId, { bloquear = false } = {}) => {
    const consulta = bloquear
      ? queries.findPeriodoByIdForUpdate
      : queries.findPeriodoById;
    const { rows } = await db.query(consulta, [periodoId]);
    const periodo = rows[0];
    if (!periodo) {
      throw new ErrorNegocio("El período no existe.", 404);
    }
    if (periodo.estado !== "BORRADOR") {
      throw new ErrorNegocio(
        "Solo se puede generar la pre-nómina de un período en BORRADOR.",
        409,
      );
    }
    return periodo;
  };

  #lineaSalida = (fila) => ({
    id: fila.id,
    conceptoId: fila.concepto_id,
    codigo: fila.codigo,
    nombreConcepto: fila.nombre_concepto,
    tipoConcepto: fila.tipo_concepto,
    categoria: fila.categoria,
    unidad: fila.unidad,
    origen: fila.origen,
    editable: ORIGENES_EDITABLES.has(fila.origen),
    editada: fila.editada,
    cuotaPrestamoId: fila.cuota_prestamo_id,
    novedadId: fila.novedad_id,
    conceptoPersonaId: fila.concepto_persona_id,
    parametroAporteId: fila.parametro_aporte_id,
    baseCalculo: fila.base_calculo,
    tasaAplicada: fila.tasa_aplicada,
    cantidadUnidades: fila.cantidad_unidades,
    monto: fila.monto,
  });

  // Única forma de respuesta del borrador: la usan generar, ver y guardar.
  #cargarBorrador = async (db, preNominaId) => {
    const borrador = await this.#exigirBorrador(db, preNominaId);

    const [{ rows: recibos }, { rows: detalles }] = await Promise.all([
      db.query(queries.findPreNominasRecibos, [preNominaId]),
      db.query(queries.findPreNominaDetalle, [preNominaId]),
    ]);

    const lineasPorRecibo = new Map();
    for (const fila of detalles) {
      const lineas = lineasPorRecibo.get(fila.pre_nomina_recibo_id) ?? [];
      lineas.push(this.#lineaSalida(fila));
      lineasPorRecibo.set(fila.pre_nomina_recibo_id, lineas);
    }

    const calc = payrollCalculator;
    const totalAsignaciones = calc.sumar(recibos.map((fila) => fila.total_asignaciones));
    const totalDeducciones = calc.sumar(recibos.map((fila) => fila.total_deducciones));
    // El aporte patronal es costo del patrono: se informa, no suma al neto.
    const totalAportePatronal = calc.sumar(
      detalles
        .filter((fila) => fila.tipo_concepto === "APORTE_PATRONAL")
        .map((fila) => fila.monto),
    );

    return {
      preNomina: {
        id: borrador.id,
        periodoId: borrador.periodo_nomina_id,
        periodo: {
          fechaInicio: borrador.fecha_inicio,
          fechaFin: borrador.fecha_fin,
          frecuencia: borrador.frecuencia,
          descripcion: borrador.periodo_descripcion,
        },
        version: borrador.version,
        generadoPor: borrador.generado_por,
        fechaGeneracion: borrador.fecha_generacion,
        actualizadoPor: borrador.actualizado_por,
        fechaActualizacion: borrador.fecha_actualizacion,
        recibos: recibos.length,
        totalAsignaciones: totalAsignaciones.toFixed(2),
        totalDeducciones: totalDeducciones.toFixed(2),
        totalAportePatronal: totalAportePatronal.toFixed(2),
        montoTotal: calc
          .redondear(totalAsignaciones.minus(totalDeducciones))
          .toFixed(2),
      },
      recibos: recibos.map((fila) => ({
        id: fila.id,
        personaId: fila.persona_id,
        cedula: fila.cedula,
        nombre: `${fila.primer_nombre} ${fila.primer_apellido}`.trim(),
        contratoId: fila.contrato_id,
        totalAsignaciones: fila.total_asignaciones,
        totalDeducciones: fila.total_deducciones,
        montoTotal: fila.monto_total,
        lineas: lineasPorRecibo.get(fila.id) ?? [],
      })),
    };
  };

  // --- métodos públicos ----------------------------------------------------

  // Genera el borrador del período. No aplica nada: novedades, cuotas,
  // préstamos y el estado del período quedan como estaban.
  async generar(periodoId) {
    const usuarioId = this.#exigirSesion();
    this.#validarUuid(periodoId, "periodoId");

    try {
      return await this.#db.transaction(async (cliente) => {
        const periodo = await this.#exigirPeriodoBorrador(cliente, periodoId, {
          bloquear: true,
        });

        const { rows: existentes } = await cliente.query(
          queries.findPreNominaByPeriodo,
          [periodo.id],
        );
        if (existentes.length > 0) {
          throw new ErrorNegocio(
            "El período ya tiene una pre-nómina; elimínala o confírmala.",
            409,
          );
        }

        const writer = new PayrollWriter(cliente);
        const conceptos = await writer.conceptosBase();
        const contratos = await writer.contratosDelPeriodo(periodo);

        const { rows: creadas } = await cliente.query(queries.insertPreNomina, [
          periodo.id,
          usuarioId,
        ]);
        const preNomina = creadas[0];

        for (const contrato of contratos) {
          const { lineas, ...totales } = await writer.construirLineas(
            contrato,
            periodo,
            conceptos,
          );
          await writer.escribirReciboBorrador(cliente, {
            preNominaId: preNomina.id,
            contrato,
            lineas,
            totales,
          });
        }

        return this.#cargarBorrador(cliente, preNomina.id);
      });
    } catch (error) {
      // Carrera entre dos generar: el UNIQUE (periodo_nomina_id) decide.
      if (error?.code === "23505") {
        throw new ErrorNegocio(
          "El período ya tiene una pre-nómina; elimínala o confírmala.",
          409,
        );
      }
      throw error;
    }
  }

  async ver(preNominaId) {
    this.#exigirSesion();
    this.#validarUuid(preNominaId, "preNominaId");
    return this.#cargarBorrador(this.#db, preNominaId);
  }

  // Valida el payload completo contra el borrador cargado y devuelve el plan
  // por recibo. No escribe nada: primero se valida todo y después se aplica.
  #planificarGuardado = async (cliente, recibosEntrada, recibos, detalles) => {
    const recibosPorId = new Map(recibos.map((recibo) => [recibo.id, recibo]));
    const lineasPorId = new Map(detalles.map((fila) => [fila.id, fila]));
    const lineasPorRecibo = new Map();
    for (const fila of detalles) {
      const lineas = lineasPorRecibo.get(fila.pre_nomina_recibo_id) ?? [];
      lineas.push(fila);
      lineasPorRecibo.set(fila.pre_nomina_recibo_id, lineas);
    }

    const vistos = new Set();
    const planes = [];

    for (const entrada of recibosEntrada) {
      if (!entrada || typeof entrada !== "object") {
        throw new ErrorNegocio("Cada recibo debe ser un objeto.", 400);
      }
      const reciboId = this.#validarUuid(entrada.reciboId, "reciboId");
      if (vistos.has(reciboId)) {
        throw new ErrorNegocio("El recibo está repetido en la solicitud.", 400);
      }
      vistos.add(reciboId);

      if (!recibosPorId.has(reciboId)) {
        throw new ErrorNegocio("El recibo no pertenece a la pre-nómina.", 400);
      }
      if (!Array.isArray(entrada.lineas)) {
        throw new ErrorNegocio("Cada recibo debe traer el arreglo lineas.", 400);
      }

      const existentes = lineasPorRecibo.get(reciboId) ?? [];
      // Solo las bloqueadas quedan siempre; las editables que no vengan se
      // borran, así que su concepto vuelve a estar libre.
      const conceptosEnRecibo = new Set(
        existentes
          .filter((fila) => !ORIGENES_EDITABLES.has(fila.origen))
          .map((fila) => fila.concepto_id),
      );

      const conservados = [];
      const actualizaciones = [];
      const nuevas = [];

      for (const linea of entrada.lineas) {
        if (!linea || typeof linea !== "object") {
          throw new ErrorNegocio("Cada línea debe ser un objeto.", 400);
        }
        const monto = this.#validarMonto(linea.monto);
        const cantidad = this.#validarCantidad(linea.cantidadUnidades);

        if (linea.id == null) {
          const conceptoId = linea.conceptoId;
          if (!Number.isInteger(conceptoId) || conceptoId < 1) {
            throw new ErrorNegocio(
              "conceptoId debe ser un entero positivo en una línea nueva.",
              400,
            );
          }
          const { rows } = await cliente.query(queries.findConceptoById, [conceptoId]);
          const concepto = rows[0];
          if (!concepto || !concepto.activo) {
            throw new ErrorNegocio("El concepto no existe o está inactivo.", 400);
          }
          if (
            concepto.tipo_concepto !== "ASIGNACION" &&
            concepto.tipo_concepto !== "DEDUCCION"
          ) {
            throw new ErrorNegocio(
              "Una línea manual solo puede ser ASIGNACION o DEDUCCION.",
              400,
            );
          }
          if (!CATEGORIAS_MANUAL.has(concepto.categoria)) {
            throw new ErrorNegocio(
              "La categoría del concepto no admite líneas manuales.",
              400,
            );
          }
          if (CODIGOS_RESERVADOS.has(concepto.codigo)) {
            throw new ErrorNegocio(
              "Ese concepto lo genera el sistema; no se agrega a mano.",
              400,
            );
          }
          if (conceptosEnRecibo.has(conceptoId)) {
            throw new ErrorNegocio(
              "El concepto ya tiene una línea en este recibo.",
              400,
            );
          }
          conceptosEnRecibo.add(conceptoId);
          nuevas.push({ conceptoId, monto, cantidad });
          continue;
        }

        const lineaId = this.#validarUuid(linea.id, "id");
        const fila = lineasPorId.get(lineaId);
        if (!fila || fila.pre_nomina_recibo_id !== reciboId) {
          throw new ErrorNegocio("La línea no pertenece a este recibo.", 400);
        }
        if (!ORIGENES_EDITABLES.has(fila.origen)) {
          throw new ErrorNegocio(
            "La línea no es editable; su valor lo manda su origen.",
            400,
          );
        }
        if (linea.conceptoId != null && linea.conceptoId !== fila.concepto_id) {
          throw new ErrorNegocio(
            "No se puede cambiar el concepto de una línea existente.",
            400,
          );
        }
        if (conservados.includes(lineaId)) {
          throw new ErrorNegocio("La línea está repetida en la solicitud.", 400);
        }
        if (conceptosEnRecibo.has(fila.concepto_id)) {
          throw new ErrorNegocio(
            "El concepto ya tiene una línea en este recibo.",
            400,
          );
        }
        conceptosEnRecibo.add(fila.concepto_id);
        conservados.push(lineaId);

        const montoPrevio = new Decimal(fila.monto);
        const cantidadPrevia =
          fila.cantidad_unidades == null ? null : new Decimal(fila.cantidad_unidades);
        const cambioMonto = !montoPrevio.eq(monto);
        const cambioCantidad =
          cantidadPrevia == null
            ? cantidad != null
            : cantidad == null || !cantidadPrevia.eq(cantidad);

        // Si no cambió no se toca: `editada` conserva lo que ya tenía.
        if (cambioMonto || cambioCantidad) {
          actualizaciones.push({ id: lineaId, monto, cantidad, editada: true });
        }
      }

      planes.push({ reciboId, conservados, actualizaciones, nuevas });
    }

    return planes;
  };

  // Guarda las líneas editables con semántica de reemplazo y bloqueo
  // optimista por versión.
  async guardar(preNominaId, version, payload) {
    const usuarioId = this.#exigirSesion();
    this.#validarUuid(preNominaId, "preNominaId");
    this.#validarVersion(version);
    const recibosEntrada = this.#validarPayload(payload);

    return this.#db.transaction(async (cliente) => {
      const borrador = await this.#exigirBorrador(cliente, preNominaId, {
        bloquear: true,
      });
      if (borrador.version !== version) {
        throw new ErrorNegocio(
          "La pre-nómina cambió desde que la abriste; vuelve a cargarla.",
          409,
        );
      }

      const { rows: periodos } = await cliente.query(queries.findPeriodoById, [
        borrador.periodo_nomina_id,
      ]);
      const periodo = periodos[0];
      if (!periodo) {
        throw new ErrorNegocio("El período no existe.", 404);
      }
      if (periodo.estado !== "BORRADOR") {
        throw new ErrorNegocio(
          "Solo se puede editar la pre-nómina de un período en BORRADOR.",
          409,
        );
      }

      const [{ rows: recibos }, { rows: detalles }] = await Promise.all([
        cliente.query(queries.findPreNominasRecibos, [preNominaId]),
        cliente.query(queries.findPreNominaDetalle, [preNominaId]),
      ]);

      const planes = await this.#planificarGuardado(
        cliente,
        recibosEntrada,
        recibos,
        detalles,
      );

      const writer = new PayrollWriter(cliente);

      for (const plan of planes) {
        // El barrido va PRIMERO: si se insertaran las MANUAL antes, este
        // DELETE se las llevaría por delante.
        await cliente.query(queries.deletePreNominaDetalleEditables, [
          plan.reciboId,
          plan.conservados,
        ]);

        for (const cambio of plan.actualizaciones) {
          await cliente.query(queries.updatePreNominaDetalleMonto, [
            cambio.id,
            cambio.monto.toFixed(2),
            cambio.cantidad == null ? null : cambio.cantidad.toFixed(2),
            cambio.editada,
          ]);
        }

        for (const nueva of plan.nuevas) {
          await cliente.query(queries.insertPreNominaDetalle, [
            plan.reciboId,
            nueva.conceptoId,
            "MANUAL",
            null,
            null,
            null,
            null,
            null,
            null,
            nueva.cantidad == null ? null : nueva.cantidad.toFixed(2),
            nueva.monto.toFixed(2),
            true,
          ]);
        }
      }

      // La ley se recalcula con la tasa congelada, sobre la base que quedó.
      const { rows: trasEdicion } = await cliente.query(queries.findPreNominaDetalle, [
        preNominaId,
      ]);
      const lineasPorRecibo = new Map();
      for (const fila of trasEdicion) {
        const lineas = lineasPorRecibo.get(fila.pre_nomina_recibo_id) ?? [];
        lineas.push({
          id: fila.id,
          origen: fila.origen,
          tipoConcepto: fila.tipo_concepto,
          afectaBaseLey: fila.afecta_base_ley,
          parametroId: fila.parametro_aporte_id,
          tasaAplicada:
            fila.tasa_aplicada == null ? null : new Decimal(fila.tasa_aplicada),
          monto: new Decimal(fila.monto),
        });
        lineasPorRecibo.set(fila.pre_nomina_recibo_id, lineas);
      }

      for (const plan of planes) {
        const lineas = lineasPorRecibo.get(plan.reciboId) ?? [];
        const parametros = await writer.parametrosDeLineas(lineas);
        for (const recalculada of writer.recalcularLey(lineas, parametros)) {
          if (recalculada.borrar) {
            // El CHECK exige monto > 0: una ley en cero se borra, no se escribe.
            await cliente.query(queries.deletePreNominaDetalle, [recalculada.id]);
            continue;
          }
          await cliente.query(queries.updatePreNominaDetalleLey, [
            recalculada.id,
            recalculada.baseCalculo.toFixed(2),
            recalculada.monto.toFixed(2),
          ]);
        }
      }

      // Totales del servidor sobre las líneas finales (la ley pudo cambiar).
      const { rows: finales } = await cliente.query(queries.findPreNominaDetalle, [
        preNominaId,
      ]);
      const totalesPorRecibo = new Map();
      for (const fila of finales) {
        const lineas = totalesPorRecibo.get(fila.pre_nomina_recibo_id) ?? [];
        lineas.push({ tipoConcepto: fila.tipo_concepto, monto: new Decimal(fila.monto) });
        totalesPorRecibo.set(fila.pre_nomina_recibo_id, lineas);
      }

      for (const plan of planes) {
        const totales = writer.calcularTotales(totalesPorRecibo.get(plan.reciboId) ?? []);
        await cliente.query(queries.updatePreNominaReciboTotales, [
          plan.reciboId,
          totales.totalAsignaciones.toFixed(2),
          totales.totalDeducciones.toFixed(2),
          totales.montoTotal.toFixed(2),
        ]);
      }

      await cliente.query(queries.touchPreNomina, [preNominaId, usuarioId]);

      return this.#cargarBorrador(cliente, preNominaId);
    });
  }
}
