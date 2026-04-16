import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "{{FB_API_KEY}}",
  authDomain:        "{{FB_AUTH_DOMAIN}}",
  projectId:         "{{FB_PROJECT_ID}}",
  storageBucket:     "{{FB_STORAGE_BUCKET}}",
  messagingSenderId: "{{FB_MESSAGING_SENDER_ID}}",
  appId:             "{{FB_APP_ID}}"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Offline persistence — saisies conservées sans réseau, sync au retour
enableIndexedDbPersistence(db).catch(e => {
  if (e.code === 'failed-precondition') console.warn('Offline persistence: plusieurs onglets ouverts');
  else if (e.code === 'unimplemented') console.warn('Offline persistence non supportée sur ce navigateur');
});

const PAGE_ID = location.pathname.split('/').pop().replace('.html','') || 'index';
const DOC_REF   = doc(db, 'garten_events', PAGE_ID);
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

// ── USERS: load ──
window._fbLoadUsers = async function() {
  try {
    const snap = await getDoc(USERS_REF);
    if (snap.exists()) return snap.data().list || [];
    return [];
  } catch(e) { console.warn('Firebase users load error', e); return []; }
};

// ── USERS: save ──
window._fbSaveUsers = async function(userList) {
  try { await setDoc(USERS_REF, { list: userList }); }
  catch(e) { console.warn('Firebase users save error', e); }
};

// ── LOAD other event (read-only, for history screen) ──
window._fbLoadEvent = async function(eventId) {
  try {
    const ref = doc(db, 'garten_events', eventId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch(e) { console.warn('Firebase load event error', e); return null; }
};
