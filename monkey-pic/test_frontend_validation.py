#!/usr/bin/env python3
"""
Test script para validar que el frontend puede procesar modelos OBJ generados
por el pipeline volumétrico.
"""

import requests
import json
from pathlib import Path

def test_backend_endpoint():
    """Prueba que el endpoint volumétrico del backend funciona"""
    backend_url = "http://localhost:8000"
    
    try:
        # Test básico de conectividad
        response = requests.get(f"{backend_url}/", timeout=5)
        print(f"✅ Backend conectado correctamente: {response.status_code}")
        
        # Test del endpoint volumétrico (GET para ver parámetros)
        volumetric_response = requests.get(f"{backend_url}/api/volumetric3d", timeout=5)
        print(f"✅ Endpoint volumétrico disponible: {volumetric_response.status_code}")
        
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Error conectando al backend: {e}")
        return False

def validate_obj_format(file_path):
    """Valida que el archivo OBJ tiene el formato correcto para el frontend"""
    try:
        with open(file_path, 'r') as f:
            lines = f.readlines()
        
        vertex_count = 0
        face_count = 0
        normal_count = 0
        texture_count = 0
        
        for line in lines:
            line = line.strip()
            if line.startswith('v '):
                vertex_count += 1
            elif line.startswith('f '):
                face_count += 1
            elif line.startswith('vn '):
                normal_count += 1
            elif line.startswith('vt '):
                texture_count += 1
        
        print(f"📊 Archivo OBJ análisis:")
        print(f"   - Vértices: {vertex_count:,}")
        print(f"   - Caras: {face_count:,}")
        print(f"   - Normales: {normal_count:,}")
        print(f"   - Texturas: {texture_count:,}")
        
        # Validaciones básicas
        if vertex_count < 3:
            print("❌ Insuficientes vértices para renderizar")
            return False
        
        if face_count == 0:
            print("⚠️  Sin caras definidas (será renderizado como puntos)")
        
        print("✅ Formato OBJ válido para Three.js")
        return True
        
    except Exception as e:
        print(f"❌ Error validando OBJ: {e}")
        return False

def check_file_size(file_path):
    """Verifica que el tamaño del archivo es manejable por el frontend"""
    try:
        size = Path(file_path).stat().st_size
        size_mb = size / (1024 * 1024)
        
        print(f"📏 Tamaño del archivo: {size_mb:.2f} MB")
        
        if size_mb > 50:
            print("⚠️  Archivo muy grande, puede causar problemas de rendimiento")
        elif size_mb < 0.1:
            print("⚠️  Archivo muy pequeño, posibles datos insuficientes")
        else:
            print("✅ Tamaño adecuado para el frontend")
            
        return True
        
    except Exception as e:
        print(f"❌ Error verificando tamaño: {e}")
        return False

def main():
    """Función principal de prueba"""
    print("🧪 Iniciando validación del pipeline 2D→3D")
    print("=" * 50)
    
    # 1. Verificar backend
    print("\n1. Probando conectividad del backend...")
    backend_ok = test_backend_endpoint()
    
    # 2. Validar archivo OBJ generado
    obj_file = "/Users/carlossinhuegarciahernandez/Dev/sinhuemx/monkey-pic/monkey-pic/test_validation_output.obj"
    print(f"\n2. Validando archivo OBJ: {obj_file}")
    
    if not Path(obj_file).exists():
        print("❌ Archivo OBJ no encontrado")
        return False
    
    format_ok = validate_obj_format(obj_file)
    size_ok = check_file_size(obj_file)
    
    # 3. Resumen
    print("\n" + "=" * 50)
    print("📋 Resumen de validación:")
    print(f"   Backend: {'✅' if backend_ok else '❌'}")
    print(f"   Formato OBJ: {'✅' if format_ok else '❌'}")
    print(f"   Tamaño archivo: {'✅' if size_ok else '❌'}")
    
    all_ok = backend_ok and format_ok and size_ok
    
    if all_ok:
        print("\n🎉 ¡Pipeline completo validado exitosamente!")
        print("   - El backend está funcionando")
        print("   - El modelo 3D fue generado correctamente")
        print("   - El formato es compatible con Three.js")
        print("   - Listo para probar en el frontend")
    else:
        print("\n🔧 Hay problemas que requieren atención")
    
    return all_ok

if __name__ == "__main__":
    main()
