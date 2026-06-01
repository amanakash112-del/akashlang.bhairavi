/* ============================================================
   AkashLang — main.js
   Shared navigation, sidebar, TOC, utilities
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Active nav link ---- */
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.topnav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  /* ---- Sidebar active on scroll ---- */
  const sidebarLinks = document.querySelectorAll('.sidebar a[href^="#"]');
  const headings = [];
  sidebarLinks.forEach(link => {
    const id = link.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) headings.push({ link, el });
  });

  function updateSidebarActive() {
    const scrollY = window.scrollY + 80;
    let active = null;
    headings.forEach(({ el }) => {
      if (el.offsetTop <= scrollY) active = el;
    });
    sidebarLinks.forEach(link => link.classList.remove('active'));
    if (active) {
      headings.forEach(({ link, el }) => {
        if (el === active) link.classList.add('active');
      });
    }
  }
  window.addEventListener('scroll', updateSidebarActive, { passive: true });
  updateSidebarActive();

  /* ---- Progress bar ---- */
  const progress = document.createElement('div');
  progress.className = 'progress-bar';
  document.body.appendChild(progress);
  window.addEventListener('scroll', () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const pct = total > 0 ? (window.scrollY / total) * 100 : 0;
    progress.style.width = pct + '%';
  }, { passive: true });

  /* ---- Back to top ---- */
  const btt = document.createElement('button');
  btt.className = 'back-to-top';
  btt.innerHTML = '↑';
  btt.title = 'Back to top';
  document.body.appendChild(btt);
  btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => {
    btt.classList.toggle('show', window.scrollY > 400);
  }, { passive: true });

  /* ---- Mobile menu toggle ---- */
  const toggle = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  /* ---- Global site search (in topnav) ---- */
  const globalSearch = document.querySelector('.topnav-search input');
  if (globalSearch) {
    globalSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = globalSearch.value.trim();
        if (q) window.location.href = `dictionary.html?q=${encodeURIComponent(q)}`;
      }
    });
  }

  /* ---- Practice answer toggles ---- */
  document.querySelectorAll('.answer-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = btn.nextElementSibling;
      if (box && box.classList.contains('answer-box')) {
        box.classList.toggle('show');
        btn.textContent = box.classList.contains('show') ? 'Hide Answers' : 'Show Answers';
      }
    });
  });

  /* ---- Tab system ---- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const target = btn.dataset.tab;
      document.querySelectorAll(`.tab-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`.tab-content[data-group="${group}"]`).forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.querySelector(`.tab-content[data-group="${group}"][data-tab="${target}"]`);
      if (content) content.classList.add('active');
    });
  });

  /* ---- Chapter nav (N5/N4) ---- */
  document.querySelectorAll('.chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.chapter;
      document.querySelectorAll('.chapter-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.chapter-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const section = document.getElementById(target);
      if (section) section.classList.add('active');
    });
  });

  /* ---- Auto-activate first chapter / tab ---- */
  const firstChapterBtn = document.querySelector('.chapter-btn');
  if (firstChapterBtn) firstChapterBtn.click();
  const firstTabBtn = document.querySelector('.tab-btn');
  if (firstTabBtn) firstTabBtn.click();

});
