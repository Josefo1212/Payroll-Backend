import { queries } from "./loader.js";
import { ErrorNegocio } from "../../errors/ErrorNegocio.js";
import { PayrollWriter } from "./PayrollWriter.js";
import { payrollCalculator } from "../../services/PayrollCalculator.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Una línea es editable si RRHH puede ajustarla. RECURRENTE, NOVEDAD,
// PRESTAMO y LEY vienen de otra tabla y se corrigen en su origen.
const ORIGENES_EDITABLES = new Set(["CALCULADA", "MANUAL"]);

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
}
