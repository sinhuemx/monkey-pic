import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../../core/api.service';
import { firstValueFrom } from 'rxjs';

/** Parámetros de UI (signals del componente) */
export interface UiParams {
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  sampleMax?: number;

  // UI avanzados (algunos sólo influyen en preview/estimaciones)
  subdivisionLevel: 1|2|3|4;
  depthMultiplier: number;
  surfaceSmoothing: number;   // 0..1 en UI (StlService lo escala a 0..0.5)
  qualityThreshold: number;   // sólo UI, no se envía al backend

  invert: boolean;
  enhanceEdges: boolean;      // on/off → edgeSharpening 0/0.3 (lo hace StlService)
  preserveDetails: boolean;   // on/off → detailPreservation 0.2/0.6 (StlService)
  adaptiveSubdivision: boolean; // sólo UI
  compressionLevel: 0|1|2|3;    // sólo UI

  format: 'binary' | 'ascii';
}

@Injectable({ providedIn: 'root' })
export class ConversionEngineService {
  private readonly api = inject(ApiService);

  /**
   * Punto único para convertir: normaliza y delega en StlService.
   * Aquí puedes dejar reglas de negocio (clamps, defaults de UI, etc).
   */
  async convert(file: File, ui: UiParams): Promise<Blob> {
    // Normalización mínima adicional (si quieres centralizar aquí)
    const opts = {
      widthMM: Math.round(ui.widthMM),
      baseMM: ui.baseMM,
      maxHeightMM: ui.maxHeightMM,
      sampleMax: ui.sampleMax,
      invert: ui.invert,
      format: ui.format,
      // Campos avanzados que el backend actual entiende parcialmente
      depthMultiplier: ui.depthMultiplier,
      surfaceSmoothing: ui.surfaceSmoothing,
      // qualityThreshold y subdivisionLevel son sólo UI; no siempre usados por backend
    } as const;

  return await firstValueFrom(this.api.convertImage(file, opts));
  }

  async convertHQ(file: File, ui: UiParams & { format: 'binary'|'ascii' } & { hqFormat?: 'stl'|'obj'|'glb' }): Promise<Blob> {
    const format = ui.hqFormat ?? 'stl';
    return await firstValueFrom(this.api.convertImageHQ(file, {
      widthMM: Math.round(ui.widthMM),
      baseMM: ui.baseMM,
      maxHeightMM: ui.maxHeightMM,
      format
    }));
  }
}
