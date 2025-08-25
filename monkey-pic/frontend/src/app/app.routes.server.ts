import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
  // Use streaming SSR in dev to avoid prerender-time browser API usage
  renderMode: RenderMode.Server
  }
];
