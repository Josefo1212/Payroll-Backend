-- ==========================================
-- SISTEMA DE NÓMINA - SCRIPT POSTGRESQL (NEON)
-- ==========================================

-- ------------------------------------------
-- 1. ENUMS
-- ------------------------------------------

CREATE TYPE sexo AS ENUM ('M', 'F');
CREATE TYPE estado_civil AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'CONCUBINO');
CREATE TYPE estado_persona AS ENUM ('ACTIVO', 'INACTIVO');
CREATE TYPE modulo_sistema AS ENUM ('PERSONAS', 'USUARIOS', 'PERFILES', 'CONTRATOS', 'CONCEPTOS', 'NOVEDADES', 'NOMINA', 'PRESTAMOS', 'PAGOS', 'LEY', 'REPORTES');
CREATE TYPE tipo_pago AS ENUM ('POR_HORA', 'SALARIO_FIJO');
CREATE TYPE frecuencia_pago AS ENUM ('SEMANAL', 'QUINCENAL', 'MENSUAL');
CREATE TYPE estado_contrato AS ENUM ('VIGENTE', 'SUSPENDIDO', 'FINALIZADO');
CREATE TYPE tipo_cuenta AS ENUM ('AHORRO', 'CORRIENTE');
CREATE TYPE estado_periodo AS ENUM ('BORRADOR', 'PROCESADO', 'PAGADO');
CREATE TYPE estado_recibo AS ENUM ('PENDIENTE', 'PAGADO', 'ANULADO');
CREATE TYPE metodo_pago AS ENUM ('TRANSFERENCIA', 'PAGO_MOVIL', 'EFECTIVO', 'CHEQUE');
CREATE TYPE tipo_concepto AS ENUM ('ASIGNACION', 'DEDUCCION', 'APORTE_PATRONAL');
CREATE TYPE categoria_concepto AS ENUM ('LEY', 'OPCIONAL', 'BONO', 'PRESTAMO', 'HORA_EXTRA', 'AJUSTE');
CREATE TYPE unidad_concepto AS ENUM ('HORAS', 'DIAS', 'MONTO');
CREATE TYPE tipo_valor AS ENUM ('MONTO_FIJO', 'PORCENTAJE_SALARIO');
CREATE TYPE estado_novedad AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'APLICADA');
CREATE TYPE estado_prestamo AS ENUM ('SOLICITADO', 'ACTIVO', 'PAGADO', 'ANULADO');
CREATE TYPE estado_cuota AS ENUM ('PENDIENTE', 'DESCONTADA', 'CONDONADA');
CREATE TYPE estado_afiliacion AS ENUM ('ACTIVO', 'SUSPENDIDO', 'BAJA');

-- ------------------------------------------
-- 2. TABLAS INDEPENDIENTES Y CATÁLOGOS
-- ------------------------------------------

CREATE TABLE Perfil (
    Id SERIAL PRIMARY KEY,
    Nombre_perfil VARCHAR(50) NOT NULL UNIQUE,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE Metodo (
    Id SERIAL PRIMARY KEY,
    Codigo VARCHAR(60) NOT NULL UNIQUE,
    Nombre VARCHAR(100) NOT NULL,
    Modulo modulo_sistema NOT NULL,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_metodo_modulo ON Metodo (Modulo);

CREATE TABLE Banco (
    Id SERIAL PRIMARY KEY,
    Codigo VARCHAR(10) NOT NULL UNIQUE,
    Nombre VARCHAR(100) NOT NULL UNIQUE,
    Activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE Cargo (
    Id SERIAL PRIMARY KEY,
    Nombre VARCHAR(100) NOT NULL UNIQUE,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE Persona (
    Id SERIAL PRIMARY KEY,
    Cedula VARCHAR(20) NOT NULL UNIQUE,
    Primer_nombre VARCHAR(60) NOT NULL,
    Segundo_nombre VARCHAR(60),
    Primer_apellido VARCHAR(60) NOT NULL,
    Segundo_apellido VARCHAR(60),
    Fecha_nacimiento DATE,
    Sexo sexo,
    Estado_civil estado_civil,
    Nro_tlf VARCHAR(20),
    Email VARCHAR(120) UNIQUE,
    Direccion VARCHAR(250),
    Estado estado_persona NOT NULL DEFAULT 'ACTIVO',
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    Updated_at TIMESTAMP
);

-- ------------------------------------------
-- 3. SEGURIDAD Y USUARIOS
-- ------------------------------------------

CREATE TABLE Perfil_Metodo (
    Perfil_id INT NOT NULL REFERENCES Perfil(Id) ON DELETE CASCADE,
    Metodo_id INT NOT NULL REFERENCES Metodo(Id) ON DELETE CASCADE,
    PRIMARY KEY (Perfil_id, Metodo_id)
);

CREATE TABLE Usuario (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL UNIQUE REFERENCES Persona(Id) ON DELETE RESTRICT,
    Perfil_id INT NOT NULL REFERENCES Perfil(Id) ON DELETE RESTRICT,
    Username VARCHAR(60) NOT NULL UNIQUE,
    Password_hash VARCHAR(255) NOT NULL,
    Activo BOOLEAN NOT NULL DEFAULT true,
    Ultimo_acceso TIMESTAMP,
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    Updated_at TIMESTAMP
);

CREATE INDEX idx_usuario_perfil ON Usuario (Perfil_id);

-- ------------------------------------------
-- 4. CUENTAS BANCARIAS Y CONTRATACIÓN
-- ------------------------------------------

CREATE TABLE Cuenta_bancaria (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE CASCADE,
    Banco_id INT NOT NULL REFERENCES Banco(Id) ON DELETE RESTRICT,
    Tipo_cuenta tipo_cuenta NOT NULL,
    Nro_cuenta VARCHAR(30) NOT NULL,
    Es_principal BOOLEAN NOT NULL DEFAULT false,
    Activa BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT uq_banco_cuenta UNIQUE (Banco_id, Nro_cuenta)
);

CREATE INDEX idx_cuenta_persona ON Cuenta_bancaria (Persona_id);

CREATE TABLE Contrato (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE RESTRICT,
    Cargo_id INT NOT NULL REFERENCES Cargo(Id) ON DELETE RESTRICT,
    Fecha_inicio DATE NOT NULL,
    Fecha_fin DATE,
    Tipo_pago tipo_pago NOT NULL,
    Frecuencia_pago frecuencia_pago NOT NULL,
    Horas_semanales DECIMAL(5,2),
    Estado estado_contrato NOT NULL DEFAULT 'VIGENTE',
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_contrato_fechas CHECK (Fecha_fin IS NULL OR Fecha_fin >= Fecha_inicio)
);

CREATE INDEX idx_contrato_persona_estado ON Contrato (Persona_id, Estado);

CREATE TABLE Contrato_salario (
    Id SERIAL PRIMARY KEY,
    Contrato_id INT NOT NULL REFERENCES Contrato(Id) ON DELETE CASCADE,
    Monto DECIMAL(12,2) NOT NULL,
    Vigente_desde DATE NOT NULL,
    Vigente_hasta DATE,
    Motivo VARCHAR(150),
    CONSTRAINT uq_contrato_salario_vigencia UNIQUE (Contrato_id, Vigente_desde)
);

-- ------------------------------------------
-- 5. CONCEPTOS Y APORTES DE LEY
-- ------------------------------------------

CREATE TABLE Concepto (
    Id SERIAL PRIMARY KEY,
    Codigo VARCHAR(30) NOT NULL UNIQUE,
    Nombre_concepto VARCHAR(100) NOT NULL,
    Tipo_concepto tipo_concepto NOT NULL,
    Categoria categoria_concepto NOT NULL,
    Unidad unidad_concepto NOT NULL DEFAULT 'MONTO',
    Afecta_base_ley BOOLEAN NOT NULL DEFAULT false,
    Codigo_cuenta_contable VARCHAR(30),
    Activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE Tipo_aporte_ley (
    Id SERIAL PRIMARY KEY,
    Codigo VARCHAR(30) NOT NULL UNIQUE,
    Nombre VARCHAR(100) NOT NULL,
    Entidad VARCHAR(100),
    Concepto_deduccion_id INT REFERENCES Concepto(Id) ON DELETE SET NULL,
    Concepto_patronal_id INT REFERENCES Concepto(Id) ON DELETE SET NULL
);

CREATE TABLE Parametro_aporte_ley (
    Id SERIAL PRIMARY KEY,
    Tipo_aporte_id INT NOT NULL REFERENCES Tipo_aporte_ley(Id) ON DELETE CASCADE,
    Tasa_empleado DECIMAL(6,4) NOT NULL,
    Tasa_patronal DECIMAL(6,4) NOT NULL,
    Tope_base DECIMAL(12,2),
    Piso_base DECIMAL(12,2),
    Vigente_desde DATE NOT NULL,
    Vigente_hasta DATE,
    Base_legal VARCHAR(200),
    CONSTRAINT uq_parametro_aporte_vigencia UNIQUE (Tipo_aporte_id, Vigente_desde)
);

CREATE TABLE Afiliacion_ley (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE CASCADE,
    Tipo_aporte_id INT NOT NULL REFERENCES Tipo_aporte_ley(Id) ON DELETE RESTRICT,
    Nro_afiliacion VARCHAR(30) NOT NULL,
    Fecha_inscripcion DATE NOT NULL,
    Fecha_baja DATE,
    Estado estado_afiliacion NOT NULL DEFAULT 'ACTIVO',
    CONSTRAINT uq_afiliacion_persona_tipo UNIQUE (Persona_id, Tipo_aporte_id)
);

CREATE TABLE Concepto_persona (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE CASCADE,
    Concepto_id INT NOT NULL REFERENCES Concepto(Id) ON DELETE RESTRICT,
    Tipo_valor tipo_valor NOT NULL DEFAULT 'MONTO_FIJO',
    Valor DECIMAL(12,4) NOT NULL CHECK (Valor >= 0),
    Vigente_desde DATE NOT NULL,
    Vigente_hasta DATE,
    Observacion VARCHAR(200),
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_concepto_persona_vigencia UNIQUE (Persona_id, Concepto_id, Vigente_desde)
);

-- ------------------------------------------
-- 6. NÓMINA Y NOVEDADES
-- ------------------------------------------

CREATE TABLE Periodo_Nomina (
    Id SERIAL PRIMARY KEY,
    Fecha_inicio DATE NOT NULL,
    Fecha_fin DATE NOT NULL,
    Frecuencia frecuencia_pago NOT NULL,
    Estado estado_periodo NOT NULL DEFAULT 'BORRADOR',
    Descripcion VARCHAR(200),
    Procesado_por INT REFERENCES Usuario(Id) ON DELETE SET NULL,
    Fecha_proceso TIMESTAMP,
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_periodo_fechas CHECK (Fecha_fin >= Fecha_inicio),
    CONSTRAINT uq_periodo_frecuencia_fechas UNIQUE (Frecuencia, Fecha_inicio, Fecha_fin)
);

CREATE TABLE Novedad (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE CASCADE,
    Concepto_id INT NOT NULL REFERENCES Concepto(Id) ON DELETE RESTRICT,
    Periodo_Nomina_id INT NOT NULL REFERENCES Periodo_Nomina(Id) ON DELETE CASCADE,
    Fecha DATE NOT NULL,
    Cantidad DECIMAL(8,2),
    Monto DECIMAL(12,2),
    Estado estado_novedad NOT NULL DEFAULT 'PENDIENTE',
    Observacion VARCHAR(200),
    Registrado_por INT NOT NULL REFERENCES Usuario(Id) ON DELETE RESTRICT,
    Aprobado_por INT REFERENCES Usuario(Id) ON DELETE SET NULL,
    Created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_novedad_persona_periodo ON Novedad (Persona_id, Periodo_Nomina_id);
CREATE INDEX idx_novedad_estado ON Novedad (Estado);

-- ------------------------------------------
-- 7. PRÉSTAMOS
-- ------------------------------------------

CREATE TABLE Prestamo (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE CASCADE,
    Fecha_otorgamiento DATE NOT NULL,
    Monto_total DECIMAL(12,2) NOT NULL,
    Nro_cuotas SMALLINT NOT NULL,
    Cuota_periodica DECIMAL(12,2) NOT NULL,
    Tasa_interes DECIMAL(6,4) NOT NULL DEFAULT 0,
    Estado estado_prestamo NOT NULL DEFAULT 'SOLICITADO',
    Aprobado_por INT REFERENCES Usuario(Id) ON DELETE SET NULL,
    Created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prestamo_persona_estado ON Prestamo (Persona_id, Estado);

CREATE TABLE Cuota_prestamo (
    Id SERIAL PRIMARY KEY,
    Prestamo_id INT NOT NULL REFERENCES Prestamo(Id) ON DELETE CASCADE,
    Nro_cuota SMALLINT NOT NULL,
    Fecha_vencimiento DATE NOT NULL,
    Monto_capital DECIMAL(12,2) NOT NULL,
    Monto_interes DECIMAL(12,2) NOT NULL DEFAULT 0,
    Monto_cuota DECIMAL(12,2) NOT NULL,
    Estado estado_cuota NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT uq_cuota_prestamo UNIQUE (Prestamo_id, Nro_cuota)
);

CREATE INDEX idx_cuota_estado_vencimiento ON Cuota_prestamo (Estado, Fecha_vencimiento);

-- ------------------------------------------
-- 8. RECIBOS Y DETALLES
-- ------------------------------------------

CREATE TABLE Recibo_pago (
    Id SERIAL PRIMARY KEY,
    Persona_id INT NOT NULL REFERENCES Persona(Id) ON DELETE RESTRICT,
    Periodo_Nomina_id INT NOT NULL REFERENCES Periodo_Nomina(Id) ON DELETE CASCADE,
    Contrato_id INT NOT NULL REFERENCES Contrato(Id) ON DELETE RESTRICT,
    Fecha_emision DATE NOT NULL,
    Total_asignaciones DECIMAL(12,2) NOT NULL,
    Total_deducciones DECIMAL(12,2) NOT NULL,
    Monto_total DECIMAL(12,2) NOT NULL,
    Estado estado_recibo NOT NULL DEFAULT 'PENDIENTE',
    Fecha_pago DATE,
    Metodo_pago metodo_pago,
    Cuenta_bancaria_id INT REFERENCES Cuenta_bancaria(Id) ON DELETE SET NULL,
    Referencia_pago VARCHAR(60),
    Pagado_por INT REFERENCES Usuario(Id) ON DELETE SET NULL,
    Created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recibo_persona_periodo UNIQUE (Persona_id, Periodo_Nomina_id),
    CONSTRAINT chk_recibo_pago CHECK (
        (Estado = 'PAGADO' AND Fecha_pago IS NOT NULL AND Metodo_pago IS NOT NULL) OR
        (Estado <> 'PAGADO')
    )
);

CREATE INDEX idx_recibo_periodo ON Recibo_pago (Periodo_Nomina_id);

CREATE TABLE Detalle_recibo (
    Id SERIAL PRIMARY KEY,
    Recibo_pago_id INT NOT NULL REFERENCES Recibo_pago(Id) ON DELETE CASCADE,
    Concepto_id INT NOT NULL REFERENCES Concepto(Id) ON DELETE RESTRICT,
    Cuota_prestamo_id INT UNIQUE REFERENCES Cuota_prestamo(Id) ON DELETE SET NULL,
    Novedad_id INT REFERENCES Novedad(Id) ON DELETE SET NULL,
    Concepto_persona_id INT REFERENCES Concepto_persona(Id) ON DELETE SET NULL,
    Parametro_aporte_id INT REFERENCES Parametro_aporte_ley(Id) ON DELETE SET NULL,
    Base_calculo DECIMAL(12,2),
    Tasa_aplicada DECIMAL(6,4),
    Cantidad_unidades DECIMAL(8,2),
    Monto DECIMAL(12,2) NOT NULL,
    CONSTRAINT chk_origen_unico CHECK (
        (CASE WHEN Cuota_prestamo_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN Novedad_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN Concepto_persona_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN Parametro_aporte_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
    )
);

CREATE INDEX idx_detalle_recibo ON Detalle_recibo (Recibo_pago_id);
CREATE INDEX idx_detalle_concepto ON Detalle_recibo (Concepto_id);