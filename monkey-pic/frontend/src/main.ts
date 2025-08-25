import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initializeApp } from 'firebase/app';
import { firebaseConfig } from './firebase.config';

// Initialize Firebase only in the browser
try {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initializeApp(firebaseConfig);
  }
} catch {
  // ignore if not available
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
