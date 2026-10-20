#!/usr/bin/env bash
# Orden de despliegue de la base de datos del sistema de nómina.
#
# Aplica las migraciones y los seeds en el orden que exige el esquema. Cada
# archivo es idempotente (los seeds usan ON CONFLICT), así que el script se
# puede correr varias veces sobre la misma base.
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

# Orden de despliegue. 001 crea las tablas base; 002 el esquema de seguridad;
# 003 pone Blocked_hasta/Ultimo_acceso con zona horaria. Después los seeds:
# login (usuario de prueba), superusuario (perfil + asignación) y seguridad
# (subsistema, clases, métodos, permisos y opciones).
ARCHIVOS=(
  "db/migrations/001_init.sql"
  "db/migrations/002_esquema_seguridad.sql"
  "db/migrations/003_zona_horaria_seguridad.sql"
  "db/seed-login.sql"
  "db/seed-superusuario.sql"
  "db/seed-seguridad.sql"
)

echo "Aplicando ${#ARCHIVOS[@]} archivo(s) sobre la base de DATABASE_URL…"

for archivo in "${ARCHIVOS[@]}"; do
  ruta="$RAIZ/$archivo"
  if [[ ! -f "$ruta" ]]; then
    echo "No existe $archivo" >&2
    exit 1
  fi
  echo "→ $archivo"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ruta"
done

echo "Listo. Base de datos al día."
