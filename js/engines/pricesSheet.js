/* ================================================================
   PRICES SHEET — פענוח גיליון המחירים המפורסם (CSV). טהור.

   הגיליון "FinanceAPP — מחירים" נבנה ב-29.9.2026 בלי Apps Script:
   נוסחאות GOOGLEFINANCE בלבד, מפורסם לאינטרנט כ-CSV. לכל נייר זוג
   עמודות:
     שורה 1: SYM            | SYM
     שורה 2: price          | =GOOGLEFINANCE(SYM,"price")
     שורה 3: changepct      | =GOOGLEFINANCE(SYM,"changepct")
     שורה 4: Date           | Close          ← כותרת ההיסטוריה
     שורה 5+: תאריך         | סגירה          ← היסטוריה יומית מ-2022
   הזוג האחרון הוא USDILS (שער דולר–שקל, אותו מבנה).

   מלכודת: פורמט התאריך תלוי בהגדרות האזור של הגיליון (יום/חודש או
   חודש/יום). לא מנחשים — מזהים מהנתונים: ב-1,185 ימים תמיד יש יום
   מעל 12 באחת העמדות, וזה מכריע.
   ================================================================ */

/* 'D/M/YYYY HH:MM:SS' או 'M/D/YYYY ...' → 'YYYY-MM-DD', לפי סדר שזוהה. */
function toIso(s, dayFirst) {
  const m = String(s || '').trim().match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const d = dayFirst ? a : b, mo = dayFirst ? b : a;
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : '';
}

/* מזהה אם התאריכים הם יום-קודם. null = לא ניתן להכריע (אז עוצרים). */
export function detectDayFirst(samples) {
  let first = false, second = false;
  samples.forEach(s => {
    const m = String(s || '').trim().match(/^(\d{1,2})[\/.](\d{1,2})[\/.]\d{4}/);
    if (!m) return;
    if (Number(m[1]) > 12) first = true;
    if (Number(m[2]) > 12) second = true;
  });
  if (first && !second) return true;
  if (second && !first) return false;
  return null;
}

const num = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : null; };

/* rows = parseCsv(text). מחזיר { latest, fx, history, problems }. */
export function parsePricesSheet(rows) {
  const problems = [];
  const head = rows[0] || [];
  const pairs = [];
  for (let c = 0; c + 1 < head.length; c += 2) {
    const sym = String(head[c] || '').trim().toUpperCase();
    if (sym) pairs.push({ sym, c });
  }
  if (!pairs.length) return { latest: {}, fx: {}, history: {}, problems: ['שורת הסימולים ריקה — זה לא גיליון המחירים'] };

  const dateSamples = [];
  for (let r = 4; r < rows.length; r++) pairs.forEach(p => { const v = rows[r][p.c]; if (v) dateSamples.push(v); });
  const dayFirst = detectDayFirst(dateSamples);
  if (dateSamples.length && dayFirst === null) problems.push('לא ניתן לזהות את סדר התאריכים (יום/חודש) — ההיסטוריה לא נקראה');

  const latest = {}, fx = {}, history = {};
  pairs.forEach(({ sym, c }) => {
    const price = num(rows[1] && rows[1][c + 1]);
    const change = num(rows[2] && rows[2][c + 1]);
    if (sym === 'USDILS') { if (price) fx.USDILS = { rate: price }; }
    else if (price && price > 0) latest[sym] = { price, changePct: change };
    else problems.push(`אין מחיר ל-${sym} (GOOGLEFINANCE החזיר שגיאה)`);

    if (dayFirst === null) return;
    const h = [];
    for (let r = 4; r < rows.length; r++) {
      const d = toIso(rows[r][c], dayFirst), v = num(rows[r][c + 1]);
      if (d && v && v > 0) h.push([d, v]);
    }
    if (h.length) history[sym] = h;
  });
  return { latest, fx, history, dayFirst, problems };
}
