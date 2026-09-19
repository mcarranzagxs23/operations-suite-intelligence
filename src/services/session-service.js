import { demoSession } from '../data/demo-data.js';
import { getFirebaseServices, isFirebaseConfigured } from './firebase.js';
import {
  normalizeMembership,
  readActiveAccountPreference,
  resolveSessionAccess,
} from './session-access.js';

function normalizeProfile(user, profile = {}, access = {}, memberships = []) {
  const displayName = profile.displayName || user.displayName || user.email || '';
  const activeMembership = access.activeMembership || null;

  return {
    id: user.uid,
    displayName,
    initials: (displayName || 'US')
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
    // A Super Administrator comes only from a Firebase Auth custom claim.
    // Every non-global role comes only from a backend-managed membership index.
    role: access.role || 'unassigned',
    globalRole: access.globalRole || null,
    activeRole: activeMembership?.role || null,
    memberships,
    activeAccountId: activeMembership?.accountId || '',
    accountId: activeMembership?.accountId || '',
    accountName: activeMembership?.accountName || '',
    language: profile.locale || 'es',
    mode: 'firebase',
  };
}

async function getUserProfile(user) {
  const { db, firestoreApi } = await getFirebaseServices();
  const [profileSnapshot, tokenResult, membershipSnapshots] = await Promise.all([
    firestoreApi.getDoc(firestoreApi.doc(db, 'users', user.uid)),
    user.getIdTokenResult(),
    firestoreApi.getDocs(firestoreApi.collection(db, 'users', user.uid, 'accountMemberships')),
  ]);
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
  const memberships = membershipSnapshots.docs
    .map((snapshot) => normalizeMembership(snapshot.id, snapshot.data()))
    .filter(Boolean);

  const access = resolveSessionAccess({
    isSuperAdmin: tokenResult.claims.super_admin === true,
    memberships,
    preferredAccountId: readActiveAccountPreference(),
  });

  return normalizeProfile(user, profile, access, memberships);
}

export function observeSession(onChange, onError = console.error) {
  if (!isFirebaseConfigured) {
    onChange(demoSession);
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  getFirebaseServices()
    .then(({ auth, authApi }) => {
      if (cancelled) return;
      unsubscribe = authApi.onAuthStateChanged(
        auth,
        async (user) => {
          if (!user) {
            onChange(null);
            return;
          }
          try {
            onChange(await getUserProfile(user));
          } catch (error) {
            onError(error);
            onChange(null);
          }
        },
        onError,
      );
    })
    .catch(onError);

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function signIn(email, password) {
  if (!isFirebaseConfigured) {
    throw new Error('firebase-not-configured');
  }

  try {
    const { auth, authApi } = await getFirebaseServices();
    const credential = await authApi.signInWithEmailAndPassword(auth, email, password);
    return getUserProfile(credential.user);
  } catch (error) {
    // Firebase provider messages can be in a browser-dependent language and
    // may reveal more detail than a public sign-in form should show. The UI
    // maps this stable code to its selected interface language.
    if (error?.message === 'firebase-not-configured') throw error;
    throw new Error('sign-in-failed');
  }
}

export async function signOutSession() {
  if (isFirebaseConfigured) {
    const { auth, authApi } = await getFirebaseServices();
    await authApi.signOut(auth);
  }
}
