#!/usr/bin/env python3
"""
OPTIMIZED 2D→3D pipeline: High-quality MiDaS depth + clean watertight meshing.

ENFOQUE: Simplicidad y calidad sobre complejidad.
Produce modelos 3D optimales para impresión 3D con volumen y dimensiones correctas.
"""

import argparse
import os
import sys
from typing import Tuple, Optional

import numpy as np
import cv2
from PIL import Image
import open3d as o3d

def load_midas_model():
    """Cargar modelo MiDaS optimizado para mejor calidad"""
    try:
        import torch
        
        # OPTIMIZADO: Usar MiDaS v3.1 DPT_Large para máxima calidad
        model_type = "DPT_Large"  # Mejor calidad que MiDaS_small
        
        model = torch.hub.load("intel-isl/MiDaS", model_type, pretrained=True)
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        model.eval()
        
        midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        transform = midas_transforms.dpt_transform  # Transform para DPT_Large
        
        print(f"✓ MiDaS {model_type} cargado exitosamente en {device}")
        return model, transform, device
        
    except Exception as e:
        print(f"✗ Error cargando MiDaS: {e}")
        return None, None, None

def compute_high_quality_depth(image_path: str, output_debug_dir: str = None) -> np.ndarray:
    """Generar mapa de profundidad de alta calidad con MiDaS optimizado"""
    
    # Cargar modelo
    model, transform, device = load_midas_model()
    if model is None:
        print("✗ Fallback a depth proxy básico")
        return compute_basic_depth_proxy(image_path)
    
    # Cargar imagen
    rgb = np.array(Image.open(image_path).convert('RGB'))
    print(f"📊 Imagen cargada: {rgb.shape}")
    
    try:
        import torch
        
        # OPTIMIZADO: Preprocessing mínimo para preservar calidad original
        # Solo redimensionar si es necesario para MiDaS
        input_image = rgb.copy()
        
        # Aplicar transform de MiDaS
        input_tensor = transform(input_image).to(device)
        
        print(f"📊 Tensor de entrada: {input_tensor.shape}")
        
        # Inferencia MiDaS
        with torch.no_grad():
            prediction = model(input_tensor)
            
            # Redimensionar a tamaño original
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=rgb.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        
        # Convertir a numpy
        depth_raw = prediction.cpu().numpy()
        
        print(f"📊 Profundidad MiDaS - min: {depth_raw.min():.6f}, max: {depth_raw.max():.6f}")
        
        # SIMPLIFICADO: Normalización directa sin post-procesamiento excesivo
        # MiDaS ya produce excelente calidad, solo normalizar
        if depth_raw.max() > depth_raw.min():
            depth_normalized = (depth_raw - depth_raw.min()) / (depth_raw.max() - depth_raw.min())
        else:
            depth_normalized = np.zeros_like(depth_raw)
        
        # OPCIONAL: Suave mejora de contraste sin destruir detalles
        # Usar CLAHE muy conservador
        depth_8bit = (depth_normalized * 255).astype(np.uint8)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(16,16))  # Conservative
        depth_enhanced = clahe.apply(depth_8bit).astype(np.float32) / 255.0
        
        # Mezcla conservadora: 70% MiDaS puro + 30% enhanced
        depth_final = 0.7 * depth_normalized + 0.3 * depth_enhanced
        
        # Guardar debug si se especifica
        if output_debug_dir:
            os.makedirs(output_debug_dir, exist_ok=True)
            cv2.imwrite(f"{output_debug_dir}/01_original.jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
            cv2.imwrite(f"{output_debug_dir}/02_midas_raw.jpg", (depth_normalized * 255).astype(np.uint8))
            cv2.imwrite(f"{output_debug_dir}/03_final_depth.jpg", (depth_final * 255).astype(np.uint8))
            print(f"📁 Debug guardado en: {output_debug_dir}")
        
        print(f"✓ MiDaS depth processing exitoso")
        return depth_final
        
    except Exception as e:
        print(f"✗ Error en MiDaS processing: {e}")
        return compute_basic_depth_proxy(image_path)

def compute_basic_depth_proxy(image_path: str) -> np.ndarray:
    """Proxy básico de profundidad basado en luminancia"""
    rgb = np.array(Image.open(image_path).convert('RGB'))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    
    # Normalizar
    if gray.max() > gray.min():
        depth = (gray - gray.min()) / (gray.max() - gray.min())
    else:
        depth = gray
    
    print(f"📊 Using basic depth proxy")
    return depth

def create_background_mask(rgb: np.ndarray, threshold: float = 0.15) -> np.ndarray:
    """Crear máscara de foreground/background inteligente"""
    
    # Convertir a LAB para mejor separación
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    
    # Detectar bordes para encontrar el objeto principal
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    
    # Usar GrabCut para segmentación automática
    mask = np.zeros(gray.shape[:2], np.uint8)
    
    # Definir rectángulo inicial (excluyendo bordes para evitar fondo)
    h, w = gray.shape
    margin = min(h, w) // 10
    rect = (margin, margin, w - 2*margin, h - 2*margin)
    
    # Modelos de fondo y primer plano para GrabCut
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    
    try:
        # Aplicar GrabCut
        cv2.grabCut(rgb, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
        
        # Crear máscara final
        mask_final = np.where((mask == 2) | (mask == 0), 0, 1).astype(np.float32)
        
        # Suavizar bordes de máscara
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask_final = cv2.morphologyEx(mask_final, cv2.MORPH_CLOSE, kernel)
        mask_final = cv2.GaussianBlur(mask_final, (5, 5), 0)
        
        coverage = np.sum(mask_final) / mask_final.size
        print(f"📊 GrabCut mask - coverage: {coverage:.1%}")
        
        return mask_final
        
    except Exception as e:
        print(f"⚠️ GrabCut failed, using threshold mask: {e}")
        
        # Fallback: threshold simple
        gray_norm = gray.astype(np.float32) / 255.0
        mask_simple = (gray_norm > threshold).astype(np.float32)
        
        # Limpiar máscara
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        mask_simple = cv2.morphologyEx(mask_simple, cv2.MORPH_CLOSE, kernel)
        
        return mask_simple

def create_optimized_mesh(
    depth: np.ndarray, 
    mask: np.ndarray,
    width_mm: float,
    base_mm: float,
    max_height_mm: float,
    target_tris: int
) -> Tuple[np.ndarray, np.ndarray]:
    """Crear malla 3D optimizada con volumen y dimensiones correctas"""
    
    h, w = depth.shape
    print(f"📊 Creando mesh - depth: {depth.shape}, target_tris: {target_tris}")
    
    # OPTIMIZADO: Calcular resolución de malla para target triangles con calidad adaptativa
    # target_tris ≈ 2 * (grid_w-1) * (grid_h-1) para superficie principal
    grid_cells = target_tris // 4  # Conservador
    aspect_ratio = h / w
    
    # Ajustes de calidad basados en target_tris
    if target_tris <= 200000:
        # Calidad Normal - Balance eficiencia/calidad
        max_grid_size = 800
        min_grid_size = 120
        quality_multiplier = 0.8
        print(f"📊 Calidad NORMAL - Grid conservador")
    elif target_tris <= 400000:
        # Calidad Alta - Mejor resolución
        max_grid_size = 1200
        min_grid_size = 180
        quality_multiplier = 1.0
        print(f"📊 Calidad ALTA - Grid mejorado")
    else:
        # Calidad Máxima - Ultra resolución
        max_grid_size = 1600
        min_grid_size = 250
        quality_multiplier = 1.2
        print(f"📊 Calidad MÁXIMA - Grid ultra-detalle")
    
    grid_w = int(np.sqrt(grid_cells / aspect_ratio) * quality_multiplier)
    grid_h = int(grid_w * aspect_ratio)
    
    # Aplicar límites adaptativos
    grid_w = max(min_grid_size, min(grid_w, max_grid_size))
    grid_h = max(min_grid_size, min(grid_h, max_grid_size))
    
    print(f"📊 Grid resolution: {grid_w}x{grid_h} = {grid_w*grid_h} cells (multiplier: {quality_multiplier}x)")
    
    # Redimensionar depth y mask a grid resolution
    depth_resized = cv2.resize(depth, (grid_w, grid_h), interpolation=cv2.INTER_CUBIC)
    mask_resized = cv2.resize(mask, (grid_w, grid_h), interpolation=cv2.INTER_CUBIC)
    
    # Crear coordenadas físicas
    real_height = width_mm * aspect_ratio
    xs = np.linspace(0.0, width_mm, grid_w, dtype=np.float32)
    ys = np.linspace(0.0, real_height, grid_h, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)
    
    # OPTIMIZADO: Mapeo de profundidad más efectivo
    # Aplicar máscara
    masked_depth = depth_resized * (mask_resized > 0.3)
    
    # Normalizar profundidad en el área del objeto
    valid_depth = masked_depth[mask_resized > 0.3]
    if len(valid_depth) > 0:
        depth_min, depth_max = valid_depth.min(), valid_depth.max()
        if depth_max > depth_min:
            depth_normalized = np.where(
                mask_resized > 0.3,
                (masked_depth - depth_min) / (depth_max - depth_min),
                0.0
            )
        else:
            depth_normalized = masked_depth
    else:
        depth_normalized = masked_depth
    
    # CLAVE: Mapeo de altura más realista
    # Base sólida + altura variable
    z_base = base_mm
    z_height = depth_normalized * max_height_mm
    
    # Superficie frontal (top)
    z_front = z_base + z_height
    
    # Superficie trasera (bottom) - base plana
    z_back = np.zeros_like(z_front)
    
    print(f"📊 Z-heights - front: [{z_front.min():.1f}, {z_front.max():.1f}]mm, back: [{z_back.min():.1f}, {z_back.max():.1f}]mm")
    
    # Crear vértices
    # Front surface vertices
    front_vertices = np.stack([xx, yy, z_front], axis=-1).reshape(-1, 3)
    # Back surface vertices  
    back_vertices = np.stack([xx, yy, z_back], axis=-1).reshape(-1, 3)
    
    vertices = np.vstack([front_vertices, back_vertices]).astype(np.float32)
    
    print(f"📊 Total vertices: {len(vertices)}")
    
    # Crear triángulos
    triangles = []
    
    def vf(x: int, y: int) -> int: 
        return y * grid_w + x
    
    def vb(x: int, y: int) -> int: 
        return grid_w * grid_h + y * grid_w + x
    
    # Front surface triangles (solo donde hay máscara)
    for y in range(grid_h - 1):
        for x in range(grid_w - 1):
            # Check if any corner of cell is inside mask
            if (mask_resized[y, x] > 0.3 or mask_resized[y+1, x] > 0.3 or 
                mask_resized[y, x+1] > 0.3 or mask_resized[y+1, x+1] > 0.3):
                
                # Front face triangles
                a = vf(x, y)
                b = vf(x + 1, y) 
                c = vf(x, y + 1)
                d = vf(x + 1, y + 1)
                
                triangles.append([a, b, d])
                triangles.append([a, d, c])
                
                # Back face triangles (flipped normals)
                a2 = vb(x, y)
                b2 = vb(x + 1, y)
                c2 = vb(x, y + 1) 
                d2 = vb(x + 1, y + 1)
                
                triangles.append([b2, a2, d2])
                triangles.append([d2, a2, c2])
    
    # Side walls (conectar front y back en los bordes)
    # Horizontal edges
    for y in range(grid_h):
        for x in range(grid_w - 1):
            m0 = mask_resized[y, x] > 0.3
            m1 = mask_resized[y, x + 1] > 0.3
            
            if m0 != m1:  # Border edge
                f0, f1 = vf(x, y), vf(x + 1, y)
                b0, b1 = vb(x, y), vb(x + 1, y)
                
                if m0:  # Going from inside to outside
                    triangles.append([f0, b0, f1])
                    triangles.append([f1, b0, b1])
                else:  # Going from outside to inside
                    triangles.append([f1, b1, f0])
                    triangles.append([f0, b1, b0])
    
    # Vertical edges  
    for y in range(grid_h - 1):
        for x in range(grid_w):
            m0 = mask_resized[y, x] > 0.3
            m1 = mask_resized[y + 1, x] > 0.3
            
            if m0 != m1:  # Border edge
                f0, f1 = vf(x, y), vf(x, y + 1)
                b0, b1 = vb(x, y), vb(x, y + 1)
                
                if m0:  # Going from inside to outside
                    triangles.append([f0, f1, b0])
                    triangles.append([f1, b1, b0])
                else:  # Going from outside to inside
                    triangles.append([f1, f0, b1])
                    triangles.append([b1, f0, b0])
    
    triangles_array = np.array(triangles, dtype=np.int32)
    
    print(f"📊 Total triangles generated: {len(triangles_array)}")
    
    return vertices, triangles_array

def optimize_mesh_quality(mesh: o3d.geometry.TriangleMesh, target_tris: int) -> o3d.geometry.TriangleMesh:
    """Optimizar malla para mejor calidad manteniendo target triangles"""
    
    initial_tris = len(mesh.triangles)
    print(f"📊 Optimizing mesh: {initial_tris} → {target_tris} triangles")
    
    # Limpiar duplicados y degenerate triangles
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    
    print(f"📊 After cleanup: {len(mesh.triangles)} triangles")
    
    # CRÍTICO: Reparar mesh para hacerlo watertight antes de simplificar
    if not mesh.is_watertight():
        print(f"🔧 Repairing mesh to make it watertight...")
        
        # Método 1: Intentar cerrar agujeros pequeños
        try:
            # Compute adjacency
            mesh.compute_vertex_normals()
            mesh.orient_triangles()
            
            # Verificar de nuevo
            if mesh.is_watertight():
                print(f"✓ Mesh fixed with triangle orientation")
            else:
                # Método 2: Usar Poisson surface reconstruction para cerrar agujeros
                print(f"🔧 Trying Poisson reconstruction...")
                
                # Compute point cloud with normals from mesh
                vertices = np.asarray(mesh.vertices)
                triangles = np.asarray(mesh.triangles)
                
                # Create point cloud from mesh vertices
                pcd = o3d.geometry.PointCloud()
                pcd.points = o3d.utility.Vector3dVector(vertices)
                
                # Estimate normals
                pcd.estimate_normals()
                pcd.orient_normals_consistent_tangent_plane(30)
                
                # Poisson reconstruction with conservative parameters
                mesh_poisson, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
                    pcd, 
                    depth=8,  # Lower depth for faster processing
                    width=0, 
                    scale=1.1, 
                    linear_fit=False
                )
                
                if mesh_poisson.is_watertight():
                    print(f"✓ Mesh fixed with Poisson reconstruction")
                    mesh = mesh_poisson
                else:
                    print(f"⚠️ Could not make mesh watertight, continuing with original")
                    
        except Exception as e:
            print(f"⚠️ Mesh repair failed: {e}, continuing with original mesh")
    else:
        print(f"✓ Mesh is already watertight")
    
    # Suavizado muy conservador para preservar detalles
    mesh.compute_vertex_normals()
    if len(mesh.triangles) > 1000:
        mesh = mesh.filter_smooth_taubin(number_of_iterations=1, lambda_filter=0.5, mu=-0.53)
        print(f"📊 After smoothing: {len(mesh.triangles)} triangles")
    
    # Simplificación si excede target
    current_tris = len(mesh.triangles)
    if current_tris > target_tris * 1.2:  # 20% tolerance
        reduction_ratio = target_tris / current_tris
        print(f"📊 Simplifying by ratio: {reduction_ratio:.3f}")
        
        mesh = mesh.simplify_quadric_decimation(target_tris)
        print(f"📊 After decimation: {len(mesh.triangles)} triangles")
    
    # Verificar que sigue siendo watertight al final
    if mesh.is_watertight():
        print("✓ Final mesh is watertight")
    else:
        print("⚠️ Final mesh is not watertight - may need manual repair")
    
    return mesh

def main():
    parser = argparse.ArgumentParser(description="Optimized 2D→3D AI pipeline")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output OBJ path")
    parser.add_argument("--widthMM", type=float, default=140.0, help="Width in mm")
    parser.add_argument("--baseMM", type=float, default=4.0, help="Base thickness in mm")
    parser.add_argument("--maxHeightMM", type=float, default=20.0, help="Max height in mm")
    parser.add_argument("--targetTris", type=int, default=350000, help="Target triangles")
    parser.add_argument("--invert", action="store_true", help="Invert depth")
    parser.add_argument("--debug", help="Debug output directory")
    
    args = parser.parse_args()
    
    print(f"🚀 Starting OPTIMIZED 2D→3D conversion")
    print(f"📁 Input: {args.input}")
    print(f"📁 Output: {args.output}")
    print(f"📏 Dimensions: {args.widthMM}mm × {args.maxHeightMM}mm height × {args.baseMM}mm base")
    print(f"🎯 Target triangles: {args.targetTris}")
    
    try:
        # 1. Cargar imagen
        rgb = np.array(Image.open(args.input).convert('RGB'))
        print(f"📊 Image loaded: {rgb.shape}")
        
        # 2. Generar depth map de alta calidad
        print(f"🧠 Computing high-quality depth map...")
        depth = compute_high_quality_depth(args.input, args.debug)
        
        if args.invert:
            depth = 1.0 - depth
            print(f"🔄 Depth inverted")
        
        # 3. Crear máscara inteligente
        print(f"🎭 Creating background mask...")
        mask = create_background_mask(rgb)
        
        # 4. Crear malla optimizada
        print(f"🏗️ Creating optimized 3D mesh...")
        vertices, triangles = create_optimized_mesh(
            depth, mask,
            args.widthMM, args.baseMM, args.maxHeightMM,
            args.targetTris
        )
        
        # 5. Crear mesh Open3D
        mesh = o3d.geometry.TriangleMesh()
        mesh.vertices = o3d.utility.Vector3dVector(vertices)
        mesh.triangles = o3d.utility.Vector3iVector(triangles)
        
        # 6. Optimizar calidad
        print(f"⚡ Optimizing mesh quality...")
        mesh = optimize_mesh_quality(mesh, args.targetTris)
        
        # 7. Guardar resultado
        print(f"💾 Saving mesh...")
        o3d.io.write_triangle_mesh(args.output, mesh)
        
        # Estadísticas finales
        final_vertices = len(mesh.vertices)
        final_triangles = len(mesh.triangles)
        
        print(f"✅ SUCCESS!")
        print(f"📊 Final mesh: {final_vertices:,} vertices, {final_triangles:,} triangles")
        print(f"📁 Output saved: {args.output}")
        
        return 0
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
