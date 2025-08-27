#!/bin/bash
# 🚀 Script para ejecutar Monkey Pic (frontend Angular + backend Deno) con guardas anti-duplicados
set -Eeuo pipefail
IFS=$'\n\t'

FRONTEND_DIR="frontend"
BACKEND_DIR="backend"
LOCK_FILE=".monkey-pic.pid"

echo "🐒 Iniciando Monkey Pic..."

is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Evitar instancias duplicadas
if [[ -f "$LOCK_FILE" ]]; then
  read -r OLD_BACK OLD_FRONT < "$LOCK_FILE" || true
  if is_running "${OLD_BACK:-}" || is_running "${OLD_FRONT:-}"; then
    echo "⚠️ Ya hay una instancia corriendo (PIDs: ${OLD_BACK:-?} ${OLD_FRONT:-?}). Sal saliendo."
    echo "💡 Si no es así, borra $LOCK_FILE manualmente."
    exit 1
  else
    rm -f "$LOCK_FILE"
  fi
fi

# Función para liberar puerto si es nuestro proceso; si no, aborta
ensure_port_free() {
  local port="$1"; shift
  local allow_pattern="$*"
  local pids
  pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -n -P -t || true)
  if [[ -z "$pids" ]]; then return 0; fi
  for pid in $pids; do
    local cmd
    cmd=$(ps -o command= -p "$pid" || true)
    if [[ "$cmd" == *$allow_pattern* ]]; then
      echo "🔧 Matando proceso en puerto $port: PID=$pid ($cmd)"
      kill -9 "$pid" || true
    else
      echo "⛔ Puerto $port ocupado por otro proceso: PID=$pid ($cmd). Aborta."
      exit 1
    fi
  done
}

# Asegurar puertos libres (backend y frontend)
ensure_port_free 8000 "backend/mod.ts"
ensure_port_free 4200 "ng serve"

# Matar watchers huérfanos específicos si quedaron del usuario
ps -o pid=,command= | grep -E "deno .*backend/mod.ts" | grep -v grep | awk '{print $1}' | xargs -r kill -9 || true
ps -o pid=,command= | grep -E "ng serve" | grep -v grep | awk '{print $1}' | xargs -r kill -9 || true

# Iniciar backend (Deno API) en background
echo "🦕 Iniciando backend en http://localhost:8000"
deno task dev > backend.log 2>&1 &
BACK_PID=$!

# Iniciar frontend (Angular) en background
echo "🌐 Iniciando frontend en http://localhost:4200"
pushd "$FRONTEND_DIR" >/dev/null
npm run start > ../frontend.log 2>&1 &
FRONT_PID=$!
popd >/dev/null

# Escribir PIDs en lock file
echo "$BACK_PID $FRONT_PID" > "$LOCK_FILE"

# Función para limpiar procesos al salir
cleanup() {
  echo ""
  echo "🛑 Deteniendo Monkey Pic..."
  if is_running "$BACK_PID"; then kill "$BACK_PID" 2>/dev/null || true; fi
  if is_running "$FRONT_PID"; then kill "$FRONT_PID" 2>/dev/null || true; fi
  wait "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
  rm -f "$LOCK_FILE"
  echo "✅ Monkey Pic detenido"
}
trap cleanup EXIT INT TERM

# Mostrar logs combinados en consola
echo "📜 Logs (presiona Ctrl+C para salir)"
tail -f backend.log frontend.log
