#!/usr/bin/env python3
"""
Script de validación del pipeline 3D mejorado
Prueba tanto el script volumétrico directo como la API completa
"""

import subprocess
import sys
import os
import time

def test_volumetric_script_direct():
    """Probar el script volumétrico directamente"""
    print("=== Probando Script Volumétrico Directo ===")
    
    input_image = "frontend/src/assets/cat.png"
    output_file = "test_direct_volumetric.obj"
    
    if not os.path.exists(input_image):
        print(f"❌ ERROR: Imagen no encontrada: {input_image}")
        return False
    
    cmd = [
        "scripts/ai3d/.venv/bin/python", 
        "scripts/ai3d/volumetric_generator.py",
        "--input", input_image,
        "--output", output_file,
        "--width", "80",
        "--depth", "60", 
        "--height", "50",
        "--resolution", "32",
        "--smoothing", "3",
        "--threshold", "0.3"
    ]
    
    print(f"Ejecutando: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            print("✅ Script ejecutado exitosamente")
            
            if os.path.exists(output_file):
                # Analizar el archivo OBJ
                with open(output_file, 'r') as f:
                    content = f.read()
                    lines = content.split('\n')
                    
                vertices = [line for line in lines if line.startswith('v ')]
                faces = [line for line in lines if line.startswith('f ')]
                
                print(f"📊 Archivo generado: {output_file}")
                print(f"   - Vértices: {len(vertices)}")
                print(f"   - Caras: {len(faces)}")
                print(f"   - Tamaño: {len(content)} caracteres")
                
                # Mostrar las primeras líneas para verificar calidad
                print(f"   - Primeras líneas:")
                for line in lines[:5]:
                    if line.strip():
                        print(f"     {line}")
                        
                return len(vertices) > 8 and len(faces) > 12  # Más que una caja simple
            else:
                print(f"❌ ERROR: No se generó el archivo de salida")
                return False
        else:
            print(f"❌ ERROR: Script falló con código {result.returncode}")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print("❌ ERROR: Timeout - el script tardó más de 5 minutos")
        return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_api_endpoint():
    """Probar la API endpoint (requiere backend corriendo)"""
    print("\n=== Probando API Endpoint ===")
    
    try:
        import requests
    except ImportError:
        print("❌ ERROR: requests no está instalado")
        return False
    
    url = 'http://localhost:8000/api/volumetric3d'
    image_path = 'frontend/src/assets/cat.png'
    
    if not os.path.exists(image_path):
        print(f"❌ ERROR: Imagen no encontrada: {image_path}")
        return False
    
    print(f"Probando API: {url}")
    
    try:
        # Verificar que el backend esté corriendo
        health_response = requests.get('http://localhost:8000/', timeout=5)
        print("✅ Backend está corriendo")
    except requests.exceptions.RequestException:
        print("❌ ERROR: Backend no está corriendo en localhost:8000")
        print("   Por favor inicia el backend con: cd backend && deno run --allow-all mod.ts")
        return False
    
    try:
        with open(image_path, 'rb') as image_file:
            files = {'image': image_file}
            data = {
                'widthMM': '80',
                'depthMM': '60', 
                'heightMM': '50',
                'resolutionLevel': '32',
                'smoothingIterations': '3',
                'volumeThreshold': '0.3'
            }
            
            print("📤 Enviando petición a API...")
            response = requests.post(url, files=files, data=data, timeout=300)
            
            if response.status_code == 200:
                print("✅ API respondió exitosamente")
                print(f"📊 Respuesta recibida: {len(response.text)} caracteres")
                
                # Guardar resultado
                output_file = 'test_api_volumetric.obj'
                with open(output_file, 'w') as f:
                    f.write(response.text)
                
                # Analizar contenido
                lines = response.text.split('\n')
                vertices = [line for line in lines if line.startswith('v ')]
                faces = [line for line in lines if line.startswith('f ')]
                
                print(f"   - Vértices: {len(vertices)}")
                print(f"   - Caras: {len(faces)}")
                print(f"   - Archivo guardado: {output_file}")
                
                # Mostrar primeras líneas
                print("   - Primeras líneas:")
                for line in lines[:5]:
                    if line.strip():
                        print(f"     {line}")
                        
                return len(vertices) > 8 and len(faces) > 12
            else:
                print(f"❌ ERROR: API falló con código {response.status_code}")
                print(f"Respuesta: {response.text}")
                return False
                
    except requests.exceptions.Timeout:
        print("❌ ERROR: Timeout - la API tardó más de 5 minutos")
        return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def check_environment():
    """Verificar que el entorno esté configurado correctamente"""
    print("=== Verificando Entorno ===")
    
    # Verificar Python virtual environment
    venv_python = "scripts/ai3d/.venv/bin/python"
    if not os.path.exists(venv_python):
        print(f"❌ ERROR: Entorno virtual no encontrado: {venv_python}")
        return False
    print(f"✅ Entorno virtual encontrado: {venv_python}")
    
    # Verificar dependencias principales
    try:
        result = subprocess.run([venv_python, "-c", "import open3d, numpy, cv2"], 
                              capture_output=True, timeout=10)
        if result.returncode == 0:
            print("✅ Dependencias principales disponibles (open3d, numpy, cv2)")
        else:
            print("❌ ERROR: Faltan dependencias principales")
            return False
    except Exception as e:
        print(f"❌ ERROR verificando dependencias: {e}")
        return False
    
    # Verificar script volumétrico
    script_path = "scripts/ai3d/volumetric_generator.py"
    if not os.path.exists(script_path):
        print(f"❌ ERROR: Script no encontrado: {script_path}")
        return False
    print(f"✅ Script volumétrico encontrado: {script_path}")
    
    # Verificar imagen de test
    test_image = "frontend/src/assets/cat.png"
    if not os.path.exists(test_image):
        print(f"❌ ERROR: Imagen de test no encontrada: {test_image}")
        return False
    print(f"✅ Imagen de test encontrada: {test_image}")
    
    return True

def main():
    print("🚀 Pipeline 3D Volumétrico - Test Completo")
    print("=" * 50)
    
    # Verificar entorno
    if not check_environment():
        print("\n❌ ENTORNO NO VÁLIDO - Corrige los errores antes de continuar")
        sys.exit(1)
    
    # Probar script directo
    script_success = test_volumetric_script_direct()
    
    # Probar API
    api_success = test_api_endpoint()
    
    # Resumen
    print("\n" + "=" * 50)
    print("📊 RESUMEN DE PRUEBAS")
    print("=" * 50)
    print(f"Script Volumétrico Directo: {'✅ ÉXITO' if script_success else '❌ FALLO'}")
    print(f"API Endpoint: {'✅ ÉXITO' if api_success else '❌ FALLO'}")
    
    if script_success and api_success:
        print("\n🎉 ¡PIPELINE 3D COMPLETAMENTE FUNCIONAL!")
        print("   - Genera modelos volumétricos complejos")
        print("   - API backend integrada correctamente")
        print("   - Listo para uso en producción")
    elif script_success:
        print("\n⚠️  PIPELINE PARCIALMENTE FUNCIONAL")
        print("   - Script volumétrico funciona correctamente")
        print("   - Problema con integración API - verificar backend")
    else:
        print("\n❌ PIPELINE CON PROBLEMAS CRÍTICOS")
        print("   - Revisar configuración del entorno Python")
        print("   - Verificar dependencias instaladas")
    
    print("\n🔧 Para usar en producción:")
    print("   1. Inicia backend: cd backend && deno run --allow-all mod.ts")
    print("   2. Inicia frontend: cd frontend && npm start")
    print("   3. Navega a http://localhost:4200")

if __name__ == "__main__":
    main()
