#!/usr/bin/env python3
"""
HQ 2D→3D pipeline: optional MiDaS depth + watertight heightfield meshing with Open3D.

Produces a printable STL/OBJ honoring widthMM/baseMM/maxHeightMM.
If --useMiDaS is set and Torch Hub model loads, uses MiDaS depth; otherwise uses a refined
grayscale depth proxy (OpenCV). Always outputs a closed mesh (top, bottom, sides).
"""

import argparse
import os
import sys
from typing import Tuple, Optional

import numpy as np
import cv2
from PIL import Image
import open3d as o3d

# Optional MiDaS via Torch Hub
_midas_model = None
_midas_transform = None


def _try_load_midas() -> bool:
    global _midas_model, _midas_transform
    if _midas_model is not None:
        return True
    try:
        import torch
        _midas_model = torch.hub.load('intel-isl/MiDaS', 'MiDaS_small')
        _midas_model.eval()
        transforms = torch.hub.load('intel-isl/MiDaS', 'transforms')
        _midas_transform = transforms.small_transform
        print(f"INFO: MiDaS model loaded successfully: {type(_midas_model)}")
        return True
    except Exception as e:
        print(f"ERROR: Failed to load MiDaS model: {e}")
        _midas_model = None
        _midas_transform = None
        return False


def compute_depth_midas(rgb: np.ndarray, device: Optional[str] = None, contrast_factor: float = 1.0) -> Optional[np.ndarray]:
    """Compute depth using MiDaS with enhanced preprocessing for better 3D model quality."""
    try:
        import torch
        import torch.nn.functional as F
        
        model_type = "MiDaS_small"
        
        model = torch.hub.load("intel-isl/MiDaS", model_type)
        if device == "cuda" and torch.cuda.is_available():
            model = model.to('cuda')
        model.eval()
        
        midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        if model_type == "MiDaS_small":
            transform = midas_transforms.small_transform
        else:
            transform = midas_transforms.default_transform
        
        # MEJORADO: Preprocessing más agresivo para obtener mejor detalle
        print(f"DEBUG: Original RGB shape: {rgb.shape}, range: [{rgb.min()}, {rgb.max()}]")
        
        # 1. Aplicar sharpening antes de MiDaS para realzar detalles
        kernel_sharp = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
        rgb_sharp = cv2.filter2D(rgb, -1, kernel_sharp)
        rgb_sharp = np.clip(rgb_sharp, 0, 255).astype(np.uint8)
        
        # 2. Combinar imagen original con sharpened (asegurar tipos compatibles)
        sharpening_factor = min(0.4, 0.2 + 0.1 * contrast_factor)
        rgb_enhanced = cv2.addWeighted(rgb.astype(np.float32), 1.0 - sharpening_factor, 
                                     rgb_sharp.astype(np.float32), sharpening_factor, 0)
        rgb_enhanced = np.clip(rgb_enhanced, 0, 255).astype(np.uint8)
        
        # 3. Aplicar mejora de contraste local adaptativo (CLAHE) más agresivo
        lab = cv2.cvtColor(rgb_enhanced, cv2.COLOR_RGB2LAB)
        l_channel = lab[:,:,0]
        
        # CLAHE más agresivo para mejor detalle
        clahe_limit = min(4.0, 2.5 * contrast_factor)
        clahe = cv2.createCLAHE(clipLimit=clahe_limit, tileGridSize=(12,12))  # Tiles más pequeños para más detalle local
        l_channel_enhanced = clahe.apply(l_channel)
        
        lab[:,:,0] = l_channel_enhanced
        rgb_final = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
        
        print(f"DEBUG: Enhanced RGB with sharpening factor {sharpening_factor:.2f}, CLAHE limit {clahe_limit:.1f}")
        
        # Aplicar transformación de MiDaS
        input_batch = transform(rgb_final)
        if device == "cuda" and torch.cuda.is_available():
            input_batch = input_batch.to('cuda')
        
        with torch.no_grad():
            prediction = model(input_batch)
            prediction = F.interpolate(
                prediction.unsqueeze(1),
                size=rgb.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        
        # Convertir a numpy
        if device == "cuda" and torch.cuda.is_available():
            depth_raw = prediction.cpu().numpy()
        else:
            depth_raw = prediction.numpy()
        
        print(f"DEBUG: Raw MiDaS depth - shape: {depth_raw.shape}, min: {depth_raw.min():.6f}, max: {depth_raw.max():.6f}")
        
        # MEJORADO: Post-procesamiento para mejor calidad de profundidad
        # 1. Aplicar suavizado bilateral para preservar bordes pero reducir ruido
        depth_smooth = cv2.bilateralFilter(depth_raw.astype(np.float32), 9, 80, 80)
        
        # 2. Combinar profundidad original con información de luminancia para más detalle
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        gray_normalized = (gray - gray.min()) / (gray.max() - gray.min() + 1e-8)
        
        # 3. Combinar profundidad con edges para realzar contornos
        edges = cv2.Canny((gray * 255).astype(np.uint8), 50, 150).astype(np.float32) / 255.0
        
        # Normalizar la profundidad suavizada
        if depth_smooth.max() > depth_smooth.min():
            depth_normalized = (depth_smooth - depth_smooth.min()) / (depth_smooth.max() - depth_smooth.min())
        else:
            depth_normalized = np.zeros_like(depth_smooth)
        
        # MEJORADO: Combinación más sofisticada
        # Usar 55% MiDaS + 30% luminancia + 15% información de bordes
        weight_midas = 0.55
        weight_luminance = 0.30
        weight_edges = 0.15
        
        # Invertir luminancia para que objetos claros sean más "profundos" hacia adelante
        luminance_inverted = 1.0 - gray_normalized
        
        combined = (weight_midas * depth_normalized + 
                   weight_luminance * luminance_inverted + 
                   weight_edges * edges)
        
        # Normalizar el resultado final
        if combined.max() > combined.min():
            combined = (combined - combined.min()) / (combined.max() - combined.min())
        
        # Aplicar enhacement de contraste final más agresivo
        if contrast_factor > 1.0:
            # Usar percentiles para mayor contraste en el resultado combinado
            p2, p98 = np.percentile(combined[combined > 0], [2, 98])
            if p98 > p2:
                combined = np.clip((combined - p2) / (p98 - p2), 0, 1)
                
                # MEJORADO: Aplicar enhancement de contraste adaptativo más fuerte
                # Usar CLAHE en la profundidad también
                depth_8bit = (combined * 255).astype(np.uint8)
                clahe_depth_limit = 3.0 * contrast_factor  # Más agresivo para profundidad
                clahe_depth = cv2.createCLAHE(clipLimit=clahe_depth_limit, tileGridSize=(8,8))
                depth_enhanced = clahe_depth.apply(depth_8bit).astype(np.float32) / 255.0
                
                # Combinar resultado original con enhanced (asegurar tipos compatibles)
                enhancement_factor = min(0.7, 0.4 + 0.15 * contrast_factor)  # 40-70% enhanced
                combined = cv2.addWeighted(combined.astype(np.float32), 1.0 - enhancement_factor, 
                                         depth_enhanced.astype(np.float32), enhancement_factor, 0)
                
                # Aplicar curva gamma más agresiva para más volumen
                gamma = max(0.6, 0.85 - 0.1 * contrast_factor)  # Gamma más bajo = más volumen
                combined = np.power(combined, gamma)
                
                print(f"DEBUG: Applied enhanced depth processing - CLAHE limit {clahe_depth_limit:.1f}, enhancement {enhancement_factor:.2f}, gamma {gamma:.2f}")
        
        # Guardar imagen de debug mejorada
        try:
            debug_dir = "/tmp/midas_debug"
            os.makedirs(debug_dir, exist_ok=True)
            
            # Guardar múltiples versiones para análisis
            cv2.imwrite(f"{debug_dir}/enhanced_input.jpg", cv2.cvtColor(rgb_final, cv2.COLOR_RGB2BGR))
            cv2.imwrite(f"{debug_dir}/depth_raw.jpg", (depth_normalized * 255).astype(np.uint8))
            cv2.imwrite(f"{debug_dir}/depth_final.jpg", (combined * 255).astype(np.uint8))
            cv2.imwrite(f"{debug_dir}/luminance.jpg", (luminance_inverted * 255).astype(np.uint8))
            cv2.imwrite(f"{debug_dir}/edges.jpg", (edges * 255).astype(np.uint8))
            
            print(f"DEBUG: Enhanced debug images saved to {debug_dir}/")
            
        except Exception as e:
            print(f"DEBUG: Could not save debug images: {e}")
        
        print(f"DEBUG: Final combined depth - min: {combined.min():.6f}, max: {combined.max():.6f}, NaN count: {np.isnan(combined).sum()}")
        print(f"DEBUG: MiDaS + Enhanced processing successful with weights: MiDaS={weight_midas}, Lum={weight_luminance}, Edges={weight_edges}")
        
        return combined
        
    except ImportError as e:
        print(f"MiDaS dependencies not available: {e}")
        return None
    except Exception as e:
        print(f"MiDaS computation failed: {e}")
        return None
    if not _try_load_midas():
        return None
    try:
        import torch
        dev = torch.device(device if device else ('cuda' if torch.cuda.is_available() else 'cpu'))
        print(f"INFO: MiDaS using device: {dev}")
        model = _midas_model.to(dev)
        
        # Convert RGB to BGR for OpenCV format (MiDaS expects this)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        
        # Apply MiDaS transform (expects numpy array in BGR format)
        input_tensor = _midas_transform(bgr).to(dev)
        
        # Ensure we have the right batch dimension
        if input_tensor.dim() == 3:
            input_tensor = input_tensor.unsqueeze(0)
        
        print(f"DEBUG: Input tensor shape: {input_tensor.shape}")
        
        with torch.no_grad():
            prediction = model(input_tensor)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=rgb.shape[:2],  # (height, width)
                mode='bicubic',
                align_corners=False
            ).squeeze()
            depth = prediction.cpu().numpy().astype(np.float32)
        
        # CRÍTICO: DEBUGGING - Guardar imágenes intermedias para análisis
        debug_dir = "/tmp/midas_debug"
        os.makedirs(debug_dir, exist_ok=True)
        
        # Guardar imagen original
        cv2.imwrite(f"{debug_dir}/01_original.png", bgr)
        
        # Guardar depth raw de MiDaS
        depth_raw_norm = (depth - depth.min()) / (depth.max() - depth.min()) if depth.max() > depth.min() else depth
        cv2.imwrite(f"{debug_dir}/02_midas_raw.png", (depth_raw_norm * 255).astype(np.uint8))
        
        # Clean any NaN or infinite values from MiDaS output
        nan_count = np.isnan(depth).sum()
        inf_count = np.isinf(depth).sum()
        
        if nan_count > 0 or inf_count > 0:
            print(f"WARNING: Found {nan_count} NaN and {inf_count} infinite values in MiDaS output")
            depth = np.where(np.isnan(depth) | np.isinf(depth), 0.0, depth)
        
        # Verificar si tenemos datos válidos
        valid_values = depth[depth > 0]
        if len(valid_values) == 0:
            print(f"ERROR: MiDaS produced no valid depth values, falling back to proxy")
            return None
        
        # MEJORADO: Combinar MiDaS con información de luminancia para mejor relieve
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        
        # Normalizar MiDaS al rango [0,1]
        dmin, dmax = float(valid_values.min()), float(valid_values.max())
        if dmax > dmin and not np.isnan(dmin) and not np.isnan(dmax):
            midas_normalized = np.where(depth > 0, (depth - dmin) / (dmax - dmin), 0.0)
            
            # NUEVO: Mezclar MiDaS con luminancia para mejor resultado en relieves
            # MiDaS da estructura 3D, luminancia da detalles de textura
            weight_midas = 0.6  # AJUSTADO: 60% MiDaS para estructura
            weight_luminance = 0.4  # AJUSTADO: 40% luminancia para más detalles
            
            # También aplicar un poco de edge enhancement
            edges = cv2.Canny((gray * 255).astype(np.uint8), 50, 150).astype(np.float32) / 255.0
            weight_edges = 0.1  # 10% para realzar bordes
            
            # Normalizar weights para que sumen 1.0
            total_weight = weight_midas + weight_luminance + weight_edges
            weight_midas /= total_weight
            weight_luminance /= total_weight
            weight_edges /= total_weight
            
            combined_depth = (weight_midas * midas_normalized + 
                            weight_luminance * gray + 
                            weight_edges * edges)
            
            print(f"DEBUG: Using improved mixing - MiDaS: {weight_midas:.2f}, Luminance: {weight_luminance:.2f}, Edges: {weight_edges:.2f}")
            
            # Usar percentiles para mayor contraste en el resultado combinado
            valid_combined = combined_depth[combined_depth > 0]
            if len(valid_combined) > 0:
                p5, p95 = np.percentile(valid_combined, [5, 95])
                print(f"DEBUG: Combined depth percentiles - p5: {p5:.6f}, p95: {p95:.6f}")
                
                # Normalizar con percentiles
                depth = np.where(combined_depth > 0, 
                               np.clip((combined_depth - p5) / (p95 - p5), 0.0, 1.0), 
                               0.0)
                
                # MEJORADO: Aplicar enhacement de contraste adaptativo
                # Usar CLAHE (Contrast Limited Adaptive Histogram Equalization)
                depth_uint8 = (depth * 255).astype(np.uint8)
                clahe_limit = 2.0 * contrast_factor  # Ajustar CLAHE según parámetro
                clahe = cv2.createCLAHE(clipLimit=clahe_limit, tileGridSize=(8,8))
                depth_enhanced = clahe.apply(depth_uint8).astype(np.float32) / 255.0
                
                # Combinar resultado original con enhanced (ajustado por contraste)
                enhancement_factor = min(0.9, 0.5 + 0.2 * contrast_factor)  # 50-90% enhanced
                depth = enhancement_factor * depth_enhanced + (1 - enhancement_factor) * depth
                
                # Aplicar curva gamma ajustada por contraste
                gamma = max(0.7, 0.95 - 0.1 * contrast_factor)  # Gamma más agresivo con más contraste
                depth = np.where(depth > 0, np.power(depth, gamma), 0.0)
                print(f"DEBUG: Applied contrast factor {contrast_factor:.2f}, CLAHE limit {clahe_limit:.1f}, enhancement {enhancement_factor:.2f}, gamma {gamma:.2f}")
                
                # Guardar resultado combinado para debug
                cv2.imwrite(f"{debug_dir}/03_combined_result.png", (depth * 255).astype(np.uint8))
                cv2.imwrite(f"{debug_dir}/04_luminance.png", (gray * 255).astype(np.uint8))
                cv2.imwrite(f"{debug_dir}/05_midas_normalized.png", (midas_normalized * 255).astype(np.uint8))
                cv2.imwrite(f"{debug_dir}/08_edges.png", (edges * 255).astype(np.uint8))
                cv2.imwrite(f"{debug_dir}/09_depth_enhanced.png", (depth_enhanced * 255).astype(np.uint8))
                cv2.imwrite(f"{debug_dir}/10_final_depth.png", (depth * 255).astype(np.uint8))
                
                print(f"DEBUG: Debug images saved to {debug_dir}")
            else:
                print(f"ERROR: No valid combined depth values")
                return None
        else:
            print(f"ERROR: Invalid depth range, falling back to proxy")
            return None
        
        print(f"INFO: MiDaS+Luminance depth processed - valid pixels: {(depth > 0).sum()}/{depth.size}")
        return depth
    except Exception as e:
        print(f"ERROR: MiDaS processing failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def read_image(path: str) -> np.ndarray:
    img = Image.open(path).convert('RGB')
    return np.array(img)


def compute_depth_proxy(rgb: np.ndarray, invert: bool = False) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    if invert:
        gray = 1.0 - gray
        
    # MEJORADO: Usar múltiples escalas para mejor detalle
    blur1 = cv2.GaussianBlur(gray, (0, 0), sigmaX=0.5)  # Blur ligero
    blur2 = cv2.GaussianBlur(gray, (0, 0), sigmaX=2.0)  # Blur fuerte
    
    # Combinar diferentes escalas de detalle
    detail_fine = gray - blur1
    detail_coarse = blur1 - blur2
    
    # Gradientes para detectar bordes
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    mag = mag / (mag.max() + 1e-6) if mag.max() > 1e-6 else mag
    
    # Combinar información
    enhanced = gray + (0.3 * detail_fine) + (0.2 * detail_coarse) + (0.1 * mag)
    enhanced = np.clip(enhanced, 0.0, 1.0)
    
    # Aplicar CLAHE también al proxy
    enhanced_uint8 = (enhanced * 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    enhanced = clahe.apply(enhanced_uint8).astype(np.float32) / 255.0
    
    # Normalización final
    mn, mx = float(enhanced.min()), float(enhanced.max())
    rng = (mx - mn) if (mx > mn) else 1.0
    depth = (enhanced - mn) / rng
    
    # Clean any NaN values that might have been introduced
    if np.isnan(depth).any():
        print(f"WARNING: Found {np.isnan(depth).sum()} NaN values in enhanced depth proxy, replacing with 0.0")
        depth = np.nan_to_num(depth, nan=0.0)
    
    print(f"DEBUG: Enhanced proxy depth generated with multi-scale detail and CLAHE")
    return depth


def choose_grid_for_target(depth_h: int, depth_w: int, target_tris: int, mask_ratio: float = 1.0) -> Tuple[int, int]:
    """Choose grid (w, h) aiming ~4*(w-1)*(h-1)*mask_ratio ≈ target_tris, preserving aspect ratio.
    Optimized for MiDaS depth maps to ensure good quality with reasonable performance."""
    ar = float(depth_h) / float(depth_w) if depth_w > 0 else 1.0
    
    # MEJORADO: Preservar más resolución para mejor calidad del modelo
    eff_target = max(100_000, int(target_tris * 0.95))  # Aumentado de 50k a 100k mínimo
    if mask_ratio > 0.05:
        eff_target = int(eff_target / max(mask_ratio, 1e-3))
    
    # MEJORADO: Permitir mayor densidad para mejor detalle, escalado según target
    max_units = 500_000 if target_tris >= 400_000 else 300_000  # Más unidades para calidad alta
    units = max(1024, min(eff_target // 4, max_units))  # Límites dinámicos
    w_minus = int(max(64, min(3072, np.sqrt(units / max(ar, 1e-6)))))  # Resolución más alta
    h_minus = int(max(64, min(3072, ar * w_minus)))  # Resolución más alta
    
    print(f"DEBUG: Grid optimization IMPROVED - target_tris: {target_tris}, effective: {eff_target}, grid: {w_minus+1}x{h_minus+1}")
    return w_minus + 1, h_minus + 1


def build_heightfield_mesh(depth: np.ndarray, width_mm: float, base_mm: float, max_height_mm: float) -> Tuple[np.ndarray, np.ndarray]:
    h, w = depth.shape[:2]
    
    # Clean NaN values in depth array preservando datos válidos
    nan_count = np.isnan(depth).sum()
    if nan_count > 0:
        print(f"WARNING: Found {nan_count} NaN values in depth array, replacing with median")
        # Usar mediana en lugar de 0 para preservar información
        valid_depth = depth[~np.isnan(depth)]
        if len(valid_depth) > 0:
            median_val = np.median(valid_depth)
            depth = np.where(np.isnan(depth), median_val, depth)
        else:
            depth = np.zeros_like(depth, dtype=np.float32)
    
    # Ensure depth is in valid range [0, 1]
    depth = np.clip(depth, 0.0, 1.0)
    
    real_w = float(width_mm)
    real_h = float(width_mm) * (h / float(w))
    xs = np.linspace(0.0, real_w, w, dtype=np.float32)
    ys = np.linspace(0.0, real_h, h, dtype=np.float32)
    
    # Ensure linspace arrays are valid
    if np.isnan(xs).any() or np.isnan(ys).any():
        print(f"ERROR: NaN values in linspace arrays!")
        xs = np.nan_to_num(xs, nan=0.0)
        ys = np.nan_to_num(ys, nan=0.0)
    
    xx, yy = np.meshgrid(xs, ys)
    
    # Check meshgrid for NaN values
    if np.isnan(xx).any() or np.isnan(yy).any():
        print(f"ERROR: NaN values in meshgrid!")
        xx = np.nan_to_num(xx, nan=0.0)
        yy = np.nan_to_num(yy, nan=0.0)
    
    z_top = float(base_mm) + depth.astype(np.float32) * float(max_height_mm)
    
    # Verify no NaN in final vertices
    if np.isnan(z_top).any():
        print(f"ERROR: NaN values in z_top after computation!")
        z_top = np.nan_to_num(z_top, nan=float(base_mm))
    
    top_vertices = np.stack([xx, yy, z_top], axis=-1).reshape(-1, 3)
    
    # Final check for NaN in top_vertices
    if np.isnan(top_vertices).any():
        print(f"ERROR: NaN values in top_vertices after stacking!")
        top_vertices = np.nan_to_num(top_vertices, nan=0.0)
    z_bottom = np.zeros_like(z_top, dtype=np.float32)
    bot_vertices = np.stack([xx, yy, z_bottom], axis=-1).reshape(-1, 3)

    def vid(x: int, y: int) -> int:
        return y * w + x

    top_tris = []
    for y in range(h - 1):
        for x in range(w - 1):
            v00 = vid(x, y)
            v10 = vid(x + 1, y)
            v01 = vid(x, y + 1)
            v11 = vid(x + 1, y + 1)
            top_tris.append([v00, v01, v10])
            top_tris.append([v10, v01, v11])

    off = top_vertices.shape[0]
    bot_tris = []
    for y in range(h - 1):
        for x in range(w - 1):
            v00 = off + vid(x, y)
            v10 = off + vid(x + 1, y)
            v01 = off + vid(x, y + 1)
            v11 = off + vid(x + 1, y + 1)
            bot_tris.append([v10, v01, v00])
            bot_tris.append([v11, v01, v10])

    sides = []
    for x in range(w - 1):
        t0 = vid(x, 0); t1 = vid(x + 1, 0)
        b0 = off + vid(x, 0); b1 = off + vid(x + 1, 0)
        sides.append([t0, b1, b0]); sides.append([t0, t1, b1])
    for x in range(w - 1):
        t0 = vid(x, h - 1); t1 = vid(x + 1, h - 1)
        b0 = off + vid(x, h - 1); b1 = off + vid(x + 1, h - 1)
        sides.append([t1, b0, b1]); sides.append([t1, t0, b0])
    for y in range(h - 1):
        t0 = vid(0, y); t1 = vid(0, y + 1)
        b0 = off + vid(0, y); b1 = off + vid(0, y + 1)
        sides.append([t1, b0, b1]); sides.append([t1, t0, b0])
    for y in range(h - 1):
        t0 = vid(w - 1, y); t1 = vid(w - 1, y + 1)
        b0 = off + vid(w - 1, y); b1 = off + vid(w - 1, y + 1)
        sides.append([t0, b1, b0]); sides.append([t0, t1, b1])

    vertices = np.vstack([top_vertices, bot_vertices]).astype(np.float32)
    triangles = np.array(top_tris + bot_tris + sides, dtype=np.int32)
    
    # Final NaN check before returning
    if np.isnan(vertices).any():
        print(f"CRITICAL ERROR: Final vertices array contains {np.isnan(vertices).sum()} NaN values!")
        vertices = np.nan_to_num(vertices, nan=0.0)
        print(f"Replaced NaN values in final vertices array")
    
    return vertices, triangles


def segment_foreground(rgb: np.ndarray) -> np.ndarray:
    """Mejorada segmentación de foreground con múltiples métodos y debug."""
    h, w = rgb.shape[:2]
    
    # Crear directorio debug si no existe
    debug_dir = "/tmp/midas_debug"
    os.makedirs(debug_dir, exist_ok=True)
    
    # Método 1: K-means mejorado
    scale = 256 / max(h, w)
    small = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else rgb.copy()
    Z = small.reshape((-1, 3)).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)  # Más iteraciones
    _, labels, centers = cv2.kmeans(Z, 2, None, criteria, 5, cv2.KMEANS_PP_CENTERS)  # Más intentos
    labels = labels.reshape((small.shape[0], small.shape[1]))
    
    # Mejorar selección de foreground usando múltiples criterios
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = gx * gx + gy * gy
    
    # Criterio 1: Energía de gradiente (textura)
    e0 = float(mag[labels == 0].sum())
    e1 = float(mag[labels == 1].sum())
    
    # Criterio 2: Distancia del centro (asumimos objeto central)
    center_y, center_x = small.shape[0] // 2, small.shape[1] // 2
    y_coords, x_coords = np.ogrid[:small.shape[0], :small.shape[1]]
    center_dist = (y_coords - center_y) ** 2 + (x_coords - center_x) ** 2
    
    d0 = float(center_dist[labels == 0].mean())
    d1 = float(center_dist[labels == 1].mean())
    
    # Criterio 3: Contraste promedio
    c0 = float(gray[labels == 0].std())
    c1 = float(gray[labels == 1].std())
    
    print(f"DEBUG: Segmentation analysis - Energy: {e0:.0f} vs {e1:.0f}, Distance: {d0:.0f} vs {d1:.0f}, Contrast: {c0:.3f} vs {c1:.3f}")
    
    # Seleccionar foreground basado en criterios combinados
    # Preferir: mayor energía de gradiente, menor distancia del centro, mayor contraste
    score0 = (e0 / (e0 + e1 + 1e-6)) + (d1 / (d0 + d1 + 1e-6)) + (c0 / (c0 + c1 + 1e-6))
    score1 = (e1 / (e0 + e1 + 1e-6)) + (d0 / (d0 + d1 + 1e-6)) + (c1 / (c0 + c1 + 1e-6))
    
    fg_label = 0 if score0 > score1 else 1
    print(f"DEBUG: Selected foreground label {fg_label} (score0: {score0:.3f}, score1: {score1:.3f})")
    
    mask_small = (labels == fg_label).astype(np.uint8)
    
    # Operaciones morfológicas mejoradas
    kernel_close = np.ones((7, 7), np.uint8)  # Kernel más grande
    kernel_open = np.ones((3, 3), np.uint8)
    
    mask_small = cv2.morphologyEx(mask_small, cv2.MORPH_CLOSE, kernel_close, iterations=2)
    mask_small = cv2.morphologyEx(mask_small, cv2.MORPH_OPEN, kernel_open, iterations=1)
    
    # Llenar huecos
    mask_small = cv2.morphologyEx(mask_small, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    
    mask = cv2.resize(mask_small, (w, h), interpolation=cv2.INTER_NEAREST) if mask_small.shape[:2] != (h, w) else mask_small
    
    # Keep largest component (más robusto)
    num_labels, labels_im = cv2.connectedComponents(mask)
    if num_labels > 1:
        sizes = [(labels_im == lbl).sum() for lbl in range(1, num_labels)]
        if sizes:  # Verificar que hay componentes
            max_lbl = 1 + int(np.argmax(sizes))
            mask = (labels_im == max_lbl).astype(np.uint8)
            print(f"DEBUG: Selected largest component {max_lbl} with {max(sizes)} pixels out of {num_labels-1} components")
    
    # Guardar mask para debug
    cv2.imwrite(f"{debug_dir}/06_mask.png", mask * 255)
    cv2.imwrite(f"{debug_dir}/07_kmeans_labels.png", labels.astype(np.uint8) * 127)
    
    print(f"DEBUG: Final mask has {mask.sum()} foreground pixels out of {mask.size} total ({100*mask.sum()/mask.size:.1f}%)")
    
    return mask


def build_full_figure(depth: np.ndarray, mask: np.ndarray, width_mm: float, max_height_mm: float,
                      front_base_mm: float = 0.0,
                      back_thickness_mm: Optional[float] = None) -> Tuple[np.ndarray, np.ndarray]:
    """Create a realistic 3D solid from 2D depth information with improved volume construction."""
    h, w = depth.shape[:2]
    
    # Clean NaN values in inputs
    if np.isnan(depth).any():
        print(f"WARNING: Found {np.isnan(depth).sum()} NaN values in depth array, replacing with 0.0")
        depth = np.nan_to_num(depth, nan=0.0)
    
    if np.isnan(mask).any():
        print(f"WARNING: Found {np.isnan(mask).sum()} NaN values in mask array, replacing with 0.0")
        mask = np.nan_to_num(mask, nan=0.0)
    
    # CRÍTICO: Mejorar la construcción del volumen 3D
    real_w = float(width_mm)
    real_h = float(width_mm) * (h / float(w))
    xs = np.linspace(0.0, real_w, w, dtype=np.float32)
    ys = np.linspace(0.0, real_h, h, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)

    m = (mask.astype(np.uint8) > 0).astype(np.float32)
    d = (depth.astype(np.float32) * m)
    
    # REVOLUCIONARIO: Aplicar múltiples transformaciones para volumen más realista
    print(f"DEBUG: Original depth range: [{d.min():.3f}, {d.max():.3f}]")
    
    # 1. Aumentar el contraste de profundidad para más variación
    if d.max() > d.min():
        d_norm = (d - d.min()) / (d.max() - d.min())
    # REVOLUCIONARIO: Escalado dinámico inteligente basado en contenido
    # Analizar la imagen para optimizar parámetros automáticamente
    
    # 1. Calcular complejidad de la imagen
    mask_coverage = np.sum(m) / m.size  # Porcentaje de objeto vs fondo
    depth_variance = np.var(d[m > 0]) if np.sum(m) > 0 else 0  # Variación de profundidad
    depth_range = d.max() - d.min()  # Rango dinámico
    
    # 2. Calcular factores de escalado dinámico
    coverage_factor = np.clip(mask_coverage * 2.0, 0.8, 1.5)  # Objetos grandes = más escalado
    complexity_factor = np.clip(depth_variance * 10 + 1.0, 1.0, 1.8)  # Más variación = más amplificación
    range_factor = np.clip(depth_range * 1.5 + 1.0, 1.0, 2.0)  # Más rango = más amplificación
    
    # 3. Factor de amplificación inteligente combinado
    base_amplification = 1.4  # Base mínima
    dynamic_amplification = base_amplification * coverage_factor * complexity_factor * range_factor
    dynamic_amplification = np.clip(dynamic_amplification, 1.2, 2.5)  # Límites razonables
    
    print(f"DEBUG: Dynamic scaling analysis:")
    print(f"  - Mask coverage: {mask_coverage:.1%} -> coverage_factor: {coverage_factor:.2f}")
    print(f"  - Depth variance: {depth_variance:.4f} -> complexity_factor: {complexity_factor:.2f}")
    print(f"  - Depth range: {depth_range:.3f} -> range_factor: {range_factor:.2f}")
    print(f"  - Final amplification: {dynamic_amplification:.2f}x")
    
    # Normalizar profundidad
    if d.max() > d.min():
        d_norm = (d - d.min()) / (d.max() - d.min())
    else:
        d_norm = d
    
    # 4. Aplicar curvas avanzadas con escalado dinámico
    # Función sigmoidea para crear transiciones más suaves y naturales
    sigmoid_strength = 6 + 2 * complexity_factor  # Más complejidad = curva más agresiva
    d_sigmoid = 1 / (1 + np.exp(-sigmoid_strength * (d_norm - 0.5)))
    
    # Curva de potencia adaptativa
    gamma = max(0.5, 0.7 - 0.1 * complexity_factor)  # Más complejidad = gamma más bajo
    d_power = np.power(d_norm, gamma)
    
    # 5. Mezcla inteligente optimizada
    sigmoid_weight = 0.5 + 0.2 * coverage_factor  # Objetos grandes favorecen sigmoidea
    power_weight = 1.0 - sigmoid_weight
    d_final = sigmoid_weight * d_sigmoid + power_weight * d_power
    
    # 6. Aplicar amplificación dinámica
    z_front = front_base_mm + d_final * float(max_height_mm) * dynamic_amplification
    
    print(f"DEBUG: Enhanced depth curves:")
    print(f"  - Sigmoid strength: {sigmoid_strength:.1f}, Gamma: {gamma:.2f}")
    print(f"  - Sigmoid weight: {sigmoid_weight:.2f}, Power weight: {power_weight:.2f}")
    print(f"DEBUG: Enhanced depth range: [{d_final.min():.3f}, {d_final.max():.3f}]")
    print(f"DEBUG: Front surface Z range: [{z_front.min():.2f}, {z_front.max():.2f}] mm")
    
    # REVOLUCIONARIO: Back surface con geometría más inteligente y escalado dinámico
    m_u8 = (m > 0.5).astype(np.uint8)
    
    # Distance transform para crear base orgánica
    dist = cv2.distanceTransform(m_u8, distanceType=cv2.DIST_L2, maskSize=5).astype(np.float32)
    if dist.max() > 0: 
        dist_norm = dist / float(dist.max())
    else:
        dist_norm = dist
    
    # Calcular grosor base con escalado dinámico
    if back_thickness_mm is None:
        # Base más generosa con escalado inteligente
        base_thickness = max(15.0, 0.35 * real_w)  # Grosor base sustancial
        back_thickness_mm = base_thickness * coverage_factor  # Objetos grandes = más grosor
    
    # MEJORADO: Back surface que responde a la profundidad frontal con escalado dinámico
    # Crear correlación entre profundidad frontal y grosor trasero
    depth_influence = d_final * (0.4 + 0.2 * complexity_factor)  # Más complejidad = más influencia
    
    # Combinar distance transform + depth influence con escalado
    base_factor = 0.25 + 0.1 * coverage_factor  # Objetos grandes = base más sólida
    dist_factor = 0.45 + 0.1 * complexity_factor  # Más complejidad = más variación
    depth_factor = 0.3 + 0.1 * range_factor  # Más rango = más influencia de profundidad
    
    back_shape = (base_factor + dist_factor * np.power(dist_norm, 0.4) + depth_factor * depth_influence)
    
    # Aplicar grosor variable más realista
    T = back_shape * float(back_thickness_mm)
    
    # Suavizado bilateral para preservar características pero suavizar
    T = cv2.bilateralFilter(T, 9, 80, 80)
    
    z_back = -T * m
    
    print(f"DEBUG: Dynamic back surface:")
    print(f"  - Base thickness: {back_thickness_mm:.1f}mm")
    print(f"  - Factors - Base: {base_factor:.2f}, Distance: {dist_factor:.2f}, Depth: {depth_factor:.2f}")
    print(f"DEBUG: Back surface Z range: [{z_back.min():.2f}, {z_back.max():.2f}] mm")
    print(f"DEBUG: Total model thickness: {z_front.max() - z_back.min():.2f} mm")
    
    # Verify no NaN in surfaces
    if np.isnan(z_front).any():
        print(f"ERROR: NaN values in z_front after computation!")
        z_front = np.nan_to_num(z_front, nan=front_base_mm)
    
    if np.isnan(z_back).any():
        print(f"ERROR: NaN values in z_back after computation!")
        z_back = np.nan_to_num(z_back, nan=0.0)

    # CRÍTICO: Construcción de vértices con mejor precisión
    front_vertices = np.stack([xx, yy, z_front], axis=-1).reshape(-1, 3)
    back_vertices = np.stack([xx, yy, z_back], axis=-1).reshape(-1, 3)
    vertices = np.vstack([front_vertices, back_vertices]).astype(np.float32)
    
    # Final verification - no NaN in output vertices
    if np.isnan(vertices).any():
        print(f"ERROR: {np.isnan(vertices).sum()} NaN values in final vertices array!")
        vertices = np.nan_to_num(vertices, nan=0.0)

    # Estadísticas del modelo generado
    total_volume = np.sum(m) * (z_front.max() - z_back.min()) * (real_w * real_h) / (w * h)
    print(f"DEBUG: Model statistics - Volume: {total_volume:.1f} mm³, Dimensions: {real_w:.1f}x{real_h:.1f} mm")

    def vf(x: int, y: int) -> int: return y * w + x
    def vb(x: int, y: int) -> int: return w * h + y * w + x

    tris: list[list[int]] = []
    # MEJORADO: Generación de triángulos más robusta
    # Decide active cells (any of four corners inside mask)
    cell_fg = (m[:h-1, :w-1] + m[1:, :w-1] + m[:h-1, 1:] + m[1:, 1:]) > 0.5
    
    # Count active cells for better statistics
    active_cells = np.sum(cell_fg)
    print(f"DEBUG: Active mesh cells: {active_cells} out of {(h-1)*(w-1)} total")
    
    # Front/back faces with better triangle generation
    for y in range(h - 1):
        for x in range(w - 1):
            if not cell_fg[y, x]:
                continue
            a = vf(x, y); b = vf(x + 1, y); c = vf(x, y + 1); d_ = vf(x + 1, y + 1)
            tris.append([a, b, d_]); tris.append([a, d_, c])
            a2 = vb(x, y); b2 = vb(x + 1, y); c2 = vb(x, y + 1); d2 = vb(x + 1, y + 1)
            tris.append([b2, a2, d2]); tris.append([d2, a2, c2])

    # Walls along silhouette (mask change across edges)
    # Horizontal edges
    for y in range(h):
        for x in range(w - 1):
            m0 = m[y, x] > 0.5; m1 = m[y, x + 1] > 0.5
            if m0 == m1: continue
            f0, f1 = vf(x, y), vf(x + 1, y)
            b0, b1 = vb(x, y), vb(x + 1, y)
            tris.append([f0, b1, b0]); tris.append([f0, f1, b1])
    # Vertical edges
    for y in range(h - 1):
        for x in range(w):
            m0 = m[y, x] > 0.5; m1 = m[y + 1, x] > 0.5
            if m0 == m1: continue
            f0, f1 = vf(x, y), vf(x, y + 1)
            b0, b1 = vb(x, y), vb(x, y + 1)
            tris.append([f1, b0, b1]); tris.append([f1, f0, b0])

    triangles = np.array(tris, dtype=np.int32)
    return vertices, triangles


def smooth_and_simplify(mesh: o3d.geometry.TriangleMesh, target_tris: int = 400_000) -> o3d.geometry.TriangleMesh:
    print(f"DEBUG: Starting smooth_and_simplify with {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
    
    # Verificar que el mesh esté en buen estado antes de procesar
    vertices = np.asarray(mesh.vertices)
    if np.isnan(vertices).any():
        print(f"ERROR: Input mesh has NaN vertices before processing!")
        return mesh
    
    mesh.compute_vertex_normals()
    
    # MEJORADO: Suavizado más conservador que preserve detalles
    try:
        print(f"DEBUG: Applying conservative Taubin smoothing...")
        # Usar muy pocas iteraciones para preservar detalles
        mesh = mesh.filter_smooth_taubin(number_of_iterations=1, lambda_filter=0.5, mu=-0.53)
        
        # Verificar después del suavizado
        vertices_after_smooth = np.asarray(mesh.vertices)
        if np.isnan(vertices_after_smooth).any():
            print(f"ERROR: Taubin smoothing introduced NaN values! Skipping smoothing.")
            mesh.vertices = o3d.utility.Vector3dVector(vertices)
        else:
            print(f"DEBUG: Conservative Taubin smoothing successful")
            
    except Exception as e:
        print(f"WARNING: Taubin smoothing failed: {e}")
        # NO usar Laplacian como fallback ya que es más destructivo
        print(f"DEBUG: Skipping smoothing to preserve geometry details")
    
    mesh.compute_vertex_normals()
    
    # MEJORADO: Simplificación más inteligente preservando características
    try:
        tri_count = int(np.asarray(mesh.triangles).shape[0])
        print(f"DEBUG: Current triangle count: {tri_count}, target: {target_tris}")
        
        if tri_count > target_tris:
            print(f"DEBUG: Applying feature-preserving quadric decimation...")
            original_vertices = np.asarray(mesh.vertices).copy()
            original_triangles = np.asarray(mesh.triangles).copy()
            
            # MEJORADO: Decimación más conservadora con preservación de características
            # Usar un target ligeramente más alto para evitar pérdida excesiva de detalles
            # Para targets altos (calidad máxima), ser menos conservador
            if target_tris >= 400_000:
                conservative_target = target_tris  # Para calidad alta, usar el target exacto
            else:
                conservative_target = max(target_tris, int(tri_count * 0.7))  # No menos del 70%
            
            mesh = mesh.simplify_quadric_decimation(
                target_number_of_triangles=conservative_target,
                maximum_error=1e-6,  # Error muy bajo para preservar forma
                boundary_weight=1.0   # Preservar bordes importantes
            )
            
            # Verificar después de la decimación
            decimated_vertices = np.asarray(mesh.vertices)
            if np.isnan(decimated_vertices).any() or len(mesh.vertices) < 3:
                print(f"ERROR: Quadric decimation failed! Reverting to original.")
                mesh.vertices = o3d.utility.Vector3dVector(original_vertices)
                mesh.triangles = o3d.utility.Vector3iVector(original_triangles)
            else:
                print(f"DEBUG: Conservative decimation successful: {len(mesh.triangles)} triangles")
                
                # Limpieza muy suave
                try:
                    mesh.remove_degenerate_triangles()
                    mesh.remove_duplicated_triangles()
                    mesh.remove_duplicated_vertices()
                    # NO usar remove_non_manifold_edges() ya que puede ser destructivo
                    
                    # Verificar después de la limpieza
                    cleaned_vertices = np.asarray(mesh.vertices)
                    if np.isnan(cleaned_vertices).any() or len(mesh.vertices) < 3:
                        print(f"ERROR: Mesh cleaning was too aggressive! Reverting.")
                        mesh.vertices = o3d.utility.Vector3dVector(original_vertices)
                        mesh.triangles = o3d.utility.Vector3iVector(original_triangles)
                except Exception as clean_e:
                    print(f"WARNING: Mesh cleaning failed: {clean_e}, keeping decimated mesh")
        
        # NO aplicar subdivisión ni otros procesos que puedan alterar la geometría
        
    except Exception as e:
        print(f"WARNING: Simplification failed: {e}")
    
    mesh.compute_vertex_normals()
    
    # Verificación final
    final_vertices = np.asarray(mesh.vertices)
    final_triangles = np.asarray(mesh.triangles)
    if np.isnan(final_vertices).any():
        print(f"ERROR: Final mesh has NaN vertices!")
    elif len(final_vertices) < 3 or len(final_triangles) < 1:
        print(f"ERROR: Final mesh is degenerate! Vertices: {len(final_vertices)}, Triangles: {len(final_triangles)}")
    else:
        print(f"DEBUG: Geometry processing completed successfully: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
        
        # Calcular estadísticas de calidad del mesh
        vertex_coords = np.asarray(mesh.vertices)
        z_range = vertex_coords[:, 2].max() - vertex_coords[:, 2].min()
        print(f"DEBUG: Mesh Z-range (height): {z_range:.2f}mm, preserving 3D volume details")
    
    return mesh


def write_mesh(mesh: o3d.geometry.TriangleMesh, out_path: str) -> None:
    # Final safety check: inspect mesh vertices before writing
    vertices = np.asarray(mesh.vertices)
    if np.isnan(vertices).any():
        nan_count = np.isnan(vertices).sum()
        print(f"EMERGENCY: Mesh has {nan_count} NaN vertices before writing! This shouldn't happen!")
        # Remove NaN vertices by replacing with zeros
        vertices = np.nan_to_num(vertices, nan=0.0)
        mesh.vertices = o3d.utility.Vector3dVector(vertices)
        print(f"Replaced NaN vertices with zeros as emergency fix")
    
    ext = os.path.splitext(out_path)[1].lower()
    if ext == '.stl':
        ok = o3d.io.write_triangle_mesh(out_path, mesh, write_ascii=False)
    elif ext == '.obj':
        ok = o3d.io.write_triangle_mesh(out_path, mesh, write_ascii=True)
    else:
        ok = o3d.io.write_triangle_mesh(out_path, mesh, write_ascii=False)
    if not ok:
        raise RuntimeError(f"Failed to write mesh to {out_path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--widthMM', type=float, default=100.0)
    ap.add_argument('--baseMM', type=float, default=1.0)
    ap.add_argument('--maxHeightMM', type=float, default=8.0)  # MEJORADO: Más altura para mejor volumen
    ap.add_argument('--format', type=str, default='stl')
    ap.add_argument('--invert', action='store_true')
    ap.add_argument('--useMiDaS', action='store_true', help='Use MiDaS depth (Torch Hub) if available')
    ap.add_argument('--device', type=str, default=None, help='torch device, e.g., cuda or cpu')
    ap.add_argument('--targetTris', type=int, default=600_000)  # MEJORADO: Más triángulos para mejor detalle
    ap.add_argument('--contrast', type=float, default=1.0, help='Contrast enhancement factor (1.0 = normal, >1.0 = more contrast)')
    args = ap.parse_args()

    # ===== LOGGING DETALLADO DE PARÁMETROS =====
    print(f"🎯 PYTHON SCRIPT - Parámetros recibidos:")
    print(f"🎯 targetTris: {args.targetTris}")
    print(f"🎯 widthMM: {args.widthMM}")
    print(f"🎯 baseMM: {args.baseMM}")  
    print(f"🎯 maxHeightMM: {args.maxHeightMM}")
    print(f"🎯 contrast: {args.contrast}")
    print(f"🎯 useMiDaS: {args.useMiDaS}")
    print(f"🎯 ==========================================")

    # Extraer el factor de contraste de los argumentos
    contrast_factor = args.contrast

    try:
        rgb = read_image(args.input)
        print(f"DEBUG: Loaded image with shape: {rgb.shape}")
        
        # Foreground segmentation to exclude background
        mask = segment_foreground(rgb)
        print(f"DEBUG: Created mask with shape: {mask.shape}, non-zero pixels: {mask.sum()}")
        
        depth = None
        if args.useMiDaS:
            print(f"DEBUG: Attempting MiDaS depth estimation...")
            depth = compute_depth_midas(rgb, device=args.device, contrast_factor=contrast_factor)
            if depth is not None:
                print(f"DEBUG: MiDaS SUCCESS - shape: {depth.shape}, min: {depth.min():.6f}, max: {depth.max():.6f}, NaN count: {np.isnan(depth).sum()}")
            else:
                print(f"DEBUG: MiDaS FAILED - falling back to proxy depth")
        
        if depth is None:
            print(f"DEBUG: Using proxy depth estimation...")
            depth = compute_depth_proxy(rgb, invert=args.invert)
            print(f"DEBUG: Proxy depth - shape: {depth.shape}, min: {depth.min():.6f}, max: {depth.max():.6f}, NaN count: {np.isnan(depth).sum()}")
        else:
            if args.invert:
                depth = 1.0 - depth
                print(f"DEBUG: Inverted depth - min: {depth.min():.6f}, max: {depth.max():.6f}, NaN count: {np.isnan(depth).sum()}")
                
        print(f"DEBUG: Input parameters - widthMM: {args.widthMM}, baseMM: {args.baseMM}, maxHeightMM: {args.maxHeightMM}")
        
        # Resize depth & mask to a grid that matches target triangles (accounting for mask coverage)
        r = float(mask.sum()) / float(mask.size) if mask.size else 1.0
        tgt_w, tgt_h = choose_grid_for_target(depth.shape[0], depth.shape[1], args.targetTris, r)
        print(f"DEBUG: Target grid size: {tgt_w}x{tgt_h}, current size: {depth.shape[1]}x{depth.shape[0]}")
        
        if (depth.shape[1], depth.shape[0]) != (tgt_w, tgt_h):
            depth = cv2.resize(depth, (tgt_w, tgt_h), interpolation=cv2.INTER_CUBIC)
            mask = cv2.resize(mask, (tgt_w, tgt_h), interpolation=cv2.INTER_NEAREST)
            
            # MEJORADO: Normalizar después del resize para evitar valores fuera de rango
            depth = np.clip(depth, 0.0, 1.0)  # Forzar rango [0,1]
            depth_min, depth_max = depth.min(), depth.max()
            if depth_max > depth_min:
                depth = (depth - depth_min) / (depth_max - depth_min)  # Re-normalizar
            
            print(f"DEBUG: Resized and normalized depth - shape: {depth.shape}, min: {depth.min():.6f}, max: {depth.max():.6f}, NaN count: {np.isnan(depth).sum()}")
            
        # Build full closed figure from single-view depth and silhouette
        verts, tris = build_full_figure(depth, mask, args.widthMM, args.maxHeightMM, front_base_mm=args.baseMM)
        
        # CRITICAL: Final NaN check before Open3D mesh creation (preserve valid data)
        nan_count = np.isnan(verts).sum()
        if nan_count > 0:
            print(f"CRITICAL: {nan_count} NaN values detected before Open3D mesh creation!")
            # Solo reemplazar NaN, mantener valores válidos
            verts = np.where(np.isnan(verts), 0.0, verts)
            print(f"Replaced {nan_count} NaN values with 0.0")
        
        # Final stats
        print(f"DEBUG: Final vertex stats - min: {verts.min():.6f}, max: {verts.max():.6f}, shape: {verts.shape}")
        
        mesh = o3d.geometry.TriangleMesh()
        mesh.vertices = o3d.utility.Vector3dVector(verts.astype(np.float64))
        mesh.triangles = o3d.utility.Vector3iVector(tris.astype(np.int32))

        mesh = smooth_and_simplify(mesh, target_tris=args.targetTris)
        write_mesh(mesh, args.output)
        print('ok: true')
        return 0
    except Exception as e:
        print(f'error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
