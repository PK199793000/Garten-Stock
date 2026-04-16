import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBuZ5HMfnM06sVYIzbog4lOER8q4BoJ760",
  authDomain:        "garten-stock.firebaseapp.com",
  projectId:         "garten-stock",
  storageBucket:     "garten-stock.firebasestorage.app",
  messagingSenderId: "474916104313",
  appId:             "1:474916104313:web:bff56ddb8646c3f2940ca8"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const PAGE_ID = location.pathname.split('/').pop().replace('.html','') || 'index';
const DOC_REF = doc(db, 'garten_events', PAGE_ID);
const USERS_REF = doc(db, 'garten_users', 'users');

// ── SAVE event data ──
window._fbSave = async function(data) {
  try { await setDoc(DOC_REF, data, { merge: false }); }
  catch(e) { console.warn('Firebase save error', e); }
};

// ── LOAD event data ──
window._fbLoad = async function() {
  try {
    const snap = await getDoc(DOC_REF);
    if (snap.exists()) window._fbApply(snap.data());
  } catch(e) { console.warn('Firebase load error', e); }
};

// ── REALTIME LISTENER ──
onSnapshot(DOC_REF, (snap) => {
  if (snap.exists() && window._fbApply) window._fbApply(snap.data());
});

// ── USERS: load all users ──
window._fbLoadUsers = async function() {
  try {
    const snap = await getDoc(USERS_REF);
    if (snap.exists()) return snap.data().list || [];
    return [];
  } catch(e) { console.warn('Firebase users load error', e); return []; }
};

// ── USERS: save all users ──
window._fbSaveUsers = async function(userList) {
  try { await setDoc(USERS_REF, { list: userList }); }
  catch(e) { console.warn('Firebase users save error', e); }
};

</script>
