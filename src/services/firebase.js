/**
 * Public Firebase web configuration is read only from Vite environment values.
 * A missing configuration deliberately leaves the app in local demo mode.
 * Never put a service-account key, device secret or workstation identifier in
 * this bundle or in an .env file committed to source control.
 */
export const firebaseEnvironment = Object.freeze({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
});

export const FUNCTIONS_REGION = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1';

const EMULATOR_PROJECT_PREFIX = 'demo-';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORTS = Object.freeze({ auth: 9099, firestore: 8080, functions: 5001 });
const useFirebaseEmulators = import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true';

export const isFirebaseConfigured = Boolean(
  firebaseEnvironment.apiKey &&
    firebaseEnvironment.authDomain &&
    firebaseEnvironment.projectId &&
    firebaseEnvironment.appId,
);

/**
 * Emulator mode is deliberately allowed only for a disposable `demo-*`
 * project ID. This prevents the local development command from sharing an
 * identity namespace with the configured Firebase project by accident.
 */
export const isFirebaseEmulatorMode = useFirebaseEmulators
  && firebaseEnvironment.projectId.startsWith(EMULATOR_PROJECT_PREFIX);

/**
 * App Check is required by the callable backend outside the emulator. The site
 * key is public by design; the attestation it produces is what the backend
 * verifies, and it is never a substitute for authentication.
 */
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '';

let servicesPromise = null;

/**
 * Firebase is deliberately loaded only for a configured deployment. This keeps
 * the demo experience light and prevents a missing project configuration from
 * becoming a runtime error. The SDK is code-split by Vite.
 */
export async function getFirebaseServices() {
  if (!isFirebaseConfigured) return null;

  if (useFirebaseEmulators && !isFirebaseEmulatorMode) {
    throw new Error('firebase-emulator-project-invalid');
  }

  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/functions'),
    ]).then(async ([appApi, authApi, firestoreApi, functionsApi]) => {
      const app = appApi.getApps().length
        ? appApi.getApp()
        : appApi.initializeApp(firebaseEnvironment);
      const auth = authApi.getAuth(app);
      const db = firestoreApi.getFirestore(app);
      const functions = functionsApi.getFunctions(app, FUNCTIONS_REGION);

      if (isFirebaseEmulatorMode) {
        authApi.connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
        firestoreApi.connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
        functionsApi.connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
      } else if (appCheckSiteKey) {
        // App Check is activated only for a real deployment. Attempting it
        // against the emulator would fail attestation and block every
        // administrative call for no security benefit, since the emulator has
        // no production data to protect.
        const appCheckApi = await import('firebase/app-check');
        appCheckApi.initializeAppCheck(app, {
          provider: new appCheckApi.ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      }

      return Object.freeze({
        app,
        auth,
        db,
        functions,
        authApi,
        firestoreApi,
        functionsApi,
      });
    });
  }

  return servicesPromise;
}
