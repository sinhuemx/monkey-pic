// src/app/converter/services/stl-generator.service.ts
import { Injectable } from '@angular/core';

type Mesh = { vertices: Float32Array; faces: Uint32Array };

@Injectable({ providedIn: 'root' })
export class StlGeneratorService {
  async fromMesh(
    mesh: Mesh,
    opts: { format: 'binary' | 'ascii'; units: 'mm'; watertightExpected: boolean }
  ): Promise<{ stl: ArrayBuffer; stats: { faces: number; verts: number; volumeCM3?: number } }> {
    const volumeM3 = this._estimateVolume(mesh);
    const volumeCM3 = volumeM3 * 1e6; // m³ → cm³

    if (opts.format === 'ascii') {
      const ascii = this._toAscii(mesh);
      const buf = new TextEncoder().encode(ascii).buffer;
      return { stl: buf, stats: { faces: mesh.faces.length / 3 | 0, verts: mesh.vertices.length / 3 | 0, volumeCM3 } };
    } else {
      const bin = this._toBinary(mesh);
      return { stl: bin, stats: { faces: mesh.faces.length / 3 | 0, verts: mesh.vertices.length / 3 | 0, volumeCM3 } };
    }
  }

  private _toAscii(mesh: Mesh): string {
    const { vertices: v, faces: f } = mesh;
    let out = 'solid model\n';
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const n = this._normal(v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
      out += `facet normal ${n[0]} ${n[1]} ${n[2]}\nouter loop\n`;
      out += `vertex ${v[a]} ${v[a + 1]} ${v[a + 2]}\n`;
      out += `vertex ${v[b]} ${v[b + 1]} ${v[b + 2]}\n`;
      out += `vertex ${v[c]} ${v[c + 1]} ${v[c + 2]}\n`;
      out += `endloop\nendfacet\n`;
    }
    out += 'endsolid model\n';
    return out;
  }

  private _toBinary(mesh: Mesh): ArrayBuffer {
    const { vertices: v, faces: f } = mesh;
    const faceCount = (f.length / 3) | 0;
    const buffer = new ArrayBuffer(84 + faceCount * 50);
    const dv = new DataView(buffer);
    // header (80 bytes) + face count (4 bytes)
    for (let i = 0; i < 80; i++) dv.setUint8(i, 0);
    dv.setUint32(80, faceCount, true);
    let o = 84;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const n = this._normal(v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
      dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true); o += 12;
      dv.setFloat32(o, v[a], true); dv.setFloat32(o + 4, v[a + 1], true); dv.setFloat32(o + 8, v[a + 2], true); o += 12;
      dv.setFloat32(o, v[b], true); dv.setFloat32(o + 4, v[b + 1], true); dv.setFloat32(o + 8, v[b + 2], true); o += 12;
      dv.setFloat32(o, v[c], true); dv.setFloat32(o + 4, v[c + 1], true); dv.setFloat32(o + 8, v[c + 2], true); o += 12;
      dv.setUint16(o, 0, true); o += 2; // attribute byte count
    }
    return buffer;
  }

  private _normal(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): [number, number, number] {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    return [nx, ny, nz];
  }

  private _estimateVolume(mesh: Mesh): number {
    const v = mesh.vertices, f = mesh.faces;
    let vol = 0;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const v0 = [v[a], v[a + 1], v[a + 2]], v1 = [v[b], v[b + 1], v[b + 2]], v2 = [v[c], v[c + 1], v[c + 2]];
      vol += (v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) - v0[1] * (v1[0] * v2[2] - v1[2] * v2[0]) + v0[2] * (v1[0] * v2[1] - v1[1] * v2[0])) / 6;
    }
    return Math.abs(vol);
  }
}
