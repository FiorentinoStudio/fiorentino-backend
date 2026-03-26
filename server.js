// ═══════════════════════════════════════════════════════════════
//  server.js — Backend Node.js + Express
//  FiorentinoStudio — Auth & Session Manager
//
//  SETUP:
//    1. npm init -y
//    2. npm install express cookie-parser cors firebase-admin dotenv
//    3. Crea file .env con le variabili sotto
//    4. node server.js
//
//  DEPLOY su Railway:
//    - Crea nuovo progetto Railway da GitHub
//    - Aggiungi le variabili ENV nel pannello Railway
//    - Deploy automatico ad ogni push
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const admin        = require('firebase-admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── FIREBASE ADMIN INIT ───────────────────────────────────────
// Scarica il file service account da:
// Firebase Console → Impostazioni progetto → Account di servizio → Genera nuova chiave privata
// Metti il JSON nella variabile ENV FIREBASE_SERVICE_ACCOUNT (come stringa JSON)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    )
  });
}

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// CORS: permetti solo il tuo dominio
const allowedOrigins = [
  'http://localhost:5500',      // Live Server locale
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL      // Es: https://fiorentino.studio
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS non autorizzato: ' + origin));
    }
  },
  credentials: true   // ← ESSENZIALE per i cookie cross-origin
}));

// ── COSTANTI COOKIE ───────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly:  true,              // JS non può leggerlo → protetto da XSS
  secure:    process.env.NODE_ENV === 'production', // Solo HTTPS in prod
  sameSite:  'Lax',             // 'Strict' rompe i redirect OAuth
  maxAge:    7 * 24 * 60 * 60 * 1000,  // 7 giorni in millisecondi
  path:      '/'
};

// ── HELPER: verifica token Firebase ──────────────────────────
async function verifyToken(token) {
  try {
    return await admin.auth().verifyIdToken(token, true); // checkRevoked=true
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  ROUTE: POST /login
//  Riceve idToken Firebase dal browser, verifica, imposta cookie
// ══════════════════════════════════════════════════════════════
app.post('/login', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Token mancante' });

  const decoded = await verifyToken(idToken);
  if (!decoded) return res.status(401).json({ error: 'Token non valido' });

  // Imposta il cookie di sessione
  res.cookie('session', idToken, COOKIE_OPTIONS);

  res.json({
    uid:         decoded.uid,
    email:       decoded.email || null,
    displayName: decoded.name || decoded.email || 'Utente',
    photoURL:    decoded.picture || null
  });
});

// ══════════════════════════════════════════════════════════════
//  ROUTE: GET /me
//  Verifica il cookie di sessione → restituisce i dati utente
//  Usato da auth.js all'avvio di ogni pagina
// ══════════════════════════════════════════════════════════════
app.get('/me', async (req, res) => {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });

  const decoded = await verifyToken(token);
  if (!decoded) {
    // Token scaduto o revocato → cancella il cookie
    res.clearCookie('session', { path: '/' });
    return res.status(401).json({ error: 'Sessione scaduta' });
  }

  res.json({
    uid:         decoded.uid,
    email:       decoded.email || null,
    displayName: decoded.name || decoded.email || 'Utente',
    photoURL:    decoded.picture || null
  });
});

// ══════════════════════════════════════════════════════════════
//  ROUTE: POST /logout
//  Cancella il cookie di sessione
// ══════════════════════════════════════════════════════════════
app.post('/logout', async (req, res) => {
  const token = req.cookies.session;

  // Revoca il token Firebase così non può essere riusato
  if (token) {
    try {
      const decoded = await verifyToken(token);
      if (decoded) await admin.auth().revokeRefreshTokens(decoded.uid);
    } catch (e) { /* ignora errori di revoca */ }
  }

  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  ROUTE: GET /health
//  Controlla che il backend sia vivo (utile per Railway)
// ══════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Errore interno del server' });
});

// ── AVVIO ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ FiorentinoStudio backend attivo su porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
});