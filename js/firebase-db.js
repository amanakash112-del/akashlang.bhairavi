/* ============================================================
   AkashLang — Shared Firebase Database + Auth Module
   Pre-configured. Loads once, used by all pages.
   ============================================================ */
(async function () {
  'use strict';
  const DEVELOPER_EMAIL = 'aman.akash112@gmail.com';
  try {
    const [
      { initializeApp, getApps },
      { getFirestore },
      { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js')
    ]);

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
    const auth = getAuth(app);
    window.akashAuth = auth;
    window.akashCurrentUser = null;
    window.akashIsDeveloper = false;

    window.akashSignIn = async function () {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    };

    window.akashSignOut = async function () {
      await signOut(auth);
    };

    onAuthStateChanged(auth, (user) => {
      window.akashCurrentUser = user || null;
      window.akashIsDeveloper = (user?.email === DEVELOPER_EMAIL);
      window.dispatchEvent(new CustomEvent('akash-auth-change', {
        detail: { user, isDeveloper: window.akashIsDeveloper }
      }));
    });

    window.dispatchEvent(new CustomEvent('akash-db-ready', { detail: { ok: true } }));
  } catch (e) {
    console.warn('[AkashLang] Firebase init failed:', e.message);
    window.akashDB = null;
    window.dispatchEvent(new CustomEvent('akash-db-ready', { detail: { ok: false, error: e.message } }));
  }
})();
