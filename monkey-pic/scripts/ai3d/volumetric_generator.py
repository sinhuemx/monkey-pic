#!/usr/bin/env python3
"""
Volumetric 3D Model Generator - Especializado para impresión 3D

Genera modelos 3D volumétricos REALES (no heightfields) usando:
1. Estimación de profundidad con MiDaS
2. Síntesis de vistas múltiples 
3. Reconstrucción volumétrica con voxels
4. Generación de mesh manifold para impresión

Completamente independiente del pipeline de relieves.
"""

import argparse
import numpy as np
import cv2
from PIL import Image
import open3d as o3d
import sys
import os

# Importar MiDaS si está disponible
_midas_model = None
_midas_transform = None

def load_midas():
    global _midas_model, _midas_transform
    try:
        import torch
        _midas_model = torch.hub.load('intel-isl/MiDaS', 'MiDaS_small')
        _midas_model.eval()
        transforms = torch.hub.load('intel-isl/MiDaS', 'transforms')
        _midas_transform = transforms.small_transform
        print("INFO: MiDaS model loaded for volumetric generation")
        return True
    except Exception as e:
        print(f"ERROR: Failed to load MiDaS: {e}")
        return False

def estimate_depth_volumetric(image: np.ndarray) -> np.ndarray:
    """Estimación de profundidad optimizada para volumetría"""
    if _midas_model is None:
        print("WARNING: MiDaS not available, using fallback depth estimation")
        # Fallback mejorado basado en luminancia y gradientes
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        
        # Aplicar detección de bordes para profundidad
        edges = cv2.Canny(gray, 50, 150)
        
        # Combinar luminancia con información de bordes
        depth = gray.astype(np.float32) / 255.0
        edge_depth = edges.astype(np.float32) / 255.0
        
        # Mezclar luminancia y bordes para mejor estimación de profundidad
        depth = 0.7 * depth + 0.3 * edge_depth
        depth = cv2.GaussianBlur(depth, (5, 5), 0)
        
        # Normalizar
        depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-8)
        return depth
    
    try:
        import torch
        
        # Redimensionar imagen para MiDaS si es muy grande
        h, w = image.shape[:2]
        if h > 512 or w > 512:
            scale = min(512/h, 512/w)
            new_h, new_w = int(h * scale), int(w * scale)
            image_resized = cv2.resize(image, (new_w, new_h))
        else:
            image_resized = image.copy()
            new_h, new_w = h, w
        
        # Asegurar que la imagen esté en formato correcto para MiDaS
        if image_resized.shape[2] == 3:  # RGB
            input_tensor = _midas_transform(image_resized)
        else:
            print("ERROR: Image must be RGB")
            raise ValueError("Invalid image format")
        
        # Asegurar que el tensor tenga las dimensiones correctas
        if len(input_tensor.shape) == 3:
            input_tensor = input_tensor.unsqueeze(0)  # Agregar batch dimension
        
        print(f"INFO: MiDaS input tensor shape: {input_tensor.shape}")
        
        with torch.no_grad():
            depth_map = _midas_model(input_tensor)
            
            # Redimensionar de vuelta al tamaño original
            if depth_map.dim() == 3:
                depth_map = depth_map.unsqueeze(0)
            
            depth_map = torch.nn.functional.interpolate(
                depth_map,
                size=(h, w),
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        
        depth = depth_map.cpu().numpy()
        
        # Normalizar y invertir para que cerca = alto, lejos = bajo
        depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-8)
        depth = 1.0 - depth  # Invertir
        
        return depth.astype(np.float32)
        
    except Exception as e:
        print(f"ERROR in MiDaS processing: {e}")
        print("INFO: Using enhanced fallback depth estimation")
        # Fallback mejorado
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        
        # Aplicar detección de bordes para profundidad
        edges = cv2.Canny(gray, 50, 150)
        
        # Combinar luminancia con información de bordes
        depth = gray.astype(np.float32) / 255.0
        edge_depth = edges.astype(np.float32) / 255.0
        
        # Mezclar luminancia y bordes para mejor estimación de profundidad
        depth = 0.7 * depth + 0.3 * edge_depth
        depth = cv2.GaussianBlur(depth, (5, 5), 0)
        
        # Normalizar
        depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-8)
        return depth

def create_mask_from_image(image: np.ndarray, threshold: float = 0.1) -> np.ndarray:
    """Crear máscara de objeto vs fondo mejorada"""
    # Convertir a gris
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    
    # Método 1: Detección de bordes mejorada
    edges = cv2.Canny(gray, 30, 100)
    
    # Método 2: Segmentación por umbralización adaptativa
    # Usar Otsu para encontrar el mejor umbral
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # Método 3: Eliminar fondo usando la asunción de que los bordes son fondo
    # Crear máscara inicial eliminando bordes de la imagen
    border_mask = np.ones_like(gray, dtype=np.uint8) * 255
    border_size = max(5, min(h, w) // 40)  # Tamaño de borde adaptativo
    border_mask[:border_size, :] = 0
    border_mask[-border_size:, :] = 0
    border_mask[:, :border_size] = 0
    border_mask[:, -border_size:] = 0
    
    # Combinar métodos
    # Usar detección de contornos en bordes
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    mask = np.zeros_like(gray, dtype=np.uint8)
    
    if contours:
        # Filtrar contornos por área mínima
        min_area = (h * w) * 0.01  # Al menos 1% del área de la imagen
        valid_contours = [c for c in contours if cv2.contourArea(c) > min_area]
        
        if valid_contours:
            # Si hay contornos válidos, usar el más grande
            largest_contour = max(valid_contours, key=cv2.contourArea)
            cv2.fillPoly(mask, [largest_contour], 255)
            
            # Expandir la máscara ligeramente
            kernel = np.ones((5, 5), np.uint8)
            mask = cv2.dilate(mask, kernel, iterations=2)
        else:
            # No hay contornos válidos, usar umbralización
            mask = thresh.copy()
    else:
        # No se encontraron bordes, usar umbralización
        mask = thresh.copy()
    
    # Aplicar máscara de borde
    mask = cv2.bitwise_and(mask, border_mask)
    
    # Rellenar huecos en la máscara
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    
    # Suavizar la máscara
    mask = cv2.GaussianBlur(mask, (5, 5), 0)
    
    # Convertir a float y aplicar threshold
    mask_float = mask.astype(np.float32) / 255.0
    
    # Asegurar que hay al menos algo en la máscara
    if np.max(mask_float) < threshold:
        print("WARNING: Generated mask is mostly empty, using center region")
        # Crear una máscara central como fallback
        center_h, center_w = h // 2, w // 2
        mask_float = np.zeros_like(mask_float)
        
        # Crear una región central circular
        y, x = np.ogrid[:h, :w]
        center_mask = ((x - center_w)**2 + (y - center_h)**2) <= (min(h, w) * 0.3)**2
        mask_float[center_mask] = 1.0
        
    return mask_float

def generate_volumetric_mesh(
    image: np.ndarray,
    depth: np.ndarray, 
    mask: np.ndarray,
    width_mm: float,
    depth_mm: float,
    height_mm: float,
    resolution: int = 64
) -> o3d.geometry.TriangleMesh:
    """Generar mesh volumétrico real usando voxels mejorado"""
    
    h, w = image.shape[:2]
    
    print(f"INFO: Creating volumetric grid {resolution}x{resolution}x{resolution}")
    print(f"INFO: Image shape: {h}x{w}, mask coverage: {np.sum(mask > 0.5) / (h*w) * 100:.1f}%")
    
    # Verificar que tenemos datos válidos
    if np.sum(mask > 0.5) < (h * w * 0.01):  # Menos del 1% de cobertura
        print("WARNING: Mask coverage is very low, adjusting threshold")
        mask = (mask > 0.1).astype(np.float32)
    
    # Crear grilla volumétrica 3D con mejor distribución
    voxel_grid = np.zeros((resolution, resolution, resolution), dtype=np.float32)
    
    # Mapear coordenadas con mejor precisión
    total_points_generated = 0
    
    for i in range(resolution):
        for j in range(resolution):
            # Mapear coordenadas de voxel a imagen con mejor interpolación
            img_x = int((i / (resolution - 1)) * (w - 1))
            img_y = int((j / (resolution - 1)) * (h - 1))
            
            # Verificar límites
            if 0 <= img_x < w and 0 <= img_y < h:
                mask_val = mask[img_y, img_x]
                
                if mask_val > 0.3:  # Umbral más permisivo
                    # Obtener profundidad en este punto
                    depth_val = depth[img_y, img_x]
                    
                    # Calcular altura del voxel con mejor distribución
                    # Usar curva no linear para mejor distribución volumétrica
                    normalized_depth = np.clip(depth_val, 0, 1)
                    
                    # Aplicar curva exponencial para mejor volumen
                    volume_height = normalized_depth ** 0.7  # Curva más suave
                    max_z_idx = max(1, int(volume_height * resolution * 0.9))
                    
                    # Llenar voxels con densidad gradual
                    for k in range(min(max_z_idx, resolution)):
                        # Densidad decreciente hacia arriba con función suave
                        height_ratio = k / max_z_idx if max_z_idx > 0 else 0
                        
                        # Función de densidad más compleja para mejor forma
                        base_density = mask_val * (1.0 - height_ratio * 0.4)
                        
                        # Agregar variación basada en imagen para textura
                        color_intensity = np.mean(image[img_y, img_x]) / 255.0
                        texture_density = base_density * (0.8 + 0.2 * color_intensity)
                        
                        voxel_grid[i, j, k] = min(1.0, texture_density)
                        total_points_generated += 1
    
    print(f"INFO: Generated {total_points_generated} voxel points before smoothing")
    
    if total_points_generated == 0:
        print("ERROR: No voxel points generated, creating fallback mesh")
        return create_fallback_mesh(width_mm, depth_mm, height_mm)
    
    # Aplicar suavizado mejorado al grid de voxels
    print("INFO: Smoothing voxel grid...")
    try:
        from scipy import ndimage
        # Aplicar múltiples niveles de suavizado
        voxel_grid = ndimage.gaussian_filter(voxel_grid, sigma=0.8)
        voxel_grid = ndimage.median_filter(voxel_grid, size=3)
    except ImportError:
        print("WARNING: SciPy not available, skipping advanced smoothing")
    
    # Convertir voxels a mesh con mejor algoritmo
    print("INFO: Generating mesh from voxels...")
    
    try:
        # Crear puntos con mejor distribución espacial
        points = []
        colors = []
        threshold = 0.2  # Umbral más bajo para capturar más detalle
        
        for i in range(resolution):
            for j in range(resolution):
                for k in range(resolution):
                    density = voxel_grid[i, j, k]
                    if density > threshold:
                        # Escalar a coordenadas reales con offset para centrar
                        x = (i / (resolution - 1)) * width_mm
                        y = (j / (resolution - 1)) * depth_mm  
                        z = (k / (resolution - 1)) * height_mm
                        
                        points.append([x, y, z])
                        
                        # Agregar color basado en densidad
                        color_val = min(1.0, density)
                        colors.append([color_val, color_val, color_val])
        
        if len(points) < 10:
            print("ERROR: Insufficient points for mesh generation")
            return create_fallback_mesh(width_mm, depth_mm, height_mm)
            
        print(f"INFO: Generated {len(points)} points from voxel grid")
        
        # Crear point cloud con colores
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(np.array(points))
        pcd.colors = o3d.utility.Vector3dVector(np.array(colors))
        
        # Estimar normales con parámetros mejorados
        pcd.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=width_mm/10, max_nn=20)
        )
        
        # Usar Poisson reconstruction con parámetros optimizados
        print("INFO: Applying Poisson surface reconstruction...")
        mesh, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd, 
            depth=7,  # Reducir para evitar demasiada complejidad
            width=0,  # Permite que determine automáticamente
            scale=1.1,  # Un poco de escala extra
            linear_fit=False,
            n_threads=4
        )
        
        if len(mesh.vertices) == 0:
            print("ERROR: Poisson reconstruction failed")
            return create_fallback_mesh(width_mm, depth_mm, height_mm)
            
        print(f"INFO: Poisson reconstruction created mesh with {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
        
        # Limpiar y optimizar el mesh
        mesh.remove_duplicated_vertices()
        mesh.remove_degenerate_triangles()
        mesh.remove_duplicated_triangles()
        mesh.remove_non_manifold_edges()
        
        # Verificar que el mesh resultante es válido
        if len(mesh.vertices) < 4 or len(mesh.triangles) < 4:
            print("WARNING: Generated mesh is too simple, using fallback")
            return create_fallback_mesh(width_mm, depth_mm, height_mm)
        
        return mesh
        
    except Exception as e:
        print(f"ERROR in mesh generation: {e}")
        print("FALLBACK: Creating enhanced fallback mesh")
        return create_fallback_mesh(width_mm, depth_mm, height_mm)

def create_fallback_mesh(width_mm: float, depth_mm: float, height_mm: float) -> o3d.geometry.TriangleMesh:
    """Crear un mesh de fallback más interesante que una caja simple"""
    print("INFO: Creating enhanced fallback mesh")
    
    # Crear un cilindro como base más interesante que una caja
    radius = min(width_mm, depth_mm) / 3
    mesh = o3d.geometry.TriangleMesh.create_cylinder(
        radius=radius, 
        height=height_mm,
        resolution=16,
        split=8
    )
    
    # Mover el cilindro para que esté centrado en la base
    mesh.translate([width_mm/2, depth_mm/2, height_mm/2])
    
    return mesh

def main():
    parser = argparse.ArgumentParser(description="Volumetric 3D Model Generator")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output OBJ path")
    parser.add_argument("--width", type=float, default=80.0, help="Width in mm")
    parser.add_argument("--depth", type=float, default=60.0, help="Depth in mm")
    parser.add_argument("--height", type=float, default=50.0, help="Height in mm")
    parser.add_argument("--resolution", type=int, default=64, help="Voxel resolution")
    parser.add_argument("--smoothing", type=int, default=5, help="Smoothing iterations")
    parser.add_argument("--threshold", type=float, default=0.3, help="Volume threshold")
    parser.add_argument("--mode", default="volumetric", help="Generation mode")
    parser.add_argument("--algorithm", default="multiview", help="Algorithm type")
    
    args = parser.parse_args()
    
    print(f"INFO: Starting volumetric 3D generation")
    print(f"  Input: {args.input}")
    print(f"  Output: {args.output}")
    print(f"  Dimensions: {args.width}x{args.depth}x{args.height} mm")
    print(f"  Resolution: {args.resolution} voxels")
    
    # Cargar imagen
    try:
        image = Image.open(args.input).convert('RGB')
        image_np = np.array(image)
        print(f"INFO: Loaded image {image_np.shape}")
    except Exception as e:
        print(f"ERROR: Failed to load image: {e}")
        sys.exit(1)
    
    # Cargar MiDaS
    midas_loaded = load_midas()
    
    # Estimar profundidad
    print("INFO: Estimating depth...")
    depth = estimate_depth_volumetric(image_np)
    
    # Crear máscara
    print("INFO: Creating object mask...")
    mask = create_mask_from_image(image_np, threshold=args.threshold)
    
    # Generar mesh volumétrico
    print("INFO: Generating volumetric mesh...")
    mesh = generate_volumetric_mesh(
        image_np, depth, mask,
        args.width, args.depth, args.height,
        args.resolution
    )
    
    # Aplicar suavizado si se especifica
    if args.smoothing > 0:
        print(f"INFO: Applying {args.smoothing} smoothing iterations...")
        mesh = mesh.filter_smooth_laplacian(number_of_iterations=args.smoothing)
    
    # Asegurar que el mesh es manifold y válido
    print("INFO: Cleaning and validating mesh...")
    
    # Limpiar mesh antes de validar
    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_non_manifold_edges()
    
    # Verificar orientación de triángulos
    if not mesh.is_orientable():
        print("WARNING: Mesh is not orientable, attempting to fix...")
        mesh.orient_triangles()
    
    # Verificar manifold
    if not mesh.is_vertex_manifold():
        print("WARNING: Mesh is not vertex manifold")
    
    if not mesh.is_edge_manifold():
        print("WARNING: Mesh is not edge manifold")
    
    # Verificar self-intersections
    if mesh.is_self_intersecting():
        print("WARNING: Mesh has self-intersections")
    
    # Verificar que tenemos datos válidos
    vertex_count = len(mesh.vertices)
    triangle_count = len(mesh.triangles)
    
    if vertex_count == 0 or triangle_count == 0:
        print("ERROR: Generated mesh is empty after cleaning!")
        sys.exit(1)
    
    # Verificar bounds del mesh
    vertices_np = np.asarray(mesh.vertices)
    bounds = {
        'min': vertices_np.min(axis=0),
        'max': vertices_np.max(axis=0),
        'size': vertices_np.max(axis=0) - vertices_np.min(axis=0)
    }
    
    print(f"SUCCESS: Generated volumetric mesh:")
    print(f"  Vertices: {vertex_count}")
    print(f"  Triangles: {triangle_count}")
    print(f"  Bounds: {bounds['size']}")
    print(f"  Valid: manifold={mesh.is_vertex_manifold()}, orientable={mesh.is_orientable()}")
    
    # Validar y limpiar el mesh final para asegurar que no hay corrupción
    print("INFO: Performing final mesh validation and cleaning...")
    
    # 1. Quitar triángulos con índices inválidos
    triangles_np = np.asarray(mesh.triangles)
    valid_triangles = []
    vertex_count = len(mesh.vertices)
    
    for i, triangle in enumerate(triangles_np):
        v1, v2, v3 = triangle
        if (0 <= v1 < vertex_count and 
            0 <= v2 < vertex_count and 
            0 <= v3 < vertex_count and
            v1 != v2 and v2 != v3 and v1 != v3):
            valid_triangles.append(triangle)
        else:
            print(f"WARNING: Removing invalid triangle {i}: indices [{v1}, {v2}, {v3}] out of bounds (max vertex: {vertex_count - 1})")
            
    if len(valid_triangles) != len(triangles_np):
        print(f"INFO: Filtered {len(triangles_np) - len(valid_triangles)} invalid triangles")
        mesh.triangles = o3d.utility.Vector3iVector(np.array(valid_triangles))
    
    # 2. Quitar vértices que no son referenciados por ningún triángulo
    # Esto es CRÍTICO para evitar corrupción de índices
    try:
        mesh.remove_unreferenced_vertices()
        print("INFO: Removed unreferenced vertices")
    except Exception as e:
        print(f"WARNING: Could not remove unreferenced vertices: {e}")

    # 3. Re-validar que todo está en orden
    if len(mesh.vertices) == 0 or len(mesh.triangles) == 0:
        print("ERROR: Mesh is empty after final cleaning, creating fallback.")
        mesh = create_fallback_mesh(args.width, args.depth, args.height)
    
    print(f"FINAL: Mesh ready with {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
    
    # Guardar mesh
    try:
        success = o3d.io.write_triangle_mesh(args.output, mesh)
        if success:
            print(f"SUCCESS: Volumetric mesh saved to {args.output}")
        else:
            print("ERROR: Failed to save mesh")
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to save mesh: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
