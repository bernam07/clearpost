import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { Parcel } from '../types/parcel';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export function observeAuth(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<User | null> {
  if (!auth) return null;
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export function subscribeUserParcels(
  uid: string,
  onData: (parcels: Parcel[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!db) return () => {};
  const q = query(collection(db, 'users', uid, 'parcels'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Parcel[] = snapshot.docs.map((d) => ({
        ...(d.data() as Omit<Parcel, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => onError?.(err),
  );
}

export async function saveUserParcel(uid: string, parcel: Parcel): Promise<void> {
  if (!db) return;
  const { id, ...payload } = parcel;
  await setDoc(doc(db, 'users', uid, 'parcels', id), payload, { merge: true });
}

export async function removeUserParcel(uid: string, parcelId: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'users', uid, 'parcels', parcelId));
}
