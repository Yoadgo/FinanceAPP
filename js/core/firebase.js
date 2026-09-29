/* ================================================================
   FIREBASE — הקובץ היחיד שמייבא את ה-SDK של גוגל.
   כל שאר הקוד מייבא מכאן. כך החלפת גרסה היא שינוי של שורה אחת
   (SDK_VERSION), ואין שתי גרסאות שונות רצות במקביל בשקט.

   ה-SDK נטען ישירות מה-CDN של גוגל כמודול ES — בלי npm ובלי בנייה.
   גרסה 12.19.0 — האחרונה נכון ל-29.9.2026 (הערות השחרור הרשמיות).
   ================================================================ */
import { FIREBASE_CONFIG } from '../config.js';

const SDK_VERSION = '12.19.0';
const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

const appMod  = await import(`${base}/firebase-app.js`);
const authMod = await import(`${base}/firebase-auth.js`);
const fsMod   = await import(`${base}/firebase-firestore.js`);

export const app = appMod.initializeApp(FIREBASE_CONFIG);
export const auth = authMod.getAuth(app);

/* מטמון מקומי מתמיד (IndexedDB). בפתיחה הבאה הדפדפן קורא מהעותק שלו
   ומושך מהשרת רק את מה שהשתנה — זה מה שהופך את הפתיחה למיידית ושומר
   על תקציב 50,000 הקריאות ביום. multiTab = שתי לשוניות פתוחות לא
   יריבו על המטמון.                                                   */
export const db = fsMod.initializeFirestore(app, {
  localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
});

export const fb = {
  // auth
  GoogleAuthProvider: authMod.GoogleAuthProvider,
  signInWithPopup: authMod.signInWithPopup,
  signInWithRedirect: authMod.signInWithRedirect,
  getRedirectResult: authMod.getRedirectResult,
  onAuthStateChanged: authMod.onAuthStateChanged,
  signOut: authMod.signOut,
  // firestore
  doc: fsMod.doc,
  collection: fsMod.collection,
  getDoc: fsMod.getDoc,
  getDocs: fsMod.getDocs,
  getDocsFromCache: fsMod.getDocsFromCache,
  setDoc: fsMod.setDoc,
  updateDoc: fsMod.updateDoc,
  writeBatch: fsMod.writeBatch,
  query: fsMod.query,
  where: fsMod.where,
  orderBy: fsMod.orderBy,
  limit: fsMod.limit,
  onSnapshot: fsMod.onSnapshot,
  getCountFromServer: fsMod.getCountFromServer,
  serverTimestamp: fsMod.serverTimestamp,
};
