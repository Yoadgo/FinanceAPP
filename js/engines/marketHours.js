/* ================================================================
   MARKET HOURS — האם הבורסה בניו יורק פתוחה עכשיו. טהור.

   שעות רגילות: 9:30–16:00 שעון ניו יורק, שני–שישי. בישראל זה בדרך כלל
   16:30–23:00 (ובשבועות ששעון הקיץ לא מתואם — שעה הפרש). החישוב נעשה
   בשעון ניו יורק דרך Intl, כך שמעבר שעון בכל אחת מהמדינות לא מבלבל.

   מה לא מכוסה: חגים אמריקאיים (הבורסה סגורה, והקוד יחשוב שהיא פתוחה).
   ההשלכה קטנה — בחג המחיר פשוט לא זז, ומסומן כ"סגירה" לפי זמן העסקה.
   ================================================================ */
const NY = 'America/New_York';
let FMT = null;

/* רכיבי הזמן בניו יורק: יום בשבוע (0=ראשון), שעה, דקה */
export function nyParts(date = new Date()) {
  if (!FMT) FMT = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = {};
  FMT.formatToParts(date).forEach(x => { p[x.type] = x.value; });
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dow, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/* 'open' · 'pre' (4:00–9:30) · 'post' (16:00–20:00) · 'closed' */
export function usSession(date = new Date()) {
  const { dow, minutes } = nyParts(date);
  if (dow === 0 || dow === 6) return 'closed';
  if (minutes >= 570 && minutes < 960) return 'open';
  if (minutes >= 240 && minutes < 570) return 'pre';
  if (minutes >= 960 && minutes < 1200) return 'post';
  return 'closed';
}

export const SESSION_LABEL = { open: 'המסחר פתוח', pre: 'לפני פתיחה', post: 'אחרי סגירה', closed: 'השוק סגור' };
