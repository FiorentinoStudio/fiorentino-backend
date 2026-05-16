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
const COMET_API_CHAT_URL = 'https://api.cometapi.com/v1/chat/completions';
const COMET_API_IMAGE_URL = 'https://api.cometapi.com/v1/images/generations';

async function callCometAPI(systemPrompt, userPrompt, userApiKey, model = "gpt-4o", jsonMode = true) {
    try {
        const response = await axios.post(COMET_API_CHAT_URL, {
            model: model,
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
        let msg = error.response?.data?.error?.message || error.message || "Errore sconosciuto";
        console.error(`Errore CometAPI (Modello: ${model}):`, msg);
        throw new Error("Errore durante la chiamata testuale all'AI: " + msg);
    }
}

async function callCometImageAPI(prompt, userApiKey) {
    try {
        const response = await axios.post(COMET_API_IMAGE_URL, {
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1024x1024"
        }, {
            headers: {
                'Authorization': `Bearer ${userApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.data[0].url;
    } catch (error) {
        console.error("Errore CometAPI (Image):", error.response?.data || error.message);
        throw new Error("Errore durante la generazione dell'immagine");
    }
}

const PM_PROMPT = `Sei il Project Manager di una fabbrica 3D. 
Analizza la richiesta dell'utente. Se è un oggetto geometrico o meccanico, restituisci RIGOROSAMENTE questo JSON: {"tipo": "geometria", "descrizione_tecnica": "<descrizione>"}.
Se è un volto, un animale, un mostro o forma puramente organica, restituisci: {"tipo": "organico", "descrizione_tecnica": "<descrizione>"}
NON AGGIUNGERE ALTRO TESTO.`;

const PROMPT_ENHANCER = `Sei un esperto di prompt engineering visivo. L'utente vuole un modello 3D organico. Scrivi un prompt estremamente dettagliato in inglese per DALL-E 3 per generare una concept art iper-realistica di questo oggetto su sfondo neutro, pronta per una scansione Image-to-3D. Restituisci SOLO il testo del prompt.`;

const HELPER_1_ARCHITECT = `Sei un Ingegnere 3D e Architetto CAD Industriale.
Devi analizzare la richiesta testuale e scomporre l'oggetto in operazioni CSG per OpenSCAD.
REGOLA FONDAMENTALE: Non accontentarti di forme basilari. Qualsiasi oggetto (es. un estintore, un tavolo, un motore) DEVE essere composto da ALMENO 8-15 sottocomponenti iper-dettagliati. Pensa a viti, smussature, valvole, perni, manici ergonomici, basi di appoggio, etichette in rilievo. Non voglio giocattoli, voglio design industriali.

Restituisci ESCLUSIVAMENTE un file JSON con questa struttura:
{
  "nome_oggetto": "...",
  "componenti_dettagliati": [
    {"forma": "...", "scopo": "...", "coordinate_indicative": "[x,y,z]"}
  ],
  "operazioni_csg": [
    "spiegazione matematica precisissima su come incastrare le decine di pezzi, ricordando di usare translate() e rotate() per posizionare le valvole o i manici"
  ]
}
SOLO JSON VALIDO.`;

const HELPER_2_CODER = `Sei un Programmatore Senior di OpenSCAD. Ricevi il JSON dall'Architetto.
REGOLE CRITICHE PER ALTA COMPLESSITÀ:
1. Usa $fn=100 per curve perfette.
2. Sfrutta hull() per creare forme organiche/fluide tra due primitive.
3. IN OPENSCAD NON PUOI ASSEGNARE GEOMETRIE ALLE VARIABILI! Metti le forme (sphere, cylinder) direttamente nei blocchi CSG (union, difference).
4. La sintassi del cilindro DEVE avere: cylinder(h=10, r=5); o cylinder(h=10, r1=5, r2=2);
5. Aggiungi i commenti al codice per ogni sottocomponente (es. // Valvola, // Tubo flessibile).
6. Usa le traslazioni in modo coerente. Se fai un buco (difference), estendi l'oggetto sottrattivo di +0.1 per evitare z-fighting.
7. IL CODICE DEVE ESSERE LUNGO E DETTAGLIATO. Non scrivere script da 10 righe. Usa decine di operazioni se necessario per dare ultra realismo meccanico.
Restituisci SOLO IL CODICE OpenSCAD puro, niente markdown.`;

const HELPER_3_REVIEWER = `Sei un Compilatore OpenSCAD. Analizza il codice del Coder.
Cerca questi errori:
1. Assegnazioni di forme a variabili (es. testa = sphere();). Vietato.
2. Parametri mancanti nei cilindri.
3. Blocchi vuoti o z-fighting palese.
Restituisci ESCLUSIVAMENTE un JSON:
{
  "status": "ok" o "error",
  "feedback": "se error, spiega esattamente dove e come sistemare",
  "codice": "il codice OpenSCAD senza markdown"
}`;

app.post('/api/generate', async (req, res) => {
    try {
        const userApiKey = req.headers['x-user-api-key'];
        if (!userApiKey) return res.status(401).json({ success: false, error: "API Key mancante." });

        const { prompt, model } = req.body;
        const selectedModel = model || 'gpt-4o';
        if (!prompt) return res.status(400).json({ success: false, error: "Prompt vuoto." });

        // 1. PM
        let pmDecision;
        try {
            pmDecision = await callCometAPI(PM_PROMPT, prompt, userApiKey, 'gpt-4o-mini', true);
        } catch(e) {
            pmDecision = { tipo: "geometria", descrizione_tecnica: prompt };
        }

        // 2. FLUSSO ORGANICO
        if (pmDecision.tipo === 'organico') {
            try {
                let visualPrompt = await callCometAPI(PROMPT_ENHANCER, pmDecision.descrizione_tecnica, userApiKey, 'gpt-4o', false);
                let imageUrl = await callCometImageAPI(visualPrompt, userApiKey);
                return res.json({ success: true, type: 'organic', imageUrl: imageUrl });
            } catch (imgError) {
                return res.status(500).json({ success: false, error: "Errore durante la generazione immagine organica." });
            }
        }

        // 3. FLUSSO GEOMETRICO
        let architectJson;
        try { 
            architectJson = await callCometAPI(HELPER_1_ARCHITECT, pmDecision.descrizione_tecnica, userApiKey, selectedModel, true); 
        } catch(e) { throw new Error("Errore Architetto."); }

        let maxRetries = 3;
        let currentTry = 1;
        let isCodeValid = false;
        let currentCode = "";
        let feedbackForCoder = JSON.stringify(architectJson);

        while (currentTry <= maxRetries && !isCodeValid) {
            let coderPrompt = currentTry === 1 
                ? feedbackForCoder 
                : "Il revisore ha trovato questi errori. Correggili:\n" + feedbackForCoder + "\nCodice:\n" + currentCode;
            
            try {
                currentCode = await callCometAPI(HELPER_2_CODER, coderPrompt, userApiKey, selectedModel, false);
            } catch(e) { throw new Error("Errore Coder."); }

            let reviewResult;
            try {
                reviewResult = await callCometAPI(HELPER_3_REVIEWER, currentCode, userApiKey, selectedModel, true);
            } catch(e) {
                reviewResult = { status: "ok", codice: currentCode }; 
            }

            if (reviewResult.status === "ok") {
                isCodeValid = true;
                currentCode = reviewResult.codice || currentCode;
            } else {
                feedbackForCoder = reviewResult.feedback;
                currentCode = reviewResult.codice || currentCode;
                currentTry++;
            }
        }

        res.json({ success: true, type: 'geometric', code: currentCode.replace(/```openscad/ig, '').replace(/```/g, '') });
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