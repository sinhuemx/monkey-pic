#!/bin/bash

# Script de limpieza para Monkey Pic
echo "🧹 Limpiando archivos garbage de Monkey Pic..."

# Cambiar al directorio del proyecto
cd "$(dirname "$0")"

# Eliminar logs
echo "📄 Eliminando archivos de log..."
find . -name "*.log" -delete 2>/dev/null || true

# Eliminar archivos temporales
echo "🗂️  Eliminando archivos temporales..."
find . -name "*~" -o -name "*.tmp" -o -name "*.temp" -delete 2>/dev/null || true

# Eliminar archivos de sistema macOS
echo "🍎 Eliminando archivos de sistema macOS..."
find . -name ".DS_Store" -delete 2>/dev/null || true

# Limpiar cache de Python
echo "🐍 Eliminando cache de Python..."
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -o -name "*.pyo" -delete 2>/dev/null || true

# Limpiar cache de Angular
echo "⭕ Eliminando cache de Angular..."
rm -rf frontend/.angular/cache 2>/dev/null || true
rm -rf frontend/dist 2>/dev/null || true

# Eliminar archivos PID
echo "🔢 Eliminando archivos PID..."
find . -name "*.pid" -delete 2>/dev/null || true

echo "✅ Limpieza completada!"
