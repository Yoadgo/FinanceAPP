/* ===== NAVIGATION CONFIG ===== */

const NAV_STRUCTURE = [
  {
    section: "ראשי",
    items: [
      {
        id: "dashboard",
        label: "לוח בקרה",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`
      }
    ]
  },
  {
    section: "השקעות וחסכונות",
    items: [
      {
        id: "portfolio",
        label: "תיקי השקעות",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`
      },
      {
        id: "savings",
        label: "חסכונות",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 3-1.5-.9-3.3-1-5-1s-3.5.1-5 1c-.2-1.6-1.5-3-3-3-1.1 0-2 .9-2 2 0 1.5 1.4 2.8 3 3 .1 1.7 1.1 3.2 2.6 4.1C6.2 16.6 6 18.2 6 20h2c0-1.1 1.4-2 3-2h2c1.6 0 3 .9 3 2h2c0-1.8-.2-3.4-.6-4.9 1.5-.9 2.5-2.4 2.6-4.1 1.6-.2 3-1.5 3-3 0-1.1-.9-2-2-2z"/></svg>`
      },
      {
        id: "performance",
        label: "ביצועים",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
      },
      {
        id: "research",
        label: "תחקור",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`
      },
      {
        id: "journal",
        label: "יומן תנועות",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`
      }
    ]
  },
  {
    section: "ניהול תזרים",
    items: [
      {
        id: "cashflow",
        label: "הכנסות והוצאות",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`
      }
    ]
  }
];

/* ── Page metadata (used in topbar) ── */
const PAGE_TITLES = {
  dashboard:  { title: "לוח בקרה",         section: "ראשי" },
  portfolio:  { title: "תיקי השקעות",       section: "השקעות וחסכונות" },
  savings:    { title: "חסכונות",           section: "השקעות וחסכונות" },
  performance:{ title: "ביצועים",           section: "השקעות וחסכונות" },
  research:   { title: "תחקור",             section: "השקעות וחסכונות" },
  journal:    { title: "יומן תנועות",        section: "השקעות וחסכונות" },
  cashflow:   { title: "הכנסות והוצאות",   section: "ניהול תזרים" },
};
