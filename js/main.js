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
  const navLinks = document.querySelector('.topnav-links');
  if (toggle) {
    toggle.addEventListener('click', () => {
      // On very small screens: toggle nav links dropdown
      if (window.innerWidth <= 700 && navLinks) {
        navLinks.classList.toggle('nav-open');
        if (sidebar) sidebar.classList.remove('open');
      } else if (sidebar) {
        // On medium screens: toggle sidebar drawer
        sidebar.classList.toggle('open');
      }
    });
    document.addEventListener('click', e => {
      if (navLinks && navLinks.classList.contains('nav-open') &&
          !navLinks.contains(e.target) && !toggle.contains(e.target)) {
        navLinks.classList.remove('nav-open');
      }
      if (sidebar && sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
    // Close nav links when a nav link is clicked on mobile
    if (navLinks) {
      navLinks.addEventListener('click', e => {
        if (e.target.tagName === 'A') navLinks.classList.remove('nav-open');
      });
    }
  }

  /* ---- Auth chip in nav ---- */
  const topnav = document.querySelector('.topnav');
  if (topnav) {
    const chip = document.createElement('div');
    chip.className = 'auth-chip';
    chip.id = 'auth-chip';
    chip.innerHTML = `
      <button class="auth-sign-in-btn" id="auth-sign-in-btn" title="Sign in with Google">
        <svg width="14" height="14" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.8 0 7 5.4 3.2 13.3l7.8 6C12.8 13.2 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.5 37.5 46.5 31.4 46.5 24.5z"/><path fill="#FBBC05" d="M11 28.3c-.6-1.6-.9-3.3-.9-5.3s.3-3.7.9-5.3l-7.8-6C1.2 15.1 0 19.4 0 24s1.2 8.9 3.2 12.3l7.8-6z"/><path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.5-5.8c-2.1 1.4-4.7 2.3-7.8 2.3-6.1 0-11.2-3.7-13.1-9l-7.8 6C7 42.6 14.8 48 24 48z"/></svg>
        Sign in
      </button>
      <div class="auth-user-chip" id="auth-user-chip">
        <div class="auth-avatar-placeholder" id="auth-avatar-placeholder">?</div>
        <img class="auth-avatar" id="auth-avatar" src="" alt="" style="display:none">
        <span class="auth-name" id="auth-name"></span>
        <button class="auth-sign-out-btn" id="auth-sign-out-btn">Sign out</button>
      </div>`;
    topnav.appendChild(chip);

    document.getElementById('auth-sign-in-btn').addEventListener('click', async () => {
      if (window.akashSignIn) {
        try { await window.akashSignIn(); }
        catch (e) {
          if (e.code !== 'auth/popup-closed-by-user') alert('Sign in failed: ' + (e.message || e.code));
        }
      }
    });
    document.getElementById('auth-sign-out-btn').addEventListener('click', () => {
      if (window.akashSignOut) window.akashSignOut();
    });

    function updateAuthChip(user) {
      const signInBtn = document.getElementById('auth-sign-in-btn');
      const userChip  = document.getElementById('auth-user-chip');
      const nameEl    = document.getElementById('auth-name');
      const avatarEl  = document.getElementById('auth-avatar');
      const avatarPH  = document.getElementById('auth-avatar-placeholder');
      if (!signInBtn) return;
      if (!user) {
        signInBtn.style.display = '';
        userChip.classList.remove('visible');
      } else {
        signInBtn.style.display = 'none';
        userChip.classList.add('visible');
        const isDev = window.akashIsDeveloper;
        nameEl.textContent = isDev ? 'Developer' : (user.displayName?.split(' ')[0] || user.email.split('@')[0]);
        nameEl.className = 'auth-name' + (isDev ? ' developer' : '');
        if (user.photoURL) {
          avatarEl.src = user.photoURL;
          avatarEl.style.display = '';
          avatarPH.style.display = 'none';
        } else {
          avatarPH.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
          avatarEl.style.display = 'none';
          avatarPH.style.display = '';
        }
      }
    }

    // Initial state (auth may already be resolved before DOMContentLoaded)
    updateAuthChip(window.akashCurrentUser || null);
    window.addEventListener('akash-auth-change', e => updateAuthChip(e.detail.user));
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
