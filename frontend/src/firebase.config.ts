// Load Firebase Web App config at runtime from a static JSON file.
// Place your config in `public/firebase-config.json` (see firebase-config.json.example).
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};

export async function loadFirebaseConfig(): Promise<FirebaseWebConfig | null> {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const res = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch config: ${res.status}`);
    const cfg = await res.json();
    // Minimal validation
    if (!cfg || !cfg.apiKey || !cfg.projectId) throw new Error('invalid firebase config');
    return cfg as FirebaseWebConfig;
  } catch (e) {
    console.warn('[firebase] no runtime config found or invalid. Skipping init.', e);
    return null;
  }
}
