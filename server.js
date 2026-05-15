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
const axios        = require('axios');
const multer       = require('multer');
const fs           = require('fs');

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
const upload = multer({ dest: 'uploads/' });

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

// ══════════════════════════════════════════════════════════════
//  LOGICA MULTI-AGENTE AI 3D FACTORY
// ══════════════════════════════════════════════════════════════
const COMET_API_URL = 'https://api.cometapi.com/v1/chat/completions';

async function callCometAPI(systemPrompt, userPrompt, userApiKey, jsonMode = true) {
    try {
        const response = await axios.post(COMET_API_URL, {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: jsonMode ? { type: "json_object" } : { type: "text" },
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${userApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        const content = response.data.choices[0].message.content;
        return jsonMode ? JSON.parse(content) : content;
    } catch (error) {
        let msg = "Errore API sconosciuto";
        if (error.response && error.response.data) {
            if (error.response.data.error && error.response.data.error.message) {
                msg = error.response.data.error.message;
            } else {
                msg = JSON.stringify(error.response.data);
            }
        } else if (error.message) {
            msg = error.message;
        }
        console.error("Errore CometAPI:", msg);
        throw new Error("Dettaglio Errore API: " + msg);
    }
}

const HELPER_1_ARCHITECT = `Sei un Ingegnere 3D e Architetto CAD esperto. L'utente vuole creare un oggetto solido.
Devi analizzare la richiesta testuale e scomporre l'oggetto in operazioni CSG (Costructive Solid Geometry) per OpenSCAD.
Restituisci ESCLUSIVAMENTE un file JSON con la struttura logica e matematica dell'oggetto.
Formato richiesto:
{
  "nome_oggetto": "...",
  "componenti_base": [
    {"forma": "cilindro/cubo/sfera/toro", "scopo": "...", "parametri": "es. raggio X, altezza Y"}
  ],
  "operazioni_csg": [
    "spiegazione passo-passo di quali union(), difference(), translate(), rotate() usare per assemblare i pezzi, stando attento a non bucare il fondo se si scava l'interno (translate in Z)."
  ]
}
NIENTE MARKDOWN. NIENTE TESTO EXTRA. SOLO JSON VALIDO.`;

const HELPER_2_CODER = `Sei un Programmatore Senior di OpenSCAD. Ricevi il JSON dall'Architetto e devi scrivere il codice OpenSCAD perfetto.
REGOLE CRITICHE:
1. NON FARE MAI UN SINGOLO CILINDRO O CUBO. L'oggetto finale deve essere complesso e composto da più primitive usando 'union' e 'difference'. 
2. Se l'utente chiede una "tazza", DEVI creare il cilindro principale, USARE 'difference()' per sottrarre il cilindro interno (spostato in alto di 'spessore' sull'asse Z), e USARE 'union()' per aggiungere un manico laterale (es. un 'rotate' su un toro o su un semianello).
3. Usa sempre variabili parametriche all'inizio del file (es: altezza = 50; raggio_ext = 25; spessore = 3;).
4. Usa $fn=100 per tutte le superfici curve.
Restituisci SOLO IL CODICE OpenSCAD puro. NON INSERIRE MARKDOWN, BACKTICK o testo esplicativo.`;

const HELPER_3_REVIEWER = `Sei un Compilatore OpenSCAD. Controlla il codice scritto dal Programmatore.
1. Rimuovi qualsiasi blocco markdown residuo come \`\`\`openscad o \`\`\`.
2. Verifica la presenza di punti e virgola (;) alla fine delle istruzioni.
3. Verifica le parentesi graffe { } dei blocchi difference/union.
Restituisci ESCLUSIVAMENTE IL CODICE. NESSUN TESTO EXTRA.`;

app.post('/api/generate', async (req, res) => {
    try {
        const userApiKey = req.headers['x-user-api-key'];
        if (!userApiKey) return res.status(401).json({ success: false, error: "API Key mancante." });

        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: "Prompt vuoto." });

        let architectJson;
        try { 
            architectJson = await callCometAPI(HELPER_1_ARCHITECT, prompt, userApiKey, true); 
        } catch(e) { throw new Error("Errore Architetto: " + e.message); }

        let rawCode;
        try { 
            rawCode = await callCometAPI(HELPER_2_CODER, JSON.stringify(architectJson), userApiKey, false); 
        } catch(e) { throw new Error("Errore Programmatore: " + e.message); }

        let finalCode;
        try { 
            finalCode = await callCometAPI(HELPER_3_REVIEWER, rawCode, userApiKey, false); 
        } catch(e) { finalCode = rawCode; } // Fallback gracefully

        res.json({ success: true, type: 'geometric', code: finalCode.replace(/```openscad/ig, '').replace(/```/g, '') });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message || "Errore interno server." });
    }
});

// ── AVVIO ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ FiorentinoStudio backend attivo su porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
});