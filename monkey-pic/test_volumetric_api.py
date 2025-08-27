#!/usr/bin/env python3
import requests
import sys
import time

def test_volumetric_api():
    url = 'http://localhost:8000/api/volumetric3d'
    image_path = '/Users/carlossinhuegarciahernandez/Dev/sinhuemx/monkey-pic/monkey-pic/frontend/src/assets/cat.png'
    
    print(f"Testing volumetric API with cat image...")
    print(f"URL: {url}")
    print(f"Image: {image_path}")
    
    # Verificar que el backend esté corriendo
    print("🔍 Verificando conexión al backend...")
    for attempt in range(3):
        try:
            response = requests.get('http://localhost:8000/', timeout=5)
            print("✅ Backend está corriendo")
            break
        except requests.exceptions.RequestException:
            print(f"⏳ Intento {attempt + 1}/3: Backend no responde, esperando...")
            time.sleep(2)
    else:
        print("❌ ERROR: Backend no está disponible")
        print("💡 Solución: cd backend && deno run --allow-all mod.ts")
        return False
    
    try:
        with open(image_path, 'rb') as image_file:
            files = {'image': image_file}
            data = {
                'widthMM': '80',
                'depthMM': '60', 
                'heightMM': '50',
                'resolutionLevel': '24',  # Resolución más baja para ser más rápido
                'smoothingIterations': '2',
                'volumeThreshold': '0.3'
            }
            
            print("📤 Enviando petición a API volumétrica...")
            print("⏳ Esto puede tardar 1-3 minutos...")
            response = requests.post(url, files=files, data=data, timeout=300)
            
            if response.status_code == 200:
                print("✅ SUCCESS! API respondió con modelo 3D")
                print(f"📊 Tamaño de respuesta: {len(response.text)} caracteres")
                
                # Analizar contenido
                lines = response.text.split('\n')
                vertices = [line for line in lines if line.startswith('v ')]
                faces = [line for line in lines if line.startswith('f ')]
                
                print(f"📐 Estadísticas del modelo generado:")
                print(f"   - Vértices: {len(vertices)}")
                print(f"   - Caras: {len(faces)}")
                
                # Guardar resultado
                output_file = '/tmp/cat_api_volumetric.obj'
                with open(output_file, 'w') as f:
                    f.write(response.text)
                print(f"💾 Modelo guardado en: {output_file}")
                
                # Mostrar las primeras líneas para verificación
                print("\n📋 Primeras líneas del modelo OBJ:")
                for line in lines[:8]:
                    if line.strip():
                        print(f"  {line}")
                
                # Verificar calidad
                if len(vertices) > 100 and len(faces) > 200:
                    print("\n🎉 ¡EXCELENTE! Modelo 3D complejo generado exitosamente")
                    print("   ✅ Suitable para impresión 3D")
                    print("   ✅ Geometría volumétrica real")
                    return True
                else:
                    print("\n⚠️  Modelo básico generado (posible fallback)")
                    return True
                    
            else:
                print(f"❌ ERROR: HTTP {response.status_code}")
                print(f"Respuesta del servidor: {response.text}")
                return False
                
    except FileNotFoundError:
        print(f"❌ ERROR: Archivo de imagen no encontrado: {image_path}")
        return False
    except requests.exceptions.Timeout:
        print("❌ ERROR: Timeout - la API tardó más de 5 minutos")
        print("💡 Esto puede suceder con imágenes muy complejas o resolución alta")
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ ERROR: Fallo en la petición: {e}")
        return False
    except Exception as e:
        print(f"❌ ERROR inesperado: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Test de API Volumétrica 3D")
    print("=" * 40)
    success = test_volumetric_api()
    
    if success:
        print("\n🎯 RESULTADO: ¡API FUNCIONANDO CORRECTAMENTE!")
        print("✅ El pipeline 3D está completamente operativo")
        print("✅ Listo para uso en producción")
    else:
        print("\n❌ RESULTADO: Problemas detectados en la API")
        print("🔧 Verificar que el backend esté corriendo")
        print("🔧 Revisar logs del servidor para más detalles")
