#!/usr/bin/env python3
import argparse
import os
import sys
import numpy as np
from PIL import Image

# Optional: import torch and MiDaS if available (not required in stub)
# import torch
# import cv2
# import open3d as o3d


def to_grayscale_depth(img: Image.Image) -> np.ndarray:
    img = img.convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    y = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    y = (y - y.min()) / (y.ptp() + 1e-6)
    return y  # 0..1


def write_ascii_stl_from_heightfield(depth: np.ndarray, width_mm: float, base_mm: float, max_h_mm: float, out_path: str):
    h, w = depth.shape
    sx = width_mm / max(w - 1, 1)
    sy = (width_mm * (h / w)) / max(h - 1, 1)
    def H(v):
        return base_mm + max_h_mm * float(v)
    lines = []
    lines.append("solid hq3d\n")
    def facet(ax, ay, az, bx, by, bz, cx, cy, cz):
        ux, uy, uz = bx-ax, by-ay, bz-az
        vx, vy, vz = cx-ax, cy-ay, cz-az
        nx = uy*vz - uz*vy
        ny = uz*vx - ux*vz
        nz = ux*vy - uy*vx
        l = (nx*nx + ny*ny + nz*nz) ** 0.5 or 1
        nx, ny, nz = nx/l, ny/l, nz/l
        lines.append(f" facet normal {nx:.6f} {ny:.6f} {nz:.6f}\n  outer loop\n")
        lines.append(f"   vertex {ax:.6f} {ay:.6f} {az:.6f}\n")
        lines.append(f"   vertex {bx:.6f} {by:.6f} {bz:.6f}\n")
        lines.append(f"   vertex {cx:.6f} {cy:.6f} {cz:.6f}\n")
        lines.append("  endloop\n endfacet\n")
    for y in range(h-1):
        for x in range(w-1):
            z00 = H(depth[y, x])
            z10 = H(depth[y, x+1])
            z01 = H(depth[y+1, x])
            z11 = H(depth[y+1, x+1])
            x0, y0 = x*sx, y*sy
            x1, y1 = (x+1)*sx, (y+1)*sy
            facet(x0, y0, z00, x1, y0, z10, x0, y1, z01)
            facet(x1, y0, z10, x1, y1, z11, x0, y1, z01)
    lines.append("endsolid hq3d\n")
    with open(out_path, 'w') as f:
        f.write(''.join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--widthMM', type=float, default=120)
    ap.add_argument('--baseMM', type=float, default=1.0)
    ap.add_argument('--maxHeightMM', type=float, default=5.0)
    ap.add_argument('--format', default='stl', choices=['stl', 'obj', 'glb'])
    args = ap.parse_args()

    img = Image.open(args.input)
    depth = to_grayscale_depth(img)

    # Stub: write STL. Extend with MiDaS + Open3D in real pipeline
    if args.format != 'stl':
        # For simplicity in stub, always produce STL; real script should branch per format
        out_path = os.path.splitext(args.output)[0] + '.stl'
    else:
        out_path = args.output
    write_ascii_stl_from_heightfield(depth, args.widthMM, args.baseMM, args.maxHeightMM, out_path)
    print('OK:', out_path)


if __name__ == '__main__':
    sys.exit(main())
