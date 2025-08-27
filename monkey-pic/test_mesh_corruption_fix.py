#!/usr/bin/env python3
"""
Test específico para validar que los problemas de corrupción de mesh están resueltos
"""

import subprocess
import requests
import time

def test_mesh_corruption_fix():
    """Probar que los modelos generados son válidos y no causan corrupción"""
    print("🔧 Testing mesh corruption fix...")
    
    # Test 1: Generar modelo volumétrico
    print("\n1. 🧊 Generating volumetric model...")
    cmd = [
        "scripts/ai3d/.venv/bin/python",
        "scripts/ai3d/volumetric_generator.py", 
        "--input", "frontend/src/assets/cat.png",
        "--output", "test_corruption_fix.obj",
        "--width", "60",
        "--depth", "40",
        "--height", "30", 
        "--resolution", "24",  # Resolución moderada
        "--smoothing", "2",
        "--threshold", "0.3"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            print("❌ Failed to generate model")
            print("STDERR:", result.stderr)
            return False
            
        print("✅ Model generated successfully")
        
        # Analizar el archivo OBJ generado
        with open("test_corruption_fix.obj", "r") as f:
            content = f.read()
            
        lines = content.split('\n')
        vertices = [line for line in lines if line.startswith('v ')]
        faces = [line for line in lines if line.startswith('f ')]
        
        print(f"📊 Generated model stats:")
        print(f"   - Vertices: {len(vertices)}")
        print(f"   - Faces: {len(faces)}")
        
        if len(vertices) < 10 or len(faces) < 10:
            print("⚠️  Model seems too simple")
            return False
            
        # Validar formato OBJ
        valid_obj = validate_obj_format(content)
        if not valid_obj:
            print("❌ Generated OBJ has format issues")
            return False
            
        print("✅ OBJ format validation passed")
        
    except subprocess.TimeoutExpired:
        print("❌ Timeout generating model")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    
    # Test 2: Probar la API
    print("\n2. 🌐 Testing API endpoint...")
    try:
        # Verificar que el backend esté corriendo
        response = requests.get('http://localhost:8000/', timeout=5)
        print("✅ Backend is running")
        
        # Probar API volumétrica
        with open("frontend/src/assets/cat.png", 'rb') as image_file:
            files = {'image': image_file}
            data = {
                'widthMM': '60',
                'depthMM': '40', 
                'heightMM': '30',
                'resolutionLevel': '20',  # Resolución baja para ser rápido
                'smoothingIterations': '2',
                'volumeThreshold': '0.3'
            }
            
            print("📤 Sending API request...")
            response = requests.post('http://localhost:8000/api/volumetric3d', 
                                   files=files, data=data, timeout=180)
            
            if response.status_code == 200:
                print("✅ API responded successfully")
                
                # Validar respuesta
                obj_content = response.text
                api_valid = validate_obj_format(obj_content)
                
                if api_valid:
                    print("✅ API returned valid OBJ format")
                    
                    # Guardar para inspección
                    with open("test_api_corruption_fix.obj", "w") as f:
                        f.write(obj_content)
                    
                    lines = obj_content.split('\n')
                    vertices = [line for line in lines if line.startswith('v ')]
                    faces = [line for line in lines if line.startswith('f ')]
                    
                    print(f"📊 API model stats:")
                    print(f"   - Vertices: {len(vertices)}")
                    print(f"   - Faces: {len(faces)}")
                    
                    return len(vertices) > 10 and len(faces) > 10
                else:
                    print("❌ API returned invalid OBJ format")
                    return False
            else:
                print(f"❌ API error: {response.status_code}")
                return False
                
    except requests.exceptions.RequestException as e:
        print(f"❌ API request failed: {e}")
        print("💡 Make sure backend is running: cd backend && deno run --allow-all mod.ts")
        return False

def validate_obj_format(obj_content):
    """Validar que el contenido OBJ está bien formateado"""
    try:
        lines = obj_content.split('\n')
        
        vertex_count = 0
        face_count = 0
        has_invalid_vertex = False
        has_invalid_face = False
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            if line.startswith('v '):
                # Validar vértice
                parts = line.split()
                if len(parts) < 4:
                    print(f"Invalid vertex at line {i+1}: {line}")
                    has_invalid_vertex = True
                else:
                    try:
                        x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                        if any(abs(val) > 1e6 for val in [x, y, z]):
                            print(f"Extreme vertex values at line {i+1}: {x}, {y}, {z}")
                        vertex_count += 1
                    except ValueError:
                        print(f"Invalid vertex numbers at line {i+1}: {line}")
                        has_invalid_vertex = True
                        
            elif line.startswith('f '):
                # Validar cara
                parts = line.split()
                if len(parts) < 4:
                    print(f"Invalid face at line {i+1}: {line}")
                    has_invalid_face = True
                else:
                    indices = []
                    for part in parts[1:]:
                        try:
                            # Manejar diferentes formatos: v, v/vt, v/vt/vn
                            idx = int(part.split('/')[0])
                            if idx <= 0 or idx > vertex_count:
                                print(f"Out of range face index at line {i+1}: {idx} (max: {vertex_count})")
                                has_invalid_face = True
                            indices.append(idx)
                        except ValueError:
                            print(f"Invalid face index at line {i+1}: {part}")
                            has_invalid_face = True
                    
                    # Verificar que no hay índices duplicados en una cara
                    if len(set(indices)) != len(indices):
                        print(f"Degenerate face (duplicate indices) at line {i+1}: {indices}")
                        
                    face_count += 1
        
        print(f"📝 OBJ validation: {vertex_count} vertices, {face_count} faces")
        
        if vertex_count == 0:
            print("❌ No vertices found")
            return False
            
        if face_count == 0:
            print("⚠️  No faces found (vertices-only model)")
            
        if has_invalid_vertex or has_invalid_face:
            print("❌ Format validation found issues")
            return False
            
        return True
        
    except Exception as e:
        print(f"❌ Exception during OBJ validation: {e}")
        return False

def main():
    print("🔧 MESH CORRUPTION FIX VALIDATION")
    print("=" * 40)
    
    success = test_mesh_corruption_fix()
    
    print("\n" + "=" * 40)
    if success:
        print("🎉 MESH CORRUPTION FIX SUCCESSFUL!")
        print("✅ Generated models are valid and properly formatted")
        print("✅ No corruption issues detected")
        print("✅ Ready for frontend integration")
    else:
        print("❌ MESH CORRUPTION ISSUES REMAIN")
        print("🔧 Check the logs above for specific problems")
        print("🔧 May need additional validation improvements")

if __name__ == "__main__":
    main()
