import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Model3DOptions {
  scale?: number;      // Escala general del modelo (1.0 = normal)
  detail?: number;     // Nivel de detalle (1.0 = normal, 2.0 = alto detalle)
  volume?: number;     // Factor de volumen (1.0 = normal, 2.0 = más volumétrico)
  invert?: boolean;    // Invertir profundidad
}

export interface Model3DResponse {
  obj?: string;
  message?: string;
  error?: string;
  debug?: {
    stdout?: string;
    stderr?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class Model3DService {
  private baseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  /**
   * Genera un modelo 3D completo usando parámetros semánticos independientes del relieve
   */
  generateModel3D(imageFile: File, options: Model3DOptions = {}): Observable<Model3DResponse> {
    const formData = new FormData();
    formData.append('image', imageFile);
    
    // Parámetros semánticos para modelos 3D
    formData.append('scale', (options.scale ?? 1.0).toString());
    formData.append('detail', (options.detail ?? 1.0).toString());
    formData.append('volume', (options.volume ?? 1.0).toString());
    formData.append('invert', (options.invert ?? false).toString());

    console.log('Model3D parameters:', {
      scale: options.scale ?? 1.0,
      detail: options.detail ?? 1.0,
      volume: options.volume ?? 1.0,
      invert: options.invert ?? false
    });

    return this.http.post<Model3DResponse>(`${this.baseUrl}/model3d`, formData);
  }
}
