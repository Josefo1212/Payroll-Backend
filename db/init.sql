-- ==========================================================
-- SISTEMA DE NÓMINA — init.sql (modelo v8, 27 tablas)
-- PostgreSQL 13+ (Neon). Ejecutar sobre una base vacía.
-- Regla: transaccionales -> UUID; maestras -> SERIAL.
-- ==========================================================

BEGIN;

-- Necesaria para la regla "sin contratos VIGENTES solapados" (EXCLUDE con uuid)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------
CREATE TYPE sexo               AS ENUM ('M', 'F');
CREATE TYPE estado_civil       AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'CONCUBINO');
CREATE TYPE estado_persona     AS ENUM ('ACTIVO', 'INACTIVO');
CREATE TYPE tipo_pago          AS ENUM ('POR_HORA', 'SALARIO_FIJO');
CREATE TYPE frecuencia_pago    AS ENUM ('SEMANAL', 'QUINCENAL', 'MENSUAL');
CREATE TYPE estado_contrato    AS ENUM ('VIGENTE', 'SUSPENDIDO', 'FINALIZADO');
CREATE TYPE tipo_cuenta        AS ENUM ('AHORRO', 'CORRIENTE');
CREATE TYPE estado_periodo     AS ENUM ('BORRADOR', 'PROCESADO', 'PAGADO');
CREATE TYPE estado_recibo      AS ENUM ('PENDIENTE', 'PAGADO', 'ANULADO');
CREATE TYPE metodo_pago        AS ENUM ('TRANSFERENCIA', 'PAGO_MOVIL', 'EFECTIVO', 'CHEQUE');
CREATE TYPE tipo_concepto      AS ENUM ('ASIGNACION', 'DEDUCCION', 'APORTE_PATRONAL');
CREATE TYPE categoria_concepto AS ENUM ('LEY', 'OPCIONAL', 'BONO', 'PRESTAMO', 'HORA_EXTRA', 'AJUSTE');
CREATE TYPE unidad_concepto    AS ENUM ('HORAS', 'DIAS', 'MONTO');
CREATE TYPE tipo_valor         AS ENUM ('MONTO_FIJO', 'PORCENTAJE_SALARIO');
CREATE TYPE estado_novedad     AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'APLICADA');
CREATE TYPE estado_prestamo    AS ENUM ('SOLICITADO', 'ACTIVO', 'PAGADO', 'ANULADO');
CREATE TYPE estado_cuota       AS ENUM ('PENDIENTE', 'DESCONTADA', 'CONDONADA');
CREATE TYPE estado_afiliacion  AS ENUM ('ACTIVO', 'SUSPENDIDO', 'BAJA');

-- ----------------------------------------------------------
-- PERSONA (UUID)
-- ----------------------------------------------------------
CREATE TABLE persona (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedula           varchar(20)  NOT NULL UNIQUE,
  primer_nombre    varchar(60)  NOT NULL,
  segundo_nombre   varchar(60),
  primer_apellido  varchar(60)  NOT NULL,
  segundo_apellido varchar(60),
  fecha_nacimiento date,
  sexo             sexo,
  estado_civil     estado_civil,
  nro_tlf          varchar(20),
  email            varchar(120) UNIQUE,
  direccion        varchar(250),
  estado           estado_persona NOT NULL DEFAULT 'ACTIVO',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);
COMMENT ON TABLE persona IS 'Fecha de ingreso y egreso no se guardan aquí: se derivan de Contrato.';

-- ----------------------------------------------------------
-- SEGURIDAD: IDENTIDAD
-- ----------------------------------------------------------
CREATE TABLE usuario (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id         uuid NOT NULL UNIQUE REFERENCES persona(id),
  username           varchar(60)  NOT NULL UNIQUE,
  password_hash      varchar(255) NOT NULL,           -- bcrypt; nunca texto plano
  activo             boolean NOT NULL DEFAULT true,
  debe_cambiar_clave boolean NOT NULL DEFAULT true,
  intentos_fallidos  smallint NOT NULL DEFAULT 0,
  bloqueado_hasta    timestamptz,
  ultimo_acceso      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

CREATE TABLE perfil (
  id            serial PRIMARY KEY,
  nombre_perfil varchar(50) NOT NULL UNIQUE,
  descripcion   varchar(200),
  activo        boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario_perfil (
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  perfil_id  int  NOT NULL REFERENCES perfil(id),
  PRIMARY KEY (usuario_id, perfil_id)
);
CREATE INDEX idx_usuario_perfil_perfil ON usuario_perfil (perfil_id);

-- ----------------------------------------------------------
-- SEGURIDAD: SESIONES JWT
-- ----------------------------------------------------------
CREATE TABLE refresh_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES usuario(id),
  familia_id      uuid NOT NULL,                       -- cadena de rotaciones de un login
  token_hash      varchar(64) NOT NULL UNIQUE,         -- SHA-256 hex; nunca el token plano
  expira_en       timestamptz NOT NULL,
  revocado_en     timestamptz,                         -- null = activo
  reemplazado_por uuid REFERENCES refresh_token(id),
  ip              varchar(45),
  user_agent      varchar(255),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_token_usuario ON refresh_token (usuario_id);
CREATE INDEX idx_refresh_token_familia ON refresh_token (familia_id);
CREATE INDEX idx_refresh_token_expira  ON refresh_token (expira_en);

-- ----------------------------------------------------------
-- SEGURIDAD: ESTRUCTURA (maestras, SERIAL)
-- ----------------------------------------------------------
CREATE TABLE subsistema (
  id          serial PRIMARY KEY,
  nombre      varchar(60) NOT NULL UNIQUE,
  descripcion varchar(200),
  activo      boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_subsistema_nombre CHECK (nombre ~ '^[A-Za-z0-9]+$')
);

CREATE TABLE opcion (
  id            serial PRIMARY KEY,
  subsistema_id int NOT NULL REFERENCES subsistema(id),
  nombre        varchar(80) NOT NULL,
  descripcion   varchar(200),
  orden         smallint NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  UNIQUE (subsistema_id, nombre)
);

CREATE TABLE clase (
  id            serial PRIMARY KEY,
  subsistema_id int NOT NULL REFERENCES subsistema(id),
  nombre        varchar(80) NOT NULL,
  descripcion   varchar(200),
  activo        boolean NOT NULL DEFAULT true,
  UNIQUE (subsistema_id, nombre),
  CONSTRAINT chk_clase_nombre CHECK (nombre ~ '^[A-Za-z0-9]+$')
);

CREATE TABLE metodo (
  id          serial PRIMARY KEY,
  clase_id    int NOT NULL REFERENCES clase(id),
  nombre      varchar(80) NOT NULL,
  descripcion varchar(200),
  activo      boolean NOT NULL DEFAULT true,
  UNIQUE (clase_id, nombre),
  CONSTRAINT chk_metodo_nombre CHECK (nombre ~ '^[A-Za-z0-9]+$')
);

-- ----------------------------------------------------------
-- SEGURIDAD: PERMISOS
-- ----------------------------------------------------------
CREATE TABLE permiso_opcion (
  perfil_id int NOT NULL REFERENCES perfil(id),
  opcion_id int NOT NULL REFERENCES opcion(id),
  PRIMARY KEY (perfil_id, opcion_id)
);
CREATE INDEX idx_permiso_opcion_opcion ON permiso_opcion (opcion_id);

CREATE TABLE permiso_metodo (
  perfil_id int NOT NULL REFERENCES perfil(id),
  metodo_id int NOT NULL REFERENCES metodo(id),
  PRIMARY KEY (perfil_id, metodo_id)
);
CREATE INDEX idx_permiso_metodo_metodo ON permiso_metodo (metodo_id);

-- ----------------------------------------------------------
-- CATÁLOGOS (SERIAL)
-- ----------------------------------------------------------
CREATE TABLE banco (
  id     serial PRIMARY KEY,
  codigo varchar(10)  NOT NULL UNIQUE,
  nombre varchar(100) NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE cargo (
  id          serial PRIMARY KEY,
  nombre      varchar(100) NOT NULL UNIQUE,
  descripcion varchar(200),
  activo      boolean NOT NULL DEFAULT true
);

-- ----------------------------------------------------------
-- CUENTAS BANCARIAS (UUID)
-- ----------------------------------------------------------
CREATE TABLE cuenta_bancaria (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id   uuid NOT NULL REFERENCES persona(id),
  banco_id     int  NOT NULL REFERENCES banco(id),
  tipo_cuenta  tipo_cuenta NOT NULL,
  nro_cuenta   varchar(30) NOT NULL,
  es_principal boolean NOT NULL DEFAULT false,
  activa       boolean NOT NULL DEFAULT true,
  UNIQUE (banco_id, nro_cuenta)
);
CREATE INDEX idx_cuenta_bancaria_persona ON cuenta_bancaria (persona_id);
-- Solo una cuenta principal activa por persona
CREATE UNIQUE INDEX uq_cuenta_principal_activa
  ON cuenta_bancaria (persona_id)
  WHERE es_principal AND activa;

-- ----------------------------------------------------------
-- CONTRATACIÓN (UUID)
-- ----------------------------------------------------------
CREATE TABLE contrato (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id      uuid NOT NULL REFERENCES persona(id),
  cargo_id        int  NOT NULL REFERENCES cargo(id),
  fecha_inicio    date NOT NULL,
  fecha_fin       date,
  tipo_pago       tipo_pago NOT NULL,
  frecuencia_pago frecuencia_pago NOT NULL,
  horas_semanales decimal(5,2),
  estado          estado_contrato NOT NULL DEFAULT 'VIGENTE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_contrato_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  -- Sin dos contratos VIGENTES solapados por persona
  CONSTRAINT ex_contrato_sin_solape EXCLUDE USING gist (
    persona_id WITH =,
    daterange(fecha_inicio, fecha_fin, '[]') WITH &&
  ) WHERE (estado = 'VIGENTE')
);
CREATE INDEX idx_contrato_persona_estado ON contrato (persona_id, estado);

CREATE TABLE contrato_salario (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id    uuid NOT NULL REFERENCES contrato(id),
  monto          decimal(12,2) NOT NULL,
  vigente_desde  date NOT NULL,
  vigente_hasta  date,
  motivo         varchar(150),
  UNIQUE (contrato_id, vigente_desde)
);

-- ----------------------------------------------------------
-- CONCEPTOS (SERIAL)  -- antes de Tipo_aporte_ley, que lo referencia
-- ----------------------------------------------------------
CREATE TABLE concepto (
  id                     serial PRIMARY KEY,
  codigo                 varchar(30)  NOT NULL UNIQUE,
  nombre_concepto        varchar(100) NOT NULL,
  tipo_concepto          tipo_concepto NOT NULL,
  categoria              categoria_concepto NOT NULL,
  unidad                 unidad_concepto NOT NULL DEFAULT 'MONTO',
  afecta_base_ley        boolean NOT NULL DEFAULT false,
  codigo_cuenta_contable varchar(30),
  activo                 boolean NOT NULL DEFAULT true
);

-- ----------------------------------------------------------
-- SEGURO SOCIAL Y APORTES DE LEY
-- ----------------------------------------------------------
CREATE TABLE tipo_aporte_ley (
  id                    serial PRIMARY KEY,
  codigo                varchar(30)  NOT NULL UNIQUE,   -- SSO / PARO_FORZOSO / VIVIENDA
  nombre                varchar(100) NOT NULL,
  entidad               varchar(100),
  concepto_deduccion_id int REFERENCES concepto(id),
  concepto_patronal_id  int REFERENCES concepto(id)
);

CREATE TABLE parametro_aporte_ley (
  id             serial PRIMARY KEY,
  tipo_aporte_id int NOT NULL REFERENCES tipo_aporte_ley(id),
  tasa_empleado  decimal(6,4) NOT NULL,
  tasa_patronal  decimal(6,4) NOT NULL,
  tope_base      decimal(12,2),
  piso_base      decimal(12,2),
  vigente_desde  date NOT NULL,
  vigente_hasta  date,
  base_legal     varchar(200),
  UNIQUE (tipo_aporte_id, vigente_desde)
);

CREATE TABLE afiliacion_ley (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id       uuid NOT NULL REFERENCES persona(id),
  tipo_aporte_id   int  NOT NULL REFERENCES tipo_aporte_ley(id),
  nro_afiliacion   varchar(30) NOT NULL,
  fecha_inscripcion date NOT NULL,
  fecha_baja       date,
  estado           estado_afiliacion NOT NULL DEFAULT 'ACTIVO',
  UNIQUE (persona_id, tipo_aporte_id)
);

-- ----------------------------------------------------------
-- NÓMINA
-- ----------------------------------------------------------
CREATE TABLE concepto_persona (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id    uuid NOT NULL REFERENCES persona(id),
  concepto_id   int  NOT NULL REFERENCES concepto(id),
  tipo_valor    tipo_valor NOT NULL DEFAULT 'MONTO_FIJO',
  valor         decimal(12,4) NOT NULL,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  observacion   varchar(200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, concepto_id, vigente_desde),
  CONSTRAINT chk_concepto_persona_valor CHECK (valor >= 0)
);

CREATE TABLE periodo_nomina (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_inicio  date NOT NULL,
  fecha_fin     date NOT NULL,
  frecuencia    frecuencia_pago NOT NULL,
  estado        estado_periodo NOT NULL DEFAULT 'BORRADOR',
  descripcion   varchar(200),
  procesado_por uuid REFERENCES usuario(id),
  fecha_proceso timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (frecuencia, fecha_inicio, fecha_fin),
  CONSTRAINT chk_periodo_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE TABLE novedad (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        uuid NOT NULL REFERENCES persona(id),
  concepto_id       int  NOT NULL REFERENCES concepto(id),
  periodo_nomina_id uuid NOT NULL REFERENCES periodo_nomina(id),
  fecha             date NOT NULL,
  cantidad          decimal(8,2),
  monto             decimal(12,2),
  estado            estado_novedad NOT NULL DEFAULT 'PENDIENTE',
  observacion       varchar(200),
  registrado_por    uuid NOT NULL REFERENCES usuario(id),
  aprobado_por      uuid REFERENCES usuario(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_novedad_persona_periodo ON novedad (persona_id, periodo_nomina_id);
CREATE INDEX idx_novedad_estado          ON novedad (estado);

CREATE TABLE recibo_pago (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id         uuid NOT NULL REFERENCES persona(id),
  periodo_nomina_id  uuid NOT NULL REFERENCES periodo_nomina(id),
  contrato_id        uuid NOT NULL REFERENCES contrato(id),
  fecha_emision      date NOT NULL,
  total_asignaciones decimal(12,2) NOT NULL,
  total_deducciones  decimal(12,2) NOT NULL,
  monto_total        decimal(12,2) NOT NULL,   -- neto = asignaciones - deducciones
  estado             estado_recibo NOT NULL DEFAULT 'PENDIENTE',
  fecha_pago         date,
  metodo_pago        metodo_pago,
  cuenta_bancaria_id uuid REFERENCES cuenta_bancaria(id),
  referencia_pago    varchar(60),
  pagado_por         uuid REFERENCES usuario(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, periodo_nomina_id),
  CONSTRAINT chk_recibo_pago CHECK (
    estado <> 'PAGADO' OR (fecha_pago IS NOT NULL AND metodo_pago IS NOT NULL)
  )
);
CREATE INDEX idx_recibo_pago_periodo ON recibo_pago (periodo_nomina_id);

-- ----------------------------------------------------------
-- PRÉSTAMOS (antes de Detalle_recibo, que referencia Cuota_prestamo)
-- ----------------------------------------------------------
CREATE TABLE prestamo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id         uuid NOT NULL REFERENCES persona(id),
  fecha_otorgamiento date NOT NULL,
  monto_total        decimal(12,2) NOT NULL,
  nro_cuotas         smallint NOT NULL,
  cuota_periodica    decimal(12,2) NOT NULL,
  tasa_interes       decimal(6,4) NOT NULL DEFAULT 0,
  estado             estado_prestamo NOT NULL DEFAULT 'SOLICITADO',
  aprobado_por       uuid REFERENCES usuario(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prestamo_persona_estado ON prestamo (persona_id, estado);

CREATE TABLE cuota_prestamo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id       uuid NOT NULL REFERENCES prestamo(id),
  nro_cuota         smallint NOT NULL,
  fecha_vencimiento date NOT NULL,
  monto_capital     decimal(12,2) NOT NULL,
  monto_interes     decimal(12,2) NOT NULL DEFAULT 0,
  monto_cuota       decimal(12,2) NOT NULL,
  estado            estado_cuota NOT NULL DEFAULT 'PENDIENTE',
  UNIQUE (prestamo_id, nro_cuota)
);
CREATE INDEX idx_cuota_estado_vencimiento ON cuota_prestamo (estado, fecha_vencimiento);

-- ----------------------------------------------------------
-- DETALLE DEL RECIBO
-- ----------------------------------------------------------
CREATE TABLE detalle_recibo (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recibo_pago_id       uuid NOT NULL REFERENCES recibo_pago(id),
  concepto_id          int  NOT NULL REFERENCES concepto(id),
  cuota_prestamo_id    uuid UNIQUE REFERENCES cuota_prestamo(id),
  novedad_id           uuid REFERENCES novedad(id),
  concepto_persona_id  uuid REFERENCES concepto_persona(id),
  parametro_aporte_id  int  REFERENCES parametro_aporte_ley(id),
  base_calculo         decimal(12,2),
  tasa_aplicada        decimal(6,4),
  cantidad_unidades    decimal(8,2),
  monto                decimal(12,2) NOT NULL,
  -- Como máximo UNA de las 4 columnas de origen tiene valor
  CONSTRAINT chk_origen_unico CHECK (
    (cuota_prestamo_id   IS NOT NULL)::int +
    (novedad_id          IS NOT NULL)::int +
    (concepto_persona_id IS NOT NULL)::int +
    (parametro_aporte_id IS NOT NULL)::int <= 1
  )
);
CREATE INDEX idx_detalle_recibo_recibo   ON detalle_recibo (recibo_pago_id);
CREATE INDEX idx_detalle_recibo_concepto ON detalle_recibo (concepto_id);

COMMIT;
