/* ================================================================
   HASH — גיבוב SHA-256 בדפדפן (וב-node לבדיקות). בלי ספרייה:
   crypto.subtle מובנה בכל דפדפן מודרני.

   שני שימושים:
   · גיבוב תוכן קובץ — "אותו קובץ פעמיים = אפס שורות חדשות".
   · מזהה מסמך דטרמיניסטי — טביעת אצבע + מונה מופעים → מזהה קבוע.
     הרצה חוזרת כותבת על אותו מסמך, לא משכפלת.
   ================================================================ */
const enc = new TextEncoder();

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/* מזהה מסמך: קידומת + 20 תווי hex (80 ביט). התנגשות בין שני מסמכים
   שונים במשק בית אחד — לא מעשית. */
export async function docId(prefix, key, occ = 1) {
  return `${prefix}-${(await sha256Hex(`${key}#${occ}`)).slice(0, 20)}`;
}
