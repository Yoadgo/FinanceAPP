/* ================================================================
   AUTH — כניסת גוגל ובדיקת חברות במשק הבית.

   ארבעה מצבים, וכל אחד מקבל מסך משלו (ר' js/ui/gate.js):
     signed-out   — לא מחובר.
     not-member   — מחובר, אבל המזהה שלו לא ברשימת החברים. המסך מציג
                    את המזהה כדי שיועד יוכל להוסיף אותו בקונסולה.
     no-household — מסמך משק הבית עוד לא נוצר (הקמה ראשונה).
     member       — נכנס.

   למה בדיקת החברות נעשית בקריאה ולא בשדה בקוד: כללי Firestore הם
   השומר האמיתי. אם הם דוחים את הקריאה — המשתמש לא חבר, נקודה. הקוד
   כאן רק מתרגם את הדחייה למסך מובן.
   ================================================================ */
import { HOUSEHOLD_ID } from '../config.js';

let fbCache = null;
async function fbase() {
  if (!fbCache) fbCache = await import('./firebase.js');
  return fbCache;
}

export const session = {
  user: null,        // { uid, email, name, photo }
  household: null,   // { id, members: [...], names: { uid: name } }
  nameOf(uid) { return (this.household && this.household.names && this.household.names[uid]) || 'לא ידוע'; },
};

export async function watchAuth(onState) {
  const { auth, db, fb } = await fbase();
  try { await fb.getRedirectResult(auth); } catch (e) { /* חזרה מכניסה בהפניה — שגיאה תוצג בניסיון הבא */ }

  fb.onAuthStateChanged(auth, async (u) => {
    if (!u) { session.user = null; session.household = null; onState({ state: 'signed-out' }); return; }
    session.user = { uid: u.uid, email: u.email, name: u.displayName || u.email, photo: u.photoURL };
    try {
      const snap = await fb.getDoc(fb.doc(db, 'households', HOUSEHOLD_ID));
      if (!snap.exists()) { onState({ state: 'no-household', user: session.user }); return; }
      const h = snap.data();
      if (!Array.isArray(h.members) || !h.members.includes(u.uid)) {
        onState({ state: 'not-member', user: session.user });
        return;
      }
      session.household = { id: HOUSEHOLD_ID, members: h.members, names: h.names || {} };
      onState({ state: 'member', user: session.user });
    } catch (e) {
      /* permission-denied = הכללים דחו = לא חבר. כל שגיאה אחרת היא תקלה
         אמיתית (רשת, הגדרות) ומוצגת כמות שהיא — לא מתחפשת ל"אין גישה". */
      if (e && e.code === 'permission-denied') onState({ state: 'not-member', user: session.user });
      else onState({ state: 'error', user: session.user, error: e });
    }
  });
}

export async function signIn() {
  const { auth, fb } = await fbase();
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    /* ספארי באייפון חוסם לפעמים חלון קופץ — אז עוברים לכניסה בהפניה. */
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      await fb.signInWithRedirect(auth, provider);
    } else if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      throw e;
    }
  }
}

export async function signOutNow() {
  const { auth, fb } = await fbase();
  await fb.signOut(auth);
}
