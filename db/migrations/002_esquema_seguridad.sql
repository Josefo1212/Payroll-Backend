-- ==========================================================
-- MIGRACIÓN 002: seguridad según el esquema del profesor
-- Antes: Usuario.Perfil_id, Perfil_Metodo, Metodo(Codigo, Modulo)
-- Después: Usuario_Perfil, Subsistema, Opcion, Clase, Metodo,
--          Permiso_Opcion, Permiso_Metodo
--
-- Neon: crea un branch ANTES de correrla (es tu respaldo).
-- ==========================================================

BEGIN;

-- 0. Seguro: aborta si las tablas viejas de seguridad tienen datos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM Metodo) OR EXISTS (SELECT 1 FROM Perfil_Metodo) THEN
    RAISE EXCEPTION 'Metodo o Perfil_Metodo tienen datos. Revisalos antes de borrar las tablas viejas.';
  END IF;
END $$;

-- 1. Eliminar el diseño anterior de permisos
DROP TABLE Perfil_Metodo;
DROP TABLE Metodo;
DROP TYPE modulo_sistema;

-- 2. Estructura del sistema
CREATE TABLE Subsistema (
    Id SERIAL PRIMARY KEY,
    Nombre VARCHAR(60) NOT NULL UNIQUE,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT chk_subsistema_nombre CHECK (Nombre ~ '^[A-Za-z0-9]+$')
);

CREATE TABLE Opcion (
    Id SERIAL PRIMARY KEY,
    Subsistema_id INT NOT NULL REFERENCES Subsistema(Id) ON DELETE RESTRICT,
    Nombre VARCHAR(80) NOT NULL,
    Descripcion VARCHAR(200),
    Orden SMALLINT NOT NULL DEFAULT 0,
    Activo BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT uq_opcion_subsistema_nombre UNIQUE (Subsistema_id, Nombre)
);

CREATE TABLE Clase (
    Id SERIAL PRIMARY KEY,
    Subsistema_id INT NOT NULL REFERENCES Subsistema(Id) ON DELETE RESTRICT,
    Nombre VARCHAR(80) NOT NULL,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT uq_clase_subsistema_nombre UNIQUE (Subsistema_id, Nombre),
    CONSTRAINT chk_clase_nombre CHECK (Nombre ~ '^[A-Za-z0-9]+$')
);

CREATE TABLE Metodo (
    Id SERIAL PRIMARY KEY,
    Clase_id INT NOT NULL REFERENCES Clase(Id) ON DELETE RESTRICT,
    Nombre VARCHAR(80) NOT NULL,
    Descripcion VARCHAR(200),
    Activo BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT uq_metodo_clase_nombre UNIQUE (Clase_id, Nombre),
    CONSTRAINT chk_metodo_nombre CHECK (Nombre ~ '^[A-Za-z0-9]+$')
);

-- 3. Usuario puede tener varios perfiles
CREATE TABLE Usuario_Perfil (
    Usuario_id INT NOT NULL REFERENCES Usuario(Id) ON DELETE CASCADE,
    Perfil_id INT NOT NULL REFERENCES Perfil(Id) ON DELETE RESTRICT,
    PRIMARY KEY (Usuario_id, Perfil_id)
);

CREATE INDEX idx_usuario_perfil_perfil ON Usuario_Perfil (Perfil_id);

-- 4. Permisos: las tablas intermedias SON el permiso
CREATE TABLE Permiso_Opcion (
    Perfil_id INT NOT NULL REFERENCES Perfil(Id) ON DELETE CASCADE,
    Opcion_id INT NOT NULL REFERENCES Opcion(Id) ON DELETE CASCADE,
    PRIMARY KEY (Perfil_id, Opcion_id)
);

CREATE INDEX idx_permiso_opcion_opcion ON Permiso_Opcion (Opcion_id);

CREATE TABLE Permiso_Metodo (
    Perfil_id INT NOT NULL REFERENCES Perfil(Id) ON DELETE CASCADE,
    Metodo_id INT NOT NULL REFERENCES Metodo(Id) ON DELETE CASCADE,
    PRIMARY KEY (Perfil_id, Metodo_id)
);

CREATE INDEX idx_permiso_metodo_metodo ON Permiso_Metodo (Metodo_id);

-- 5. Conservar el perfil que ya tenía cada usuario
INSERT INTO Usuario_Perfil (Usuario_id, Perfil_id)
SELECT Id, Perfil_id FROM Usuario;

-- 6. Ajustes de Usuario (el perfil ya vive en Usuario_Perfil)
ALTER TABLE Usuario DROP COLUMN Perfil_id;

ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS Debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE Usuario ALTER COLUMN Debe_cambiar_clave SET DEFAULT true;  -- los nuevos sí; los existentes no
ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS Intentos_fallidos SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS Bloqueado_hasta TIMESTAMP;

-- 7. Persona: el RIF faltaba en el script original
ALTER TABLE Persona ADD COLUMN IF NOT EXISTS Rif VARCHAR(20) UNIQUE;

COMMIT;
