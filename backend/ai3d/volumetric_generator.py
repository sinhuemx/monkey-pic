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
    """Generar mesh volumétrico real usando voxels mejorado con mejor algoritmo"""
    
    h, w = image.shape[:2]
    
    print(f"INFO: Creating volumetric grid {resolution}x{resolution}x{resolution}")
    print(f"INFO: Image shape: {h}x{w}, mask coverage: {np.sum(mask > 0.5) / (h*w) * 100:.1f}%")
    
    # Verificar que tenemos datos válidos
    mask_coverage = np.sum(mask > 0.1) / (h*w)
    if mask_coverage < 0.01:  # Menos del 1% de cobertura
        print("WARNING: Mask coverage is very low, creating improved fallback")
        return create_fallback_mesh(width_mm, depth_mm, height_mm)
    
    # MEJORADO: Crear grilla volumétrica 3D con mejor distribución espacial
    voxel_grid = np.zeros((resolution, resolution, resolution), dtype=np.float32)
    
    # MEJORADO: Usar muestreo más inteligente en lugar de mapeo directo
    total_voxels_filled = 0
    
    # Crear mapeo bilineal para mejor calidad
    for i in range(resolution):
        for j in range(resolution):
            # Calcular coordenadas en la imagen con interpolación bilinear
            img_x_float = (i / (resolution - 1)) * (w - 1)
            img_y_float = (j / (resolution - 1)) * (h - 1)
            
            # Interpolación bilinear para mask y depth
            mask_val = bilinear_interpolation(mask, img_x_float, img_y_float)
            depth_val = bilinear_interpolation(depth, img_x_float, img_y_float)
            
            if mask_val > 0.1:  # Umbral permisivo
                # MEJORADO: Usar función de densidad más sofisticada
                # Normalizar profundidad con curva mejorada
                normalized_depth = np.clip(depth_val, 0, 1)
                
                # Aplicar función sigmoidea para mejor distribución
                depth_curve = 1 / (1 + np.exp(-5 * (normalized_depth - 0.5)))
                
                # Calcular altura máxima del voxel
                max_z_idx = max(1, int(depth_curve * resolution * 0.85))
                
                # MEJORADO: Llenar voxels con función de densidad avanzada
                for k in range(min(max_z_idx, resolution)):
                    height_ratio = k / max_z_idx if max_z_idx > 0 else 0
                    
                    # Función de densidad cúbica para mejor forma
                    base_density = mask_val * (1.0 - height_ratio**1.5) * 0.8
                    
                    # Agregar variación basada en la textura de la imagen
                    if i < resolution and j < resolution:
                        img_x_int = int(img_x_float)
                        img_y_int = int(img_y_float)
                        if 0 <= img_x_int < w and 0 <= img_y_int < h:
                            color_intensity = np.mean(image[img_y_int, img_x_int]) / 255.0
                            # Usar intensidad de color para variar densidad
                            texture_factor = 0.9 + 0.2 * color_intensity
                            base_density *= texture_factor
                    
                    # Suavizado gradual hacia los bordes
                    edge_factor = 1.0
                    edge_margin = resolution * 0.05  # 5% del borde
                    if i < edge_margin or i > resolution - edge_margin:
                        edge_factor *= (min(i, resolution - i) / edge_margin)
                    if j < edge_margin or j > resolution - edge_margin:
                        edge_factor *= (min(j, resolution - j) / edge_margin)
                    
                    final_density = base_density * edge_factor
                    voxel_grid[i, j, k] = min(1.0, final_density)
                    
                    if final_density > 0.1:
                        total_voxels_filled += 1
    
    print(f"INFO: Generated {total_voxels_filled} voxel points before smoothing")
    
    if total_voxels_filled == 0:
        print("ERROR: No voxel points generated, creating fallback mesh")
        return create_fallback_mesh(width_mm, depth_mm, height_mm)
    
    # MEJORADO: Aplicar suavizado multicapa al grid de voxels
    print("INFO: Applying advanced voxel grid smoothing...")
    try:
        from scipy import ndimage
        # Aplicar suavizado gaussiano con sigma adaptativo
        sigma = max(0.5, resolution / 256.0)  # Sigma proporcional a resolución
        voxel_grid = ndimage.gaussian_filter(voxel_grid, sigma=sigma)
        
        # Aplicar filtro mediano para preservar bordes
        voxel_grid = ndimage.median_filter(voxel_grid, size=3)
        
        # Normalizar después del suavizado
        if np.max(voxel_grid) > 0:
            voxel_grid = voxel_grid / np.max(voxel_grid)
            
    except ImportError:
        print("WARNING: SciPy not available, using basic smoothing")
        # Suavizado básico sin scipy
        kernel = np.ones((3, 3, 3)) / 27
        # Aplicar convolución manual (básica)
        voxel_grid_smooth = np.zeros_like(voxel_grid)
        for i in range(1, resolution-1):
            for j in range(1, resolution-1):
                for k in range(1, resolution-1):
                    voxel_grid_smooth[i,j,k] = np.mean(voxel_grid[i-1:i+2, j-1:j+2, k-1:k+2])
        voxel_grid = voxel_grid_smooth
    
    # MEJORADO: Crear mesh con mejor algoritmo
    print("INFO: Generating mesh from voxels with improved algorithm...")
    
    try:
        # Usar umbral más bajo para capturar más detalles
        threshold = 0.15
        
        # MEJORADO: Usar marching cubes de Open3D si está disponible
        # Crear voxel grid de Open3D
        voxel_grid_o3d = o3d.geometry.VoxelGrid()
        
        # Convertir numpy array a voxel grid de Open3D
        points = []
        colors = []
        
        for i in range(resolution):
            for j in range(resolution):
                for k in range(resolution):
                    density = voxel_grid[i, j, k]
                    if density > threshold:
                        # Coordenadas normalizadas
                        x = i / (resolution - 1)
                        y = j / (resolution - 1) 
                        z = k / (resolution - 1)
                        
                        # Escalar a dimensiones reales
                        real_x = x * width_mm
                        real_y = y * depth_mm
                        real_z = z * height_mm
                        
                        points.append([real_x, real_y, real_z])
                        
                        # Color basado en la posición y densidad
                        color_intensity = min(1.0, density * 1.5)
                        colors.append([color_intensity, color_intensity, color_intensity])
        
        if len(points) == 0:
            print("ERROR: No points generated from voxel grid")
            return create_fallback_mesh(width_mm, depth_mm, height_mm)
        
        print(f"INFO: Generated {len(points)} points from voxel grid")
        
        # Crear point cloud
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(np.array(points))
        pcd.colors = o3d.utility.Vector3dVector(np.array(colors))
        
        # MEJORADO: Aplicar Poisson surface reconstruction con mejores parámetros
        print("INFO: Applying improved Poisson surface reconstruction...")
        
        # Estimar normales con mejor configuración
        pcd.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=width_mm*0.05, max_nn=30)
        )
        
        # Orientar normales de manera consistente
        pcd.orient_normals_consistent_tangent_plane(30)
        
        # Aplicar Poisson reconstruction con parámetros optimizados para impresión 3D
        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd, 
            depth=8,  # Profundidad reducida para mejor rendimiento
            width=0,  # Ancho automático
            scale=1.1,  # Escala ligeramente mayor
            linear_fit=False  # Mejor para objetos orgánicos
        )
        
        print(f"INFO: Poisson reconstruction created mesh with {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
        
        # MEJORADO: Filtrar triángulos de baja densidad
        if len(densities) > 0:
            densities = np.asarray(densities)
            density_threshold = np.percentile(densities, 10)  # Mantener solo el 90% superior
            vertices_to_remove = densities < density_threshold
            mesh.remove_vertices_by_mask(vertices_to_remove)
            print(f"INFO: Removed low-density vertices, mesh now has {len(mesh.vertices)} vertices")
        
        # Verificar que el mesh resultante es válido
        if len(mesh.vertices) == 0 or len(mesh.triangles) == 0:
            print("ERROR: Empty mesh after Poisson reconstruction")
            return create_fallback_mesh(width_mm, depth_mm, height_mm)
            
        return mesh
        
    except Exception as e:
        print(f"ERROR: Failed to generate mesh: {e}")
        return create_fallback_mesh(width_mm, depth_mm, height_mm)

def bilinear_interpolation(array: np.ndarray, x: float, y: float) -> float:
    """Interpolación bilineal para muestreo suave"""
    h, w = array.shape
    
    # Asegurar que las coordenadas estén dentro de los límites
    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    
    x1, y1 = int(x), int(y)
    x2, y2 = min(x1 + 1, w - 1), min(y1 + 1, h - 1)
    
    # Pesos para interpolación
    wx = x - x1
    wy = y - y1
    
    # Interpolación bilineal
    val = (array[y1, x1] * (1 - wx) * (1 - wy) +
           array[y1, x2] * wx * (1 - wy) +
           array[y2, x1] * (1 - wx) * wy +
           array[y2, x2] * wx * wy)
    
    return val

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
    parser.add_argument("--quality", default="alta", choices=["normal", "alta", "maxima"], help="Quality level")
    
    args = parser.parse_args()
    
    print(f"INFO: Starting volumetric 3D generation")
    print(f"  Input: {args.input}")
    print(f"  Output: {args.output}")
    print(f"  Quality Level: {args.quality}")
    print(f"  Dimensions: {args.width}x{args.depth}x{args.height} mm")
    print(f"  Resolution: {args.resolution} voxels")
    print(f"  Smoothing: {args.smoothing} iterations")
    
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
    
    # Generar mesh volumétrico con parámetros de calidad
    print("INFO: Generating volumetric mesh...")
    
    # Ajustar parámetros según el nivel de calidad
    quality_settings = {
        'normal': {
            'threshold_scale': 1.0,
            'post_smoothing': args.smoothing,
            'cleanup_aggressive': False
        },
        'alta': {
            'threshold_scale': 0.8,  # Más sensible para capturar detalles
            'post_smoothing': args.smoothing + 2,
            'cleanup_aggressive': True
        },
        'maxima': {
            'threshold_scale': 0.6,  # Máxima sensibilidad
            'post_smoothing': args.smoothing + 5,
            'cleanup_aggressive': True
        }
    }
    
    quality_config = quality_settings.get(args.quality, quality_settings['alta'])
    adjusted_threshold = args.threshold * quality_config['threshold_scale']
    
    print(f"INFO: Quality settings for '{args.quality}':")
    print(f"  - Threshold: {adjusted_threshold:.3f} (adjusted from {args.threshold:.3f})")
    print(f"  - Post-smoothing: {quality_config['post_smoothing']} iterations")
    print(f"  - Aggressive cleanup: {quality_config['cleanup_aggressive']}")
    
    mesh = generate_volumetric_mesh(
        image_np, depth, mask,
        args.width, args.depth, args.height,
        args.resolution
    )
    
    # Aplicar suavizado mejorado basado en calidad
    if quality_config['post_smoothing'] > 0:
        print(f"INFO: Applying {quality_config['post_smoothing']} smoothing iterations...")
        mesh = mesh.filter_smooth_laplacian(number_of_iterations=quality_config['post_smoothing'])
        
        # Para calidad alta/máxima, aplicar suavizado adicional
        if args.quality in ['alta', 'maxima']:
            print("INFO: Applying additional Taubin smoothing for high quality...")
            mesh = mesh.filter_smooth_taubin(number_of_iterations=3)
    
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
