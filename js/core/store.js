/* ================================================================
   STORE — שכבת הנתונים. אף מסך לא פונה ל-Firestore בעצמו.

   שלושה כללים שהשכבה הזו אוכפת:
   1. כל כתיבה נושאת מי ומתי (createdBy/At, updatedBy/At). זה היומן
      שמאפשר לשאול "מי סיווג את שופרסל כמזון ומתי".
   2. אין מחיקה. "מחיקה" היא voided: true — השורה נעלמת מהתצוגה
      ונשארת במסד. כללי Firestore דוחים delete בכל מקרה.
   3. כתיבה מרוכזת נחתכת למנות של 400 (הגבול של Firestore הוא 500
      פעולות לאצווה; משאירים מרווח).
   ================================================================ */
import { HOUSEHOLD_ID } from '../config.js';
import { session } from './auth.js';

let fbCache = null;
async function fbase() {
  if (!fbCache) fbCache = await import('./firebase.js');
  return fbCache;
}

const BATCH = 400;

function stamp(data, isNew) {
  const { fb } = fbCache;
  const uid = session.user ? session.user.uid : null;
  const out = { ...data, updatedBy: uid, updatedAt: fb.serverTimestamp() };
  if (isNew) { out.createdBy = uid; out.createdAt = fb.serverTimestamp(); }
  return out;
}

function colRef(db, fb, name) { return fb.collection(db, 'households', HOUSEHOLD_ID, name); }
function docRef(db, fb, name, id) { return fb.doc(db, 'households', HOUSEHOLD_ID, name, id); }

/* קריאת אוסף שלם. voided מסונן כאן — במקום אחד — ולא בכל מסך. */
export async function list(name, { includeVoided = false } = {}) {
  const { db, fb } = await fbase();
  const snap = await fb.getDocs(colRef(db, fb, name));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return includeVoided ? rows : rows.filter(r => !r.voided);
}

/* ספירה בלי למשוך את המסמכים: שאילתת צבירה עולה קריאה אחת לכל 1,000
   מסמכים. where = [שדה, אופרטור, ערך] אופציונלי. */
export async function count(name, where) {
  const { db, fb } = await fbase();
  const ref = where ? fb.query(colRef(db, fb, name), fb.where(...where)) : colRef(db, fb, name);
  const snap = await fb.getCountFromServer(ref);
  return snap.data().count;
}

/* שאילתה פשוטה לפי שדה אחד (למשל כל השורות של קליטה מסוימת). */
export async function listWhere(name, field, op, value) {
  const { db, fb } = await fbase();
  const snap = await fb.getDocs(fb.query(colRef(db, fb, name), fb.where(field, op, value)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function get(name, id) {
  const { db, fb } = await fbase();
  const snap = await fb.getDoc(docRef(db, fb, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* יצירה או החלפה של מסמך במזהה ידוע. merge=false כברירת מחדל: מה שנכתב
   הוא המסמך כולו, כדי ששדה ישן לא ישרוד בשקט. */
export async function put(name, id, data, { isNew = true } = {}) {
  const { db, fb } = await fbase();
  await fb.setDoc(docRef(db, fb, name, id), stamp(data, isNew));
}

export async function patch(name, id, fields) {
  const { db, fb } = await fbase();
  await fb.updateDoc(docRef(db, fb, name, id), stamp(fields, false));
}

export async function voidDoc(name, id) {
  const uid = session.user ? session.user.uid : null;
  await patch(name, id, { voided: true, voidedBy: uid, voidedAt: new Date().toISOString() });
}

/* כתיבה מרוכזת. items = [{ id, data }]. מזהה דטרמיניסטי (טביעת אצבע)
   הופך הרצה חוזרת לבטוחה: אותו מסמך נכתב על עצמו, לא משוכפל.
   onProgress(done, total) — למסך הקליטה/המיגרציה.                    */
export async function putMany(name, items, { onProgress } = {}) {
  const { db, fb } = await fbase();
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const b = fb.writeBatch(db);
    items.slice(i, i + BATCH).forEach(it => b.set(docRef(db, fb, name, it.id), stamp(it.data, true)));
    await b.commit();
    done = Math.min(items.length, i + BATCH);
    if (onProgress) onProgress(done, items.length);
  }
  return done;
}

/* עדכון מרוכז של שדות בלבד (לא החלפת מסמך) — למשל סימון ביטול על כל
   השורות של קליטה. createdBy/At המקוריים נשמרים. */
export async function patchMany(name, items, { onProgress } = {}) {
  const { db, fb } = await fbase();
  for (let i = 0; i < items.length; i += BATCH) {
    const b = fb.writeBatch(db);
    items.slice(i, i + BATCH).forEach(it => b.update(docRef(db, fb, name, it.id), stamp(it.fields, false)));
    await b.commit();
    if (onProgress) onProgress(Math.min(items.length, i + BATCH), items.length);
  }
}
