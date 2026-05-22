/* ===== FINANCEAPP — Main Controller ===== */

const App = (() => {

  /* State */
  let currentPage = "dashboard";
  let sidebarCollapsed = false;
  let mobileSidebarOpen = false;
  let dataStatus = "idle"; // idle | loading | live | error
  let _lastErrorMsg = null;
  let _progressTimer = null;

  /* ---- INIT ---- */
  function init() {
    renderSidebar();
    renderTopbar();
    renderContent(currentPage);
    bindGlobalEvents();
  }

  /* ---- SIDEBAR ---- */
  function renderSidebar() {
    const sidebar = document.getElementById("sidebar");

    const logoHTML = `
      <div class="sidebar-logo">
        <div class="logo-icon">
          <img src="assets/logo.png" alt="לוגו" />
        </div>
        <div>
          <div class="logo-text">FinanceAPP</div>
          <div class="logo-sub">ניהול פיננסי</div>
        </div>
      </div>`;

    let navHTML = `<nav class="sidebar-nav">`;
    NAV_STRUCTURE.forEach(group => {
      navHTML += `<div class="nav-section-label">${group.section}</div>`;
      group.items.forEach(item => {
        const isActive = item.id === currentPage ? "active" : "";
        navHTML += `
          <div class="nav-item ${isActive}" data-page="${item.id}">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
          </div>`;
      });
    });
    navHTML += `</nav>`;

    const toggleHTML = `
      <div class="sidebar-toggle" id="sidebar-toggle-btn" title="כווץ תפריט">
        <svg id="toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </div>`;

    sidebar.innerHTML = logoHTML + navHTML + toggleHTML;

    sidebar.querySelectorAll(".nav-item").forEach(el => {
      el.addEventListener("click", () => navigateTo(el.dataset.page));
    });

    document.getElementById("sidebar-toggle-btn").addEventListener("click", toggleSidebar);
  }

  /* ---- TOPBAR ---- */
  function renderTopbar() {
    const topbar = document.getElementById("topbar");
    const meta = PAGE_TITLES[currentPage] || { title: "", section: "" };

    topbar.innerHTML = `
      <!-- Mobile hamburger -->
      <button class="icon-btn" id="mobile-menu-btn" style="display:none">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      <!-- Breadcrumb -->
      <div class="topbar-breadcrumb">
        <span>${meta.section}</span>
        <span class="separator">›</span>
        <span class="page-title">${meta.title}</span>
      </div>

      <!-- Actions -->
      <div class="topbar-actions">
        <div class="status-pill" id="data-status-pill">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">ממתין לנתונים</span>
        </div>

        <button class="icon-btn" id="refresh-btn" title="רענן נתונים">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>

        <div class="avatar" title="פרופיל">י</div>
      </div>`;

    // Show hamburger on mobile
    const mobileBtn = document.getElementById("mobile-menu-btn");
    if (window.innerWidth <= 768) mobileBtn.style.display = "flex";

    mobileBtn?.addEventListener("click", toggleMobileSidebar);
    document.getElementById("refresh-btn")?.addEventListener("click", refreshData);
  }

  /* ---- CONTENT ---- */
  function renderContent(pageId) {
    const content = document.getElementById("content");
    const module = Pages[pageId];
    if (module && typeof module.render === "function") {
      content.innerHTML = "";
      module.render(content);
    } else {
      renderEmptyPage(content, pageId);
    }
    content.classList.remove("fade-in");
    void content.offsetWidth; // force reflow
    content.classList.add("fade-in");
  }

  function renderEmptyPage(container, pageId) {
    const meta = PAGE_TITLES[pageId] || { title: pageId };
    container.innerHTML = `
      <div class="empty-page">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M9 9h6M9 12h6M9 15h4"/>
          </svg>
        </div>
        <h2>${meta.title}</h2>
        <p>הדף הזה עדיין בבנייה. תוכן יתווסף בקרוב.</p>
      </div>`;
  }

  /* ---- NAVIGATION ---- */
  function navigateTo(pageId) {
    if (pageId === currentPage) return;
    currentPage = pageId;

    // Update nav active state
    document.querySelectorAll(".nav-item").forEach(el => {
      el.classList.toggle("active", el.dataset.page === pageId);
    });

    // Update topbar title
    renderTopbar();

    // Render page
    renderContent(pageId);

    // Close mobile sidebar if open
    if (mobileSidebarOpen) closeMobileSidebar();
  }

  /* ---- SIDEBAR COLLAPSE ---- */
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById("sidebar").classList.toggle("collapsed", sidebarCollapsed);
  }

  /* ---- MOBILE SIDEBAR ---- */
  function toggleMobileSidebar() {
    mobileSidebarOpen ? closeMobileSidebar() : openMobileSidebar();
  }

  function openMobileSidebar() {
    mobileSidebarOpen = true;
    document.getElementById("sidebar").classList.remove("mobile-hidden");
    document.getElementById("overlay").classList.add("visible");
  }

  function closeMobileSidebar() {
    mobileSidebarOpen = false;
    document.getElementById("sidebar").classList.add("mobile-hidden");
    document.getElementById("overlay").classList.remove("visible");
  }

  /* ---- PROGRESS BAR ---- */
  function _setProgress(state) {
    const bar = document.getElementById("app-progress");
    if (!bar) return;
    clearTimeout(_progressTimer);

    bar.className = "";          // reset all classes

    if (state === "loading") {
      bar.classList.add("visible", "loading");
    } else if (state === "success") {
      bar.classList.add("visible", "success");
      _progressTimer = setTimeout(() => { bar.className = ""; }, 900);
    } else if (state === "error") {
      bar.classList.add("visible", "error");
    }
    // null / idle → bar stays hidden (className = "")
  }

  /* ---- DATA REFRESH ---- */
  function refreshData() {
    DataService.clearCache();
    setDataStatus("loading");
    renderContent(currentPage);
  }

  /* ---- STATUS PILL ---- */
  function setDataStatus(status, errorMsg) {
    dataStatus = status;
    _lastErrorMsg = errorMsg || null;

    const dot  = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    const pill = document.getElementById("data-status-pill");
    if (!dot || !text) return;

    dot.className = "status-dot";

    // Remove any existing tooltip and error class
    const oldTip = pill?.querySelector(".error-tooltip");
    if (oldTip) oldTip.remove();
    pill?.classList.remove("has-error");

    if (status === "live") {
      dot.classList.add("live");
      text.textContent = "נתונים עדכניים";
      _setProgress("success");

    } else if (status === "error") {
      dot.classList.add("error");
      text.textContent = "שגיאת חיבור";
      _setProgress("error");
      if (pill && _lastErrorMsg) {
        pill.classList.add("has-error");
        const tip = document.createElement("div");
        tip.className = "error-tooltip";
        tip.innerHTML = `<strong style="display:block;margin-bottom:4px;color:var(--danger)">שגיאת חיבור</strong>${_lastErrorMsg}`;
        pill.appendChild(tip);
      }

    } else if (status === "loading") {
      dot.classList.add("loading");
      text.textContent = "טוען נתונים...";
      _setProgress("loading");

    } else {
      text.textContent = "ממתין לנתונים";
      _setProgress(null);
    }
  }

  /* ---- GLOBAL EVENTS ---- */
  function bindGlobalEvents() {
    document.getElementById("overlay")?.addEventListener("click", closeMobileSidebar);

    window.addEventListener("resize", () => {
      const mobileBtn = document.getElementById("mobile-menu-btn");
      if (mobileBtn) mobileBtn.style.display = window.innerWidth <= 768 ? "flex" : "none";
      if (window.innerWidth > 768 && mobileSidebarOpen) closeMobileSidebar();
    });
  }

  return { init, navigateTo, setDataStatus };
})();

/* ===== PAGES REGISTRY ===== */
const Pages = {};

/* ---- Boot ---- */
document.addEventListener("DOMContentLoaded", () => App.init());
