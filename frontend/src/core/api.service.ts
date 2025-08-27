import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { getAuth } from 'firebase/auth';
import { getApps } from 'firebase/app';
import { from, Observable } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  convertImage(
    file: File,
    options?: { widthMM?: number; baseMM?: number; maxHeightMM?: number; invert?: boolean; sampleMax?: number; format?: 'ascii' | 'binary' }
  ): Observable<Blob> {
    const form = new FormData();
    form.append('file', file);
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
    if (options?.invert != null) form.append('invert', String(options.invert));
  if (options?.sampleMax != null) form.append('sampleMax', String(options.sampleMax));
  if (options?.format) form.append('format', options.format);

  const hasFirebase = getApps().length > 0;
  const auth = hasFirebase ? getAuth() : null;
  return from(auth?.currentUser?.getIdToken?.() ?? Promise.resolve('')).pipe(
      switchMap(token => {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  return this.http.post(`${this.base}/convert`, form, { responseType: 'blob', headers });
      })
    );
  }

  convertImageHQ(
    file: File,
    options?: { widthMM?: number; baseMM?: number; maxHeightMM?: number; format?: 'stl'|'obj'|'glb', invert?: boolean, targetTris?: number }
  ): Observable<Blob> {
    const form = new FormData();
    form.append('file', file);
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
  if (options?.format) form.append('format', options.format);
  if (options?.targetTris != null) form.append('targetTris', String(options.targetTris));
  if (options?.invert != null) form.append('invert', String(options.invert));

  const hasFirebase = getApps().length > 0;
  const auth = hasFirebase ? getAuth() : null;
  return from(auth?.currentUser?.getIdToken?.() ?? Promise.resolve('')).pipe(
      switchMap(token => {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
        return this.http.post(`${this.base}/hq`, form, { responseType: 'blob', headers });
      })
    );
  }

  // NUEVO: Método específico para modelos 3D completos (devuelve JSON)
  convertTo3DModelJSON(
    file: File,
    options?: { 
      widthMM?: number; 
      baseMM?: number; 
      maxHeightMM?: number; 
      targetFaces?: number;
      depthMultiplier?: number;
      surfaceSmoothing?: number;
      qualityThreshold?: number;
      smoothingKernel?: number;
      subdivisionLevel?: number;
      invert?: boolean;
      manifold?: boolean;
    }
  ): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
    if (options?.targetFaces != null) form.append('targetFaces', String(options.targetFaces));
    if (options?.depthMultiplier != null) form.append('depthMultiplier', String(options.depthMultiplier));
    if (options?.surfaceSmoothing != null) form.append('surfaceSmoothing', String(options.surfaceSmoothing));
    if (options?.qualityThreshold != null) form.append('qualityThreshold', String(options.qualityThreshold));
    if (options?.smoothingKernel != null) form.append('smoothingKernel', String(options.smoothingKernel));
    if (options?.subdivisionLevel != null) form.append('subdivisionLevel', String(options.subdivisionLevel));
    if (options?.invert != null) form.append('invert', String(options.invert));
    if (options?.manifold != null) form.append('manifold', String(options.manifold));

    const hasFirebase = getApps().length > 0;
    const auth = hasFirebase ? getAuth() : null;
    return from(auth?.currentUser?.getIdToken?.() ?? Promise.resolve('')).pipe(
      switchMap(token => {
        const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
        return this.http.post(`${this.base}/model3d`, form, { headers });
      })
    );
  }

  // NUEVO: Método específico para modelos 3D completos
  convertTo3DModel(
    file: File,
    options?: { 
      widthMM?: number; 
      baseMM?: number; 
      maxHeightMM?: number; 
      targetFaces?: number;
      depthMultiplier?: number;
      surfaceSmoothing?: number;
      qualityThreshold?: number;
      smoothingKernel?: number;
      subdivisionLevel?: number;
      invert?: boolean;
      manifold?: boolean;
    }
  ): Observable<Blob> {
    // Para obtener el blob, convertimos el OBJ del JSON a blob
    return this.convertTo3DModelJSON(file, options).pipe(
      map((response: any) => {
        if (response.obj) {
          return new Blob([response.obj], { type: 'text/plain' });
        } else {
          throw new Error('No OBJ content in response');
        }
      })
    );
  }

  // Same as convertImageHQ but returns the full response to inspect headers (e.g., X-HQ-Fallback)
  convertImageHQResponse(
    file: File,
    options?: { widthMM?: number; baseMM?: number; maxHeightMM?: number; format?: 'stl'|'obj'|'glb', invert?: boolean, targetTris?: number }
  ): Observable<HttpResponse<Blob>> {
    const form = new FormData();
    form.append('file', file);
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
  if (options?.format) form.append('format', options.format);
  if (options?.targetTris != null) form.append('targetTris', String(options.targetTris));
    if (options?.invert != null) form.append('invert', String(options.invert));

  const hasFirebase = getApps().length > 0;
  const auth = hasFirebase ? getAuth() : null;
  return from(auth?.currentUser?.getIdToken?.() ?? Promise.resolve('')).pipe(
      switchMap(token => {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
        return this.http.post(`${this.base}/hq`, form, { responseType: 'blob', headers, observe: 'response' });
      })
    );
  }

  // NUEVO: Método específico para descargar STL de modelos 3D
  downloadSTLFrom3DModel(
    file: File,
    options?: { 
      widthMM?: number; 
      baseMM?: number; 
      maxHeightMM?: number; 
      targetFaces?: number;
      depthMultiplier?: number;
      surfaceSmoothing?: number;
      qualityThreshold?: number;
      smoothingKernel?: number;
      subdivisionLevel?: number;
      invert?: boolean;
      manifold?: boolean;
    }
  ): Observable<Blob> {
    const form = new FormData();
    form.append('file', file);
    form.append('format', 'stl'); // Solicitar formato STL
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
    if (options?.targetFaces != null) form.append('targetFaces', String(options.targetFaces));
    if (options?.depthMultiplier != null) form.append('depthMultiplier', String(options.depthMultiplier));
    if (options?.surfaceSmoothing != null) form.append('surfaceSmoothing', String(options.surfaceSmoothing));
    if (options?.qualityThreshold != null) form.append('qualityThreshold', String(options.qualityThreshold));
    if (options?.smoothingKernel != null) form.append('smoothingKernel', String(options.smoothingKernel));
    if (options?.subdivisionLevel != null) form.append('subdivisionLevel', String(options.subdivisionLevel));
    if (options?.invert != null) form.append('invert', String(options.invert));
    if (options?.manifold != null) form.append('manifold', String(options.manifold));

    const hasFirebase = getApps().length > 0;
    const auth = hasFirebase ? getAuth() : null;
    return from(auth?.currentUser?.getIdToken?.() ?? Promise.resolve('')).pipe(
      switchMap(token => {
        const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
        return this.http.post(`${this.base}/model3d`, form, { responseType: 'blob', headers });
      })
    );
  }
}
