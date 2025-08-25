import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { getAuth } from 'firebase/auth';
import { from, Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

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

    const auth = getAuth();
    return from(auth.currentUser?.getIdToken() ?? Promise.resolve('')).pipe(
      switchMap(token => {
        const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`
        });
  return this.http.post(`${this.base}/convert`, form, { responseType: 'blob', headers });
      })
    );
  }

  convertImageHQ(
    file: File,
    options?: { widthMM?: number; baseMM?: number; maxHeightMM?: number; format?: 'stl'|'obj'|'glb', invert?: boolean }
  ): Observable<Blob> {
    const form = new FormData();
    form.append('file', file);
    if (options?.widthMM != null) form.append('widthMM', String(options.widthMM));
    if (options?.baseMM != null) form.append('baseMM', String(options.baseMM));
    if (options?.maxHeightMM != null) form.append('maxHeightMM', String(options.maxHeightMM));
  if (options?.format) form.append('format', options.format);
  if (options?.invert != null) form.append('invert', String(options.invert));

    const auth = getAuth();
    return from(auth.currentUser?.getIdToken() ?? Promise.resolve('')).pipe(
      switchMap(token => {
        const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
        return this.http.post(`${this.base}/convert-hq`, form, { responseType: 'blob', headers });
      })
    );
  }
}
