/* ============================================================
   AkashLang — Shared Firebase Database Module
   Pre-configured. Loads once, used by all pages.
   ============================================================ */
(async function () {
  'use strict';
  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const existing = getApps().find(a => a.name === 'akashlang');
    const app = existing || initializeApp({
      apiKey: "AIzaSyDwLHQS-iZ6VcOkc8JzFPmwL_DKpPQadqE",
      authDomain: "akashlang-a9d4b.firebaseapp.com",
      projectId: "akashlang-a9d4b",
      storageBucket: "akashlang-a9d4b.firebasestorage.app",
      messagingSenderId: "991206138904",
      appId: "1:991206138904:web:42b9cd3f8b33726ec88f6d",
      measurementId: "G-J3NNGVGPE0"
    }, 'akashlang');
    window.akashDB = getFirestore(app);
    window.dispatchEvent(new CustomEvent('akash-db-ready', { detail: { ok: true } }));
  } catch (e) {
    console.warn('[AkashLang] Firebase init failed:', e.message);
    window.akashDB = null;
    window.dispatchEvent(new CustomEvent('akash-db-ready', { detail: { ok: false, error: e.message } }));
  }
})();
