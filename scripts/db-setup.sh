#!/usr/bin/env bash
# Orden de despliegue de la base de datos del sistema de nómina.
#
# El esquema base vive en db/init.sql (sin número, se corre UNA vez sobre una
# base vacía). Los cambios posteriores sobre una base con datos van en
# db/migrations/NNN_nombre.sql (número primero).
#
# Uso:
#   DATABASE_URL=postgresql://usuario:clave@host:5432/base ./scripts/db-setup.sh
#   DATABASE_URL=... ./scripts/db-setup.sh --with-test-user
#
# Sin --with-test-user aplica db/init.sql y db/seed-seguridad.sql. Con la
# bandera agrega db/seed-usuario-prueba.sql (usuario admin_prueba/Password123
# ligado a los cuatro perfiles), que NUNCA debe ir a producción.
#
# No lleva credenciales: la conexión sale siempre de DATABASE_URL.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CON_TEST_USER=false
for arg in "$@"; do
  case "$arg" in
    --with-test-user) CON_TEST_USER=true ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      echo "Uso: $0 [--with-test-user]" >&2
      exit 1
      ;;
  esac
done

# Nunca tocar producción: los seeds y init se corren a mano en dev/CI.
if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "ABORTADO: NODE_ENV=production. Este script no corre en producción." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Falta DATABASE_URL. Exportala antes de correr el script:" >&2
  echo "  DATABASE_URL=postgresql://usuario:clave@host:5432/base $0" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "No se encontró psql en el PATH. Instalá el cliente de PostgreSQL." >&2
  exit 1
fi

# Consulta un valor escalar. `-tA` quita encabezados y alineación.
consulta() {
  psql "$DATABASE_URL" -tAc "$1"
}

# ¿Existe la tabla pública `tabla`?
tabla_existe() {
  [[ "$(consulta "SELECT to_regclass('public.$1') IS NOT NULL")" == "t" ]]
}

aplicar() {
  local archivo="$1"
  local ruta="$RAIZ/$archivo"
  if [[ ! -f "$ruta" ]]; then
    echo "No existe $archivo" >&2
    exit 1
  fi
  echo "→ $archivo"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ruta"
}

# --- Esquema ----------------------------------------------------------------
# init.sql crea todas las tablas; sobre una base con esquema ya creado fallaría
# (CREATE TABLE existing). Se detecta por `usuario` (existe en todo el modelo) y
# se salta para que el script sea repetible.
if tabla_existe usuario; then
  echo "El esquema ya está aplicado (db/init.sql): se salta."
else
  aplicar "db/init.sql"
fi

# --- Migraciones (cambios posteriores sobre una base con datos) -------------
# Formato NNN_nombre.sql, número primero. Hoy la carpeta está vacía: el esquema
# base vive completo en db/init.sql. Se aplican en orden de nombre (el prefijo
# numérico lo garantiza). Idempotentes por diseño (IF NOT EXISTS en cada una).
if compgen -G "$RAIZ/db/migrations/[0-9]*.sql" >/dev/null; then
  while IFS= read -r ruta; do
    aplicar "db/migrations/$(basename "$ruta")"
  done < <(ls "$RAIZ"/db/migrations/[0-9]*.sql | sort)
else
  echo "Sin migraciones pendientes (db/migrations/ sin NNN_*.sql)."
fi

# --- Seeds ------------------------------------------------------------------
# db/seed-seguridad.sql es idempotente y crea subsistemas, clases, métodos,
# perfiles y sus permisos, así que se aplica siempre. El usuario de prueba solo
# con --with-test-user.
aplicar "db/seed-seguridad.sql"

if [[ "$CON_TEST_USER" == true ]]; then
  echo "Con --with-test-user: se agrega el usuario de prueba (solo desarrollo)."
  aplicar "db/seed-usuario-prueba.sql"
else
  echo "Sin --with-test-user: se omite db/seed-usuario-prueba.sql."
fi

echo "Listo. Base de datos al día."
