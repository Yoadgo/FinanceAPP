/* ================================================================
   CONFIG — ההגדרות היחידות שמשתנות בין סביבות.

   ⚠️ מפתח ה-Firebase כאן הוא **ציבורי מטבעו** ומותר בריפו ציבורי.
   הוא מזהה את הפרויקט, לא מעניק גישה. מה שמגן על הנתונים הוא:
     1. כללי Firestore (firestore.rules) — רק חבר במשק הבית קורא וכותב.
     2. רשימת הדומיינים המורשים ב-Firebase Auth.
   סוד אמיתי (מפתח API בתשלום, סיסמה) — לעולם לא כאן.

   מה ממלאים (שלב 1, יחד עם יועד):
     Firebase console → Project settings → General → Your apps → Web app
     → "SDK setup and configuration" → Config. מעתיקים את ששת השדות.
   ================================================================ */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCB_CePikSed92j22Dx56hf6isiig3lNhA',
  authDomain: 'financeapp-fff57.firebaseapp.com',
  projectId: 'financeapp-fff57',
  storageBucket: 'financeapp-fff57.firebasestorage.app',
  messagingSenderId: '1087395997143',
  appId: '1:1087395997143:web:0b496244e6a78062189792',
};

/* משק בית אחד (אפיון: "משתמשים ומשק הבית"). כל האוספים יושבים תחתיו. */
export const HOUSEHOLD_ID = 'main';

/* גיליון המחירים "FinanceAPP — מחירים" (נוסחאות GOOGLEFINANCE), מפורסם לאינטרנט כ-CSV.
   נבנה ופורסם ב-29.9.2026. מכיל מחירי שוק ציבוריים בלבד — אין בו שום נתון אישי.
   נבדק: נגיש מדפדפן מכל אתר (CORS), 1MB להיסטוריה המלאה, 1.3KB לשורות המחיר בלבד. */
export const PRICES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTeeVqldRo9zjBKCnO70WmQVoqKRVbqMVEr92z08j6gcJ5CEtAsMvRz10QT2BbWWlU7pwwylTWA44NH/pub?output=csv';

/* מדד ברירת המחדל לאלפא — הוחלט 29.9.2026. */
export const BENCHMARK = 'IVV';

export const isConfigured = () => Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
