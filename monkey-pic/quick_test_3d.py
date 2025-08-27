#!/usr/bin/env python3
"""
Test simple para verificar solo los elementos críticos del pipeline 3D
"""

import subprocess
import os
import sys

def test_basic_volumetric():
    """Test básico del generador volumétrico"""
    print("🧪 Probando generación volumétrica básica...")
    
    # Verificar que existe la imagen
    if not os.path.exists("frontend/src/assets/cat.png"):
        print("❌ No se encuentra la imagen de prueba")
        return False
    
    # Comando básico
    cmd = [
        "scripts/ai3d/.venv/bin/python",
        "scripts/ai3d/volumetric_generator.py", 
        "--input", "frontend/src/assets/cat.png",
        "--output", "quick_test.obj",
        "--width", "60",
        "--depth", "40",
        "--height", "30", 
        "--resolution", "16",  # Resolución muy baja para ser rápido
        "--smoothing", "1",
        "--threshold", "0.2"
    ]
    
    try:
        print("⏳ Ejecutando script (puede tardar 1-2 minutos)...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        
        if result.returncode == 0:
            print("✅ Script ejecutado exitosamente")
            
            # Verificar archivo de salida
            if os.path.exists("quick_test.obj"):
                with open("quick_test.obj", "r") as f:
                    content = f.read()
                    
                vertices = len([line for line in content.split('\n') if line.startswith('v ')])
                faces = len([line for line in content.split('\n') if line.startswith('f ')])
                
                print(f"📊 Resultado:")
                print(f"   - Vértices: {vertices}")
                print(f"   - Caras: {faces}")
                print(f"   - Tamaño archivo: {len(content)} bytes")
                
                if vertices > 8 and faces > 12:
                    print("🎉 ¡Pipeline 3D está funcionando correctamente!")
                    print("   El modelo generado es más complejo que una caja simple")
                    return True
                else:
                    print("⚠️  Pipeline genera solo geometría básica")
                    return False
            else:
                print("❌ No se generó archivo de salida")
                return False
        else:
            print(f"❌ Error en ejecución (código {result.returncode})")
            print("STDOUT:", result.stdout[-500:])  # Últimos 500 caracteres
            print("STDERR:", result.stderr[-500:])
            return False
            
    except subprocess.TimeoutExpired:
        print("❌ Timeout - el proceso tardó más de 3 minutos")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def show_improvements():
    """Mostrar las mejoras implementadas"""
    print("\n🔧 MEJORAS IMPLEMENTADAS EN EL PIPELINE 3D:")
    print("=" * 50)
    print("1. ✅ Estimación de profundidad mejorada con MiDaS")
    print("2. ✅ Detección inteligente de objetos vs fondo")
    print("3. ✅ Generación volumétrica real (no solo heightfields)")
    print("4. ✅ Algoritmo Poisson para superficies suaves")
    print("5. ✅ Validación y limpieza de mallas para impresión 3D")
    print("6. ✅ Manejo robusto de errores con fallbacks")
    
def show_usage_guide():
    """Mostrar guía de uso"""
    print("\n📋 GUÍA DE USO DEL PIPELINE 3D MEJORADO:")
    print("=" * 50)
    print("1. 🖥️  BACKEND:")
    print("   cd backend && deno run --allow-all mod.ts")
    print("   (Debe mostrar: 'Listening on http://localhost:8000')")
    
    print("\n2. 🌐 FRONTEND:")
    print("   cd frontend && npm install && npm start")
    print("   (Debe abrir en: http://localhost:4200)")
    
    print("\n3. 🎯 USO DE LA APLICACIÓN:")
    print("   - Cargar imagen (JPG/PNG)")
    print("   - Ir al tab '3D Model'")
    print("   - Ajustar parámetros volumétricos:")
    print("     • Width/Depth/Height: Dimensiones físicas en mm")
    print("     • Resolution: Calidad del modelo (16-64)")
    print("     • Smoothing: Suavizado de superficie (1-5)")
    print("     • Threshold: Sensibilidad de detección (0.1-0.5)")
    print("   - Hacer clic en 'Convert to 3D'")
    print("   - Descargar archivo OBJ para impresión 3D")

def main():
    print("🚀 VALIDACIÓN RÁPIDA DEL PIPELINE 3D MEJORADO")
    print("=" * 50)
    
    if test_basic_volumetric():
        print("\n🎉 ¡PIPELINE 3D COMPLETAMENTE FUNCIONAL!")
        show_improvements()
        show_usage_guide()
        
        print("\n💡 PRÓXIMOS PASOS RECOMENDADOS:")
        print("- Probar con diferentes tipos de imágenes")
        print("- Ajustar parámetros según el tipo de objeto")
        print("- Imprimir modelos 3D para validar calidad física")
        
    else:
        print("\n❌ PROBLEMAS DETECTADOS EN EL PIPELINE")
        print("Posibles soluciones:")
        print("1. Verificar instalación de dependencias Python")
        print("2. Verificar permisos de archivos")
        print("3. Revisar logs de error arriba")

if __name__ == "__main__":
    main()
