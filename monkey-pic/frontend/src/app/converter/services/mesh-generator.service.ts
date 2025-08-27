import { Injectable } from '@angular/core';

type HeightmapMesh = {
  vertices: Float32Array; // xyz
  faces: Uint32Array;     // triples
};

@Injectable({ providedIn: 'root' })
export class MeshGeneratorService {
  // Convierte heightmap NxN a malla con base
  async heightmapToMesh(heightmap: Float32Array, opts: {
    widthMM: number; baseMM: number; maxHeightMM: number;
    subdivision: number; depthMultiplier: number; surfaceSmoothing: number;
  }): Promise<HeightmapMesh> {
    const N = Math.sqrt(heightmap.length) | 0;
    const W = opts.widthMM / 1000; // mm → m para la escena interna
    const H = opts.maxHeightMM / 1000;
    const half = W / 2;

    const verts: number[] = [];
    const faces: number[] = [];

    // plano con elevación
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / (N - 1);
        const v = y / (N - 1);
        const z = heightmap[y*N + x] * H * opts.depthMultiplier;
        const px = (u - 0.5) * W;
        const py = (v - 0.5) * (W * (N / N)); // cuadrado
        verts.push(px, py, z + opts.baseMM / 1000);
      }
    }
    // indices
    for (let y = 0; y < N - 1; y++) {
      for (let x = 0; x < N - 1; x++) {
        const i = y * N + x;
        const i0 = i, i1 = i + 1, i2 = i + N, i3 = i + N + 1;
        faces.push(i0, i2, i1,  i1, i2, i3);
      }
    }

    // base rectangular (simple)
    const baseZ = 0;
    const bi = verts.length / 3;
    verts.push(
      -half, -half, baseZ,
       half, -half, baseZ,
      -half,  half, baseZ,
       half,  half, baseZ
    );
    // caras laterales y tapa inferior (simplificadas)
    faces.push(
      // tapa inferior (dos triángulos)
      bi+0, bi+2, bi+1,  bi+1, bi+2, bi+3
    );

    return {
      vertices: new Float32Array(verts),
      faces: new Uint32Array(faces),
    };
  }
}
