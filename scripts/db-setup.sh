#!/usr/bin/env bash
# Orden de despliegue de la base de datos del sistema de nómina.
#
# Aplica las migraciones y los seeds en el orden que exige el esquema. Es
# repetible: los seeds son idempotentes (ON CONFLICT) y las migraciones se
# saltan si detecta que ya están aplicadas, así que se puede correr varias
# veces sobre la misma base sin fallar.
#
# Uso:
#   DATABASE_URL=postgresql://usuario:clave@host:5432/base ./scripts/db-setup.sh
#
# No lleva credenciales: la conexión sale siempre de DATABASE_URL.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

# ¿Ya está la migración 003? (Bloqueado_hasta como timestamptz).
zona_horaria_lista() {
  [[ "$(consulta "SELECT (data_type = 'timestamp with time zone') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuario' AND column_name = 'bloqueado_hasta'")" == "t" ]]
}

saltados=()
aplicados=()

aplicar() {
  local archivo="$1"
  local ruta="$RAIZ/$archivo"
  if [[ ! -f "$ruta" ]]; then
    echo "No existe $archivo" >&2
    exit 1
  fi
  echo "→ $archivo"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ruta"
  aplicados+=("$archivo")
}

# --- Migraciones -----------------------------------------------------------
# El esquema base (001) crea `perfil`; el de seguridad (002) crea `subsistema`.
# Si ambos existen, las migraciones ya se aplicaron y se saltan.
if tabla_existe perfil && tabla_existe subsistema; then
  echo "El esquema base ya está aplicado: se saltan 001 y 002."
  saltados+=("db/migrations/001_init.sql" "db/migrations/002_esquema_seguridad.sql")
else
  aplicar "db/migrations/001_init.sql"
  aplicar "db/migrations/002_esquema_seguridad.sql"
fi

if zona_horaria_lista; then
  echo "Bloqueado_hasta ya es timestamptz: se salta 003."
  saltados+=("db/migrations/003_zona_horaria_seguridad.sql")
else
  aplicar "db/migrations/003_zona_horaria_seguridad.sql"
fi

# --- Seeds -----------------------------------------------------------------
# Idempotentes (ON CONFLICT): se aplican siempre.
aplicar "db/seed-login.sql"
aplicar "db/seed-superusuario.sql"
aplicar "db/seed-seguridad.sql"

echo "Listo. Base de datos al día (${#aplicados[@]} aplicado(s), ${#saltados[@]} saltado(s))."

