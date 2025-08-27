import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-monkey-camera-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div
    class="loader"
    role="img"
    [attr.aria-label]="ariaLabel"
    [style.width.px]="size"
    [style.height.px]="size"
    [style.color]="color || null"
    [style.--dur]="duration"
  >
    <svg viewBox="0 0 128 128" style="display:block">
      <!-- Camera body -->
      <rect x="16" y="36" rx="10" ry="10" width="96" height="64" fill="currentColor" opacity="0.12"/>
      <rect x="16" y="36" rx="10" ry="10" width="96" height="64" fill="none" stroke="currentColor" stroke-width="4"/>
      <!-- Top bar -->
      <rect x="28" y="26" rx="6" ry="6" width="28" height="16" fill="currentColor" opacity="0.2"/>
      <!-- Flash -->
      <rect class="flash" x="94" y="44" rx="3" ry="3" width="14" height="10" fill="currentColor"/>
      <!-- Lens -->
      <circle cx="64" cy="68" r="22" fill="currentColor" opacity="0.08"/>
      <circle cx="64" cy="68" r="22" fill="none" stroke="currentColor" stroke-width="3" opacity="0.6"/>
      <!-- Rotating ring inside lens -->
      <circle class="ring" cx="64" cy="68" r="14" fill="none" stroke="currentColor" stroke-width="4"
              stroke-linecap="round" stroke-dasharray="44 44"/>
      <!-- Shutter blades (simple tri) spinning -->
      <g class="shutter" transform="translate(64 68)">
        <polygon points="0,-9 8,6 -8,6" fill="currentColor" opacity="0.6"/>
      </g>
    </svg>
  </div>
  `,
  styles: [`
    :host, .loader { display: inline-block; line-height: 0; }
    /* Duración por defecto si no se define */
    .loader { --dur: 1.6s; }
    /* Animations */
    .ring { transform-origin: 64px 68px; animation: spin var(--dur) linear infinite; }
    .shutter { transform-origin: 0 0; animation: spin var(--dur) linear infinite; }
    .flash { animation: blink calc(var(--dur) * 2) ease-in-out infinite; }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes blink {
      0%, 90%, 100% { opacity: 0.3; }
      92%, 96% { opacity: 1; }
    }

    /* Respeta reduce motion a nivel global */
    @media (prefers-reduced-motion: reduce) {
      .ring, .shutter, .flash { animation-duration: 0s; animation-iteration-count: 0; }
    }
  `]
})
export class MonkeyCameraLoaderComponent {
  /** Tamaño en px */
  @Input() size = 96;
  /** Multiplicador de velocidad: 1 = normal, 2 = doble de rápido */
  @Input() speed = 1;
  /** Color (opcional). Si no se define, hereda currentColor */
  @Input() color?: string;
  /** Texto accesible */
  @Input() ariaLabel = 'Cargando…';

  get duration(): string {
    const base = 1.6; // segundos
    const s = Math.max(0.25, base / (this.speed || 1));
    return `${s}s`;
  }
}
