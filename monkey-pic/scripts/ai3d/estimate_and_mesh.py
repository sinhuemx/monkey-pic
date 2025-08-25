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
        _midas_model = torch.hub.load('intel-isl/MiDaS', 'DPT_Small')
        _midas_model.eval()
        transforms = torch.hub.load('intel-isl/MiDaS', 'transforms')
        _midas_transform = transforms.small_transform
        return True
    except Exception:
        _midas_model = None
        _midas_transform = None
        return False


def compute_depth_midas(rgb: np.ndarray, device: Optional[str] = None) -> Optional[np.ndarray]:
    if not _try_load_midas():
        return None
    try:
        import torch
        dev = torch.device(device if device else ('cuda' if torch.cuda.is_available() else 'cpu'))
        model = _midas_model.to(dev)
        img = Image.fromarray(rgb)
        input_batch = _midas_transform(img).to(dev)
        with torch.no_grad():
            prediction = model(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=img.size[::-1],
                mode='bicubic',
                align_corners=False
            ).squeeze()
            depth = prediction.cpu().numpy().astype(np.float32)
        dmin, dmax = float(depth.min()), float(depth.max())
        if dmax > dmin:
            depth = (depth - dmin) / (dmax - dmin)
        else:
            depth = np.zeros_like(depth, dtype=np.float32)
        return depth
    except Exception:
        return None


def read_image(path: str) -> np.ndarray:
    img = Image.open(path).convert('RGB')
    return np.array(img)


def compute_depth_proxy(rgb: np.ndarray, invert: bool = False) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    if invert:
        gray = 1.0 - gray
    blur = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.0)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    mag = mag / (mag.max() + 1e-6) if mag.max() > 1e-6 else mag
    high = gray - blur
    sharpen = gray + (0.35 * high * (0.5 + 0.5 * mag))
    sharpen = np.clip(sharpen, 0.0, 1.0)
    smooth = cv2.bilateralFilter(sharpen, d=5, sigmaColor=0.1, sigmaSpace=3)
    mn, mx = float(smooth.min()), float(smooth.max())
    rng = (mx - mn) if (mx > mn) else 1.0
    depth = (smooth - mn) / rng
    return depth


def build_heightfield_mesh(depth: np.ndarray, width_mm: float, base_mm: float, max_height_mm: float) -> Tuple[np.ndarray, np.ndarray]:
    h, w = depth.shape[:2]
    real_w = float(width_mm)
    real_h = float(width_mm) * (h / float(w))
    xs = np.linspace(0.0, real_w, w, dtype=np.float32)
    ys = np.linspace(0.0, real_h, h, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)
    z_top = float(base_mm) + depth.astype(np.float32) * float(max_height_mm)
    top_vertices = np.stack([xx, yy, z_top], axis=-1).reshape(-1, 3)
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
    return vertices, triangles


def smooth_and_simplify(mesh: o3d.geometry.TriangleMesh, target_tris: int = 300_000) -> o3d.geometry.TriangleMesh:
    mesh.compute_vertex_normals()
    try:
        mesh = mesh.filter_smooth_laplacian(number_of_iterations=5)
    except Exception:
        pass
    mesh.compute_vertex_normals()
    try:
        if np.asarray(mesh.triangles).shape[0] > target_tris:
            mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=target_tris)
            mesh.remove_degenerate_triangles()
            mesh.remove_duplicated_triangles()
            mesh.remove_duplicated_vertices()
            mesh.remove_non_manifold_edges()
    except Exception:
        pass
    mesh.compute_vertex_normals()
    return mesh


def write_mesh(mesh: o3d.geometry.TriangleMesh, out_path: str) -> None:
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
    ap.add_argument('--maxHeightMM', type=float, default=5.0)
    ap.add_argument('--format', type=str, default='stl')
    ap.add_argument('--invert', action='store_true')
    ap.add_argument('--useMiDaS', action='store_true', help='Use MiDaS depth (Torch Hub) if available')
    ap.add_argument('--device', type=str, default=None, help='torch device, e.g., cuda or cpu')
    ap.add_argument('--targetTris', type=int, default=300_000)
    args = ap.parse_args()

    try:
        rgb = read_image(args.input)
        depth = None
        if args.useMiDaS:
            depth = compute_depth_midas(rgb, device=args.device)
        if depth is None:
            depth = compute_depth_proxy(rgb, invert=args.invert)
        else:
            if args.invert:
                depth = 1.0 - depth

        verts, tris = build_heightfield_mesh(depth, args.widthMM, args.baseMM, args.maxHeightMM)
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
