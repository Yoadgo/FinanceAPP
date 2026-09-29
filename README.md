# FinanceAPP

ניהול כספי משק הבית של יועד ודרי: תיקי השקעות, הוצאות ועו"ש, חסכונות ופנסיה.
אתר סטטי (HTML, CSS, JavaScript טהורים) שמתארח ב-GitHub Pages ושומר נתונים ב-Firebase.

גרסה 4 — בנייה מחדש, התחילה ב-29.9.2026. האפיון המלא: ארטיפקט "אפיון FinanceAPP v4".

## איך זה בנוי

```
index.html              השלד. טוען CSS ואת js/app.js — וזהו.
css/                    tokens (צבעים, גופנים) · base · layout · components
js/app.js               כניסה, שלד, ניתוב
js/config.js            הגדרות Firebase וכתובת המחירים — הקובץ היחיד שמשתנה בין סביבות
js/core/                firebase · auth · store (גישה לנתונים) · routes · format · market (גיליון המחירים)
js/ui/                  רכיבים משותפים: dom · components · composition ("ממה מורכב המספר") · toast · gate · charts
js/engines/             חישוב טהור, בלי מסך ובלי רשת — נבדק ב-node
js/ingest/              קריאת CSV וקבצי אקסל בדפדפן
js/screens/             קובץ לכל מסך: home · invest/ · spend/ · save/ · ingest/
firestore.rules         כללי האבטחה (מודבקים בקונסולה)
tests/                  node tests/run.mjs
```

שלושה מנועים הועברו מגרסה 3 **בלי שינוי בלוגיקה**, ובדיקה מוודאת את זה בכל ריצה
(טביעת SHA-256 של המקור): FIFO (`fifo.js`), מפענח האשראי (`creditParser.js`),
מפענח העו"ש (`bankParser.js`). גם המסווג של תנועות ההשקעה (`classifier.js`).

## מחירים

הגיליון "FinanceAPP — מחירים" בדרייב של יועד: נוסחאות GOOGLEFINANCE ל-34 ניירות ולדולר–שקל —
מחיר, שינוי יומי, והיסטוריה יומית מ-2022. מפורסם לאינטרנט כ-CSV (מחירי שוק בלבד), והכתובת
ב-`js/config.js` (`PRICES_URL`). אין Apps Script. נייר חדש = להוסיף זוג עמודות בגיליון באותו מבנה.

## גרפים

TradingView Lightweight Charts 5.2.1 מ-jsDelivr (אושר 29.9.2026) לסדרות זמן; ספארקליין ופס חלוקה — SVG/HTML שלנו.
הלוגו הקטן של TradingView בפינת הגרף הוא הייחוס שהרישיון דורש.

## הקמה — שלב 1 (פעם אחת)

### 1. ריפו
המלצה: לשנות את שם הריפו הישן ל-`FinanceAPP-v3` (Settings → General → Repository name)
ולפתוח ריפו חדש בשם `FinanceAPP`. כך הכתובת `yoadgo.github.io/FinanceAPP` נשארת.
ב-GitHub Desktop: File → Add local repository → התיקייה של הריפו החדש.
Settings → Pages → Source: `main` / root.

### 2. פרויקט Firebase (בחשבון yoad9852@gmail.com)
1. console.firebase.google.com → Add project → שם: `financeapp` → בלי Google Analytics.
2. Build → **Authentication** → Get started → Sign-in method → **Google** → Enable → Save.
3. Authentication → Settings → **Authorized domains** → Add domain → `yoadgo.github.io`.
4. Build → **Firestore Database** → Create database → **Production mode** →
   מיקום: הקרוב ביותר שמופיע ברשימה (אי אפשר לשנות אחר כך).
5. Firestore → **Rules** → להדביק את כל `firestore.rules` → **Publish**.
6. Project settings (גלגל שיניים) → General → Your apps → **Web** (`</>`) → כינוי `web` →
   בלי Hosting → Register. להעתיק את ששת שדות ה-`firebaseConfig` אל `js/config.js`.
7. קומיט ופוש.

### 3. משק הבית
1. לפתוח את האתר ולהיכנס עם גוגל. יופיע "משק הבית עוד לא הוקם" עם **המזהה** שלך.
2. Firestore → Data → Start collection → `households` → Document ID: `main` →
   שדה `members` מסוג **array** עם המזהה (string), ושדה `names` מסוג **map**: המזהה → `יועד`.
3. רענון — נכנסת.
4. דרי נכנסת פעם אחת, מקבלת "החשבון עוד לא במשק הבית" עם המזהה שלה → מוסיפים אותו ל-`members`
   ול-`names`.

## בדיקות

```
node tests/run.mjs
```

בלי התקנה. `package.json` קיים רק כדי ש-node יטען את הקבצים כמודולים.
בדיקות הקליטה רצות על קבצי בנק אמיתיים מ-`tests/private/` — **התיקייה ב-.gitignore**
(הריפו ציבורי), ובלעדיה הבדיקות מדלגות ואומרות את זה.

## פריסה

כל פוש ל-`main` מתפרסם ל-GitHub Pages. בכל שינוי ב-CSS או JS מעלים את `?v=` ב-`index.html`.
שינוי ב-`firestore.rules` **לא** נכנס לתוקף בפוש — מדביקים בקונסולה ולוחצים Publish.
