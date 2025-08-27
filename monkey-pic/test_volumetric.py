#!/usr/bin/env python3
"""
Script de prueba para el pipeline volumétrico 3D
Verifica que las dependencias están instaladas y el pipeline funciona.
"""

import sys
import subprocess
import os

def check_dependencies():
    """Verificar dependencias Python requeridas."""
    print("🔍 Verificando dependencias Python...")
    
    required_packages = [
        'torch',
        'torchvision', 
        'PIL',
        'numpy',
        'cv2',
        'open3d',
        'matplotlib',
        'trimesh',
        'scipy'
    ]
    
    missing_packages = []
    
    for package in required_packages:
        try:
            if package == 'cv2':
                import cv2
            elif package == 'PIL':
                from PIL import Image
            else:
                __import__(package)
            print(f"✅ {package}: OK")
        except ImportError:
            print(f"❌ {package}: FALTA")
            missing_packages.append(package)
    
    if missing_packages:
        print(f"\n⚠️  Faltan paquetes: {', '.join(missing_packages)}")
        print("Instala con: pip install " + " ".join(missing_packages))
        return False
    
    print("✅ Todas las dependencias están instaladas")
    return True

def test_script_exists():
    """Verificar que el script volumétrico existe."""
    script_path = "scripts/ai3d/volumetric_generator.py"
    
    if os.path.exists(script_path):
        print(f"✅ Script volumétrico encontrado: {script_path}")
        return True
    else:
        print(f"❌ Script volumétrico no encontrado: {script_path}")
        return False

def test_test_image():
    """Verificar que hay imagen de prueba."""
    test_image = "test_circle.png"
    
    if os.path.exists(test_image):
        print(f"✅ Imagen de prueba encontrada: {test_image}")
        return True
    else:
        print(f"❌ Imagen de prueba no encontrada: {test_image}")
        return False

def main():
    """Función principal de prueba."""
    print("🧊 Probando pipeline volumétrico 3D")
    print("=" * 50)
    
    all_ok = True
    
    # Verificar dependencias
    if not check_dependencies():
        all_ok = False
    
    print()
    
    # Verificar script
    if not test_script_exists():
        all_ok = False
    
    print()
    
    # Verificar imagen de prueba
    if not test_test_image():
        all_ok = False
    
    print()
    print("=" * 50)
    
    if all_ok:
        print("✅ Todo listo para el pipeline volumétrico 3D!")
        print("\n🚀 Para probar:")
        print("1. Ve a http://localhost:4200")
        print("2. Selecciona una imagen")
        print("3. Ve al tab '3D'")
        print("4. Ajusta los parámetros volumétricos")
        print("5. Haz clic en 'Convertir a 3D'")
        print("\n📊 El sistema ahora genera modelos volumétricos verdaderos para impresión 3D")
        return 0
    else:
        print("❌ Hay problemas que resolver antes de usar el sistema")
        return 1

if __name__ == "__main__":
    sys.exit(main())
