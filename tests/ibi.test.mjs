/* קליטת ייצוא איביאי — ובעיקר: מניעת כפילויות.
   חלק א' סינתטי (רץ תמיד). חלק ב' על הקובץ האמיתי data 11.xlsx מול
   הגיליון הישן (tests/private — לא בריפו). */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { privateJson } from './private.mjs';
import { round, matchKey, parseIbiSheet, planIbi, isIbiSheet, ibiImportRecord } from '../js/engines/ibiImport.js';
import { analyzeTransactions } from '../js/engines/migration.js';
import { txnKey, toEngineRow } from '../js/engines/model.js';
import { Classifier } from '../js/engines/classifier.js';
import { PortfolioEngine } from '../js/engines/fifo.js';
import { docId } from '../js/engines/hash.js';

const HDR = ['תאריך', 'סוג פעולה', 'שם נייר', "מס' נייר / סימבול", 'כמות', 'שער ביצוע', 'מטבע', 'עמלת פעולה', 'עמלות נלוות', 'תמורה במט"ח', 'תמורה בשקלים', 'יתרה שקלית', 'אומדן מס רווחי הון', ''];
const buy = (d, sym, q, px, fx, tax = 0) => [d, 'קניה חול מטח', `${sym}     US`, sym, q, px, '$ ', 6, 0, fx, 0, -100, tax, ''];
const grid = rows => [HDR, ...rows, Array(14).fill('')];
const H = s => s.padEnd(64, '0');
const db = (rows, portfolio, n = 0) => parseIbiSheet(grid(rows)).rows.map((d, i) => ({ ...d, portfolio, id: `old-${portfolio}-${n + i}`, name: d.name, price: round(d.price, 2) }));
const merge = (existing, plan) => {
  const byId = Object.fromEntries(existing.map(d => [d.id, { ...d }]));
  plan.add.forEach(a => { byId[a.id] = { ...a.data, id: a.id }; });
  plan.updates.forEach(u => Object.assign(byId[u.id], u.fields));
  return Object.values(byId);
};

section('איביאי — עיגול ומפתח מנורמל');
eq(round(244.305, 2), 244.31, 'חצי מתעגל למעלה גם כשהייצוג הבינארי 244.30499…');
eq(round(-2.345, 2), -2.35, 'סימטרי בשלילי');
ok(Object.is(round(-0.001, 2), 0), 'בלי ‎-0');
{
  const [raw] = parseIbiSheet(grid([buy('05/01/2026', 'AMZN', 15, 317.9356, -3670.64)])).rows;
  const sheetLike = { ...raw, name: 'AMZN US', price: 317.94 };
  eq(matchKey({ ...raw, portfolio: 'x' }), matchKey({ ...sheetLike, portfolio: 'x' }), 'שורה גולמית ושורה מהגיליון הישן (רווחים כווצו, שער עוגל) → אותו מפתח');
  eq(raw.currency, '$', 'מטבע בלי הרווח הנגרר');
  eq(raw.date, '2026-01-05', 'תאריך DD/MM/YYYY → ISO');
}

section('איביאי — פענוח');
{
  const g = grid([['29/09/2026', 'משיכה', 'מס לשלם', 9993983, 700.48, 100, '₪ ', 0, 0, 0, 0, -28859.81, 0, '']]);
  ok(isIbiSheet(g), 'מזהה קובץ איביאי לפי 13 הכותרות (גם עם עמודה ריקה נוספת)');
  const p = parseIbiSheet(g);
  eq(p.rows.length, 1, 'שורה ריקה בסוף מדולגת');
  eq(p.rows[0].symbol, '9993983', 'סימבול מספרי → מחרוזת');
  eq(p.rows[0].amountIls, 700.48, 'מגן מס: הסכום עובר ל-amountIls');
  eq(p.rows[0].qty, 0, 'ו-qty הוא 0');
  const bad = parseIbiSheet(grid([buy('05/01/2026', 'AMZN', 'abc', 10, -100)]));
  eq(bad.problems.length, 1, 'כמות לא מספרית → בעיה, לא 0 שקט');
  ok(!isIbiSheet([['כרטיס: 1234']]), 'קובץ אשראי לא מזוהה כאיביאי');
}

section('איביאי — שש שכבות מניעת הכפילויות (סינתטי)');
{
  const Y = 'איביאי-יועד', D = 'איביאי-דר';
  const file = [
    buy('03/01/2026', 'AMZN', 10, 200.004, -2006),
    buy('02/01/2026', 'ZS', 5, 190, -956),
    buy('02/01/2026', 'ZS', 5, 190, -956),            // שתי קניות זהות באותו יום — שתיים אמיתיות
    buy('01/01/2026', 'IBIT', 30, 54.93, -1653.89, 12.5),
  ];
  const existing = [
    ...db([buy('02/01/2026', 'ZS', 5, 190, -956), buy('01/01/2026', 'IBIT', 30, 54.93, -1653.89, 10)], Y),
    ...db([buy('01/01/2026', 'NVDA', 1, 100, -106)], D),
  ];
  const ctx = { fileName: 'data 1.xlsx', hash: H('a'), existing, importedHashes: new Set() };

  const np = await planIbi(grid(file), ctx);
  eq(np.status, 'needs-portfolio', 'בלי תיק → עוצר ומבקש בחירה');
  eq(np.suggested, Y, 'מציע את התיק שהשורות שלו תואמות');

  const pl = await planIbi(grid(file), { ...ctx, portfolio: Y });
  eq(pl.status, 'ok', 'תוכנית תקינה');
  eq(pl.matched, 2, 'שתי שורות קיימות זוהו');
  eq(pl.add.length, 2, 'חדשות: AMZN + הקנייה השנייה של ZS (ספירה, לא "קיים/לא קיים")');
  eq(pl.updates.length, 1, 'אומדן המס של IBIT השתנה → עדכון, לא שורה חדשה');
  eq(pl.updates[0].fields.estimatedTax, 12.5, 'הערך החדש מהקובץ');

  const again = await planIbi(grid(file), { ...ctx, portfolio: Y });
  eq(JSON.stringify(again.add.map(a => a.id)), JSON.stringify(pl.add.map(a => a.id)), 'שכבה 4: אותו קובץ → אותם מזהים (לחיצה כפולה כותבת על עצמה)');

  const after = merge(existing, pl);
  const re = await planIbi(grid(file), { ...ctx, hash: H('b'), portfolio: Y, existing: after });
  eq(re.add.length, 0, 'שכבות 2–3: קליטה חוזרת אחרי כתיבה → 0 חדשות');
  eq(re.updates.length, 0, 'ו-0 עדכונים');
  const rev = await planIbi(grid([...file].reverse()), { ...ctx, hash: H('c'), portfolio: Y, existing: after });
  eq(rev.add.length, 0, 'סדר שורות הפוך → עדיין 0 חדשות');

  const dup = await planIbi(grid(file), { ...ctx, portfolio: Y, existing: after, importedHashes: new Set([H('a')]) });
  eq(dup.status, 'duplicate-file', 'שכבה 1: אותו קובץ בדיוק, והמסד תואם → נדחה');
  const dup2 = await planIbi(grid(file), { ...ctx, portfolio: Y, importedHashes: new Set([H('a')]) });
  ok(dup2.status === 'ok' && dup2.add.length === 2 && dup2.warnings.length === 1, 'אותו קובץ אבל המסד השתנה מאז → רק מה שחסר, עם הסבר');

  const wrong = await planIbi(grid(file), { ...ctx, portfolio: D });
  eq(wrong.status, 'wrong-portfolio', 'שכבה 5: תיק שגוי → נעצר');

  const voided = existing.map(d => (d.symbol === 'ZS' ? { ...d, voided: true } : d));
  const pv = await planIbi(grid(file), { ...ctx, portfolio: Y, existing: voided });
  eq(pv.matchedVoided, 1, 'שורה שבוטלה נספרת כקיימת');
  eq(pv.add.filter(a => a.data.symbol === 'ZS').length, 1, 'ולא חוזרת בשקט — נוספת רק הקנייה השנייה');

  const extra = [...existing, ...db([buy('02/01/2026', 'ORCL', 5, 205, -1030)], Y, 50)];
  const pg = await planIbi(grid(file), { ...ctx, portfolio: Y, existing: extra });
  eq(pg.gaps.length, 1, 'שורה במסד שלא בקובץ → ברשימת הפערים, לא נמחקת');

  /* שכבה 6: הקובץ מכוסה עד 03/01; שורה חדשה ב-02/01 חשודה */
  const covered = [...existing, ...db([buy('05/01/2026', 'AMZN', 1, 1, -7)], Y, 60)];
  const pi = await planIbi(grid(file), { ...ctx, portfolio: Y, existing: covered });
  eq(pi.attention.length, 2, 'חדשות בתוך תקופה מכוסה → דורשות אישור');
  const many = Array.from({ length: 8 }, (_, i) => buy('02/01/2026', `S${i}`, 1, 10, -10));
  const pr = await planIbi(grid([...file, ...many]), { ...ctx, portfolio: Y, existing: covered });
  eq(pr.status, 'rejected', 'יותר מדי כאלה → הקובץ נדחה כולו');
  eq(pr.add.length, 0, 'ואין מה לכתוב');

  /* ── ממצאי הביקורת (30.9) ── */
  /* 1. ביטול קליטה ישנה לא מוחק לתמיד שורה שגם קובץ חדש יותר מכיל */
  {
    const A = await planIbi(grid([buy('05/01/2026', 'ZS', 5, 190, -956)]), { ...ctx, hash: H('e'), portfolio: Y, now: 1 });
    let st = merge(existing, A);
    const B = await planIbi(grid([buy('05/01/2026', 'ZS', 5, 190, -956), buy('06/01/2026', 'MU', 1, 90, -96)]), { ...ctx, hash: H('f'), portfolio: Y, existing: st, now: 2 });
    st = merge(st, B);
    const imports = [{ id: A.importId, hash: H('e'), kind: 'ibi', status: 'ok', voided: true, portfolio: Y, range: A.range },
                     { id: B.importId, hash: H('f'), kind: 'ibi', status: 'ok', portfolio: Y, range: B.range }];
    st = st.map(d => (d.source && d.source.importId === A.importId ? { ...d, voided: true } : d));      // ביטול A ביומן
    const again = await planIbi(grid([buy('05/01/2026', 'ZS', 5, 190, -956), buy('06/01/2026', 'MU', 1, 90, -96)]), { ...ctx, hash: H('f'), portfolio: Y, existing: st, imports, importedHashes: undefined, now: 3 });
    eq(again.status, 'ok', 'אחרי ביטול A — הקובץ B (שכבר נקלט) לא נחסם כ"כפול"');
    eq(again.add.length, 1, 'שורת ZS חוזרת');
    eq(again.revived, 1, 'באותו מזהה בדיוק (חוזרת לחיים, לא משוכפלת)');
    ok(again.importId !== B.importId, 'מזהה קליטה חדש — רשומת היומן הקודמת לא נדרסת');
    const byHand = st.map(d => (d.symbol === 'MU' ? { ...d, voided: true } : d));
    const h2 = await planIbi(grid([buy('06/01/2026', 'MU', 1, 90, -96)]), { ...ctx, hash: H('g'), portfolio: Y, existing: byHand, imports, importedHashes: undefined });
    eq(h2.add.length, 0, 'שורה שיועד ביטל בעצמו — לא חוזרת');
  }
  /* 2. שתי קניות זהות עם יתרות שונות — הזיווג יציב, אין "החלפה" בכל קליטה */
  {
    const pair = [[...buy('07/01/2026', 'ZS', 5, 190, -956), ], [...buy('07/01/2026', 'ZS', 5, 190, -956)]];
    pair[0][11] = -500; pair[1][11] = -1456;
    const P1 = await planIbi(grid(pair), { ...ctx, hash: H('h'), portfolio: Y });
    const st = merge(existing, P1);
    const P2 = await planIbi(grid([...pair].reverse()), { ...ctx, hash: H('i'), portfolio: Y, existing: st });
    ok(P2.add.length === 0 && P2.updates.length === 0, 'קליטה חוזרת (גם בסדר הפוך) → 0 עדכונים');
  }
  /* 3. קובץ ישן יותר לא מחזיר אומדן מס לאחור */
  {
    const newer = await planIbi(grid([buy('01/01/2026', 'IBIT', 30, 54.93, -1653.89, 50), buy('08/01/2026', 'MU', 1, 90, -96)]), { ...ctx, hash: H('j'), portfolio: Y });
    const st = merge(existing, newer);
    const imports = [{ id: newer.importId, hash: H('j'), kind: 'ibi', status: 'ok', portfolio: Y, range: newer.range }];
    const older = await planIbi(grid([buy('01/01/2026', 'IBIT', 30, 54.93, -1653.89, 12.5)]), { ...ctx, hash: H('k'), portfolio: Y, existing: st, imports, importedHashes: undefined });
    ok(older.updates.length === 0 && older.staleUpdates.length === 1, 'קובץ ישן → ההבדל מוצג, לא נכתב');
  }
  /* 5. יום שנקלט חלקית, ומילוי היסטוריה ישנה — לא נדחים */
  {
    const partial = [...existing, ...db([buy('09/01/2026', 'ZS', 1, 190, -196)], Y, 70)];
    const full = Array.from({ length: 5 }, (_, i) => buy('09/01/2026', 'ZS', 1, 190, -196 - i));
    full[0] = buy('09/01/2026', 'ZS', 1, 190, -196);
    const pf = await planIbi(grid(full), { ...ctx, hash: H('l'), portfolio: Y, existing: partial });
    ok(pf.status === 'ok' && pf.add.length === 4, 'השלמת היום האחרון שנקלט חלקית → 4 חדשות, לא דחייה');
    ok(pf.attention.length === 4 && pf.attention.every(a => a.edge), 'אבל עדיין דורשות אישור');
    const old = Array.from({ length: 10 }, (_, i) => buy(`0${(i % 9) + 1}/06/2021`, 'QQQ', 1, 300, -300 - i));
    const po = await planIbi(grid(old), { ...ctx, hash: H('m'), portfolio: Y });
    ok(po.status === 'ok' && po.add.length === 10 && po.attention.length === 0, 'היסטוריה מלפני תחילת הנתונים → לא "חשודה"');
  }
  /* 6. שורה עם שתי סיבות מופיעה פעם אחת */
  {
    const covered2 = [...existing, ...db([buy('05/01/2026', 'AMZN', 1, 1, -7)], Y, 80)];
    const odd = [...buy('04/01/2026', 'XX', 1, 1, -1)]; odd[1] = 'סוג לא מוכר';
    const pa = await planIbi(grid([odd]), { ...ctx, hash: H('n'), portfolio: Y, existing: covered2 });
    ok(pa.attention.length === 1 && pa.attention[0].kinds.length === 2, 'שורה אחת, שתי סיבות');
  }
  /* תיק חדש שעוד אין בו כלום */
  {
    const pn = await planIbi(grid([buy('05/01/2026', 'ZS', 5, 190, -956)]), { ...ctx, hash: H('o'), portfolio: 'איביאי-חדש', existing: [] });
    ok(pn.status === 'ok' && pn.add.length === 1, 'מסד ריק / תיק חדש → נקלט');
  }

  const rec = ibiImportRecord(pl);
  ok(rec.kind === 'ibi' && rec.portfolio === Y && rec.added === 2 && rec.updated === 1, 'רשומת יומן: סוג, תיק, נוספו, עודכנו');
  ok(pl.add.every(a => a.data.source.importId === pl.importId && a.data.source.kind === 'ibi'), 'כל שורה חדשה מסומנת במזהה הקליטה (לביטול)');
}

/* ─────────────── חלק ב' — הקובץ האמיתי ─────────────── */
const fx = privateJson('ibi/ibi-yoad-data11.json');
const csvPath = new URL('./private/stocksdata/Transactions.csv', import.meta.url);
if (!fx || !existsSync(csvPath)) info('tests/private/ibi או Transactions.csv חסרים — מדלג על הבדיקה מול הקובץ האמיתי');
else {
  section('איביאי — data 11.xlsx מול המסד (הגיליון הישן כפי שנכתב במיגרציה)');
  const mig = analyzeTransactions(readFileSync(csvPath, 'utf8'));
  const existing = await Promise.all(mig.items.map(async it => ({ ...it.doc, id: await docId('t', it.key, it.occ) })));
  const base = { fileName: fx.fileName, hash: H('d11'), existing, importedHashes: new Set() };

  const naive = new Set(existing.map(d => txnKey(d)));
  const raw = parseIbiSheet(fx.values).rows.map(d => ({ ...d, portfolio: 'איביאי-יועד' }));
  const naiveHits = raw.filter(d => naive.has(txnKey(d))).length;
  info(`השוואה "תו בתו" (מפתח המיגרציה) הייתה מזהה רק ${naiveHits} מ-622 — השאר היו נכתבים פעמיים`);
  ok(naiveHits < 622, 'הבעיה אמיתית: בלי נרמול היו כפילויות');

  const np = await planIbi(fx.values, base);
  eq(np.parsed, 643, '643 שורות בקובץ');
  eq(np.range.from + '→' + np.range.to, '2026-01-01→2026-09-29', 'טווח התאריכים');
  eq(np.suggested, 'איביאי-יועד', 'זוהה כתיק של יועד');
  const byP = Object.fromEntries(np.portfolioCheck.map(c => [c.portfolio, c]));
  eq(byP['איביאי-יועד'].matched, 622, '622 שורות תואמות ביועד');
  eq(byP['איביאי-יועד'].existingInRange, 622, 'מתוך 622 שבמסד באותה תקופה — כולן');
  eq(byP['איביאי-דר'].matched, 0, '0 תואמות בדר');

  const pl = await planIbi(fx.values, { ...base, portfolio: 'איביאי-יועד' });
  eq(pl.status, 'ok', 'תוכנית תקינה');
  eq(pl.matched, 622, '622 קיימות — ידולגו');
  eq(pl.add.length, 21, '21 חדשות (18/09–29/09)');
  ok(pl.add.every(a => a.data.date >= '2026-09-18'), 'כל החדשות אחרי סוף הנתונים הקיימים');
  eq(pl.gaps.length, 0, 'אין שורה במסד שחסרה בקובץ');
  /* ממצא אמיתי (30.9): בגיליון הישן חסרות 3 שורות בתוך התקופה שהוא
     מכסה. שכבה 6 מסמנת בדיוק אותן לאישור. (הפרטים לא כאן — הריפו ציבורי.) */
  eq(pl.attention.length, 3, '3 שורות חדשות בתוך התקופה המכוסה — דורשות אישור');
  ok(pl.attention.every(a => a.kinds.join() === 'inside'), 'אין להן שורה דומה במסד — חסרות, לא כפולות');
  eq(pl.differs.length, 0, 'עמלות ומטבע זהים בכל 622 הזוגות');
  info(`עדכונים: ${pl.updates.length} (אומדן מס ${pl.updates.filter(u => 'estimatedTax' in u.fields).length} · יתרה ${pl.updates.filter(u => 'cashBalanceIls' in u.fields).length})`);
  eq(pl.updates.filter(u => 'estimatedTax' in u.fields).length, 10, '10 אומדני מס שהברוקר עדכן בדיעבד');

  const wrong = await planIbi(fx.values, { ...base, portfolio: 'איביאי-דר' });
  eq(wrong.status, 'wrong-portfolio', 'בחירת דר → נעצר');

  const after = merge(existing, pl);
  const re = await planIbi(fx.values, { ...base, hash: H('d12'), portfolio: 'איביאי-יועד', existing: after });
  eq(re.add.length, 0, 'אחרי כתיבה: קליטה חוזרת → 0 חדשות');
  eq(re.updates.length, 0, 'ו-0 עדכונים');
  eq(re.matched, 643, 'כל 643 מזוהות');

  /* המנוע אחרי הקליטה: אין פוזיציה שלילית (מכירה של יותר ממה שמוחזק
     = סימן לשורה חסרה או כפולה). */
  const pos = PortfolioEngine.computePositions(Classifier.enrichAll(after.filter(d => !d.voided).map(toEngineRow)));
  const neg = pos.filter(p => p.qty < -1e-9);
  eq(neg.length, 0, 'אחרי הקליטה אין אף פוזיציה בכמות שלילית');

  const [hdr, ...body] = fx.values;
  const rev = await planIbi([hdr, ...body.reverse()], { ...base, hash: H('d13'), portfolio: 'איביאי-יועד' });
  eq(JSON.stringify(rev.add.map(a => a.id).sort()), JSON.stringify(pl.add.map(a => a.id).sort()), 'סדר הפוך → אותם 21 מזהים');

  /* ייצוא עתידי חופף: חצי מהקובץ הזה + שורות חדשות → רק החדשות */
  const half = [hdr, ...fx.values.slice(1, 200)];            // נחתך באמצע יום
  const ph = await planIbi(half, { ...base, hash: H('d14'), portfolio: 'איביאי-יועד', existing: after });
  eq(ph.add.length, 0, 'ייצוא חלקי חופף → 0 חדשות');
  eq(ph.gaps.length, 0, 'אין פערים "אמיתיים"');
  ok(ph.edgeGaps.length > 0 && ph.edgeGaps.every(g => g.date === ph.range.from), 'השורות של היום שנחתך — בנפרד, בלי הצעה לבטל');
}
