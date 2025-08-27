import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initializeApp } from 'firebase/app';
import { loadFirebaseConfig } from './firebase.config';

// Initialize Firebase only in the browser
// Load config at runtime to avoid hardcoding secrets in the bundle
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  loadFirebaseConfig().then((cfg) => {
    if (cfg) initializeApp(cfg);
  }).catch(() => {/* ignore */});
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
