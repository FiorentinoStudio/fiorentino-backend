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
    // Claude su CometAPI usa nomi tipo "claude-sonnet-4-6", non supporta response_format json
    const isClaudeModel = model.toLowerCase().includes('claude');
    const useJsonMode = jsonMode && !isClaudeModel;
    try {
        const payload = {
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.1
        };
        if (useJsonMode) {
            payload.response_format = { type: "json_object" };
        } else if (jsonMode && isClaudeModel) {
            // Per Claude iniettiamo l'istruzione JSON nel prompt direttamente
            payload.messages[0].content = systemPrompt + "\n\nRispondi ESCLUSIVAMENTE con JSON valido, senza markdown, senza codice, solo il JSON puro.";
        }
        const response = await axios.post(COMET_API_CHAT_URL, payload, {
            headers: {
                'Authorization': `Bearer ${userApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        const content = response.data.choices[0].message.content.trim();
        // Pulizia del JSON (rimuove eventuali blocchi markdown)
        const cleanContent = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        if (jsonMode) {
            try { return JSON.parse(cleanContent); } 
            catch(e) { 
                console.error("Parsing JSON fallito, risposta raw:", cleanContent.substring(0, 200));
                throw new Error("Il modello non ha restituito JSON valido.");
            }
        }
        return cleanContent;
    } catch (error) {
        let msg = error.response?.data?.error?.message || error.message || "Errore sconosciuto";
        console.error(`Errore CometAPI (Modello: ${model}):`, msg);
        throw new Error("Errore AI: " + msg);
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
        if (!response.data || !response.data.data || !response.data.data[0]) {
            throw new Error("Risposta API immagine malformata: " + JSON.stringify(response.data));
        }
        return response.data.data[0].url;
    } catch (error) {
        const msg = error.response?.data?.error?.message || error.message || "Errore sconosciuto";
        console.error("Errore CometAPI (Image):", error.response?.data || error.message);
        throw new Error("Errore generazione immagine DALL-E: " + msg);
    }
}

// ═══════════════════════════════════════════════════════════════
//  CLASSIFICATORE LOCALE (zero costo API)
// ═══════════════════════════════════════════════════════════════
const ORGANIC_KEYWORDS = [
    'animale','animali','cane','gatto','leone','tigre','orso','volpe','cavallo','uccello','pesce',
    'drago','dinosauro','mostro','creatura','personaggio','viso','faccia','testa','corpo umano',
    'statua','busto','scultura organica','albero','pianta','fiore','foglia','fungo','corallo',
    'nuvola','montagna organica','roccia organica'
];

function isOrganic(prompt) {
    const lower = prompt.toLowerCase();
    return ORGANIC_KEYWORDS.some(kw => lower.includes(kw));
}

// ═══════════════════════════════════════════════════════════════
//  PROMPT ENHANCER per DALL-E (forme organiche)
// ═══════════════════════════════════════════════════════════════
const PROMPT_ENHANCER = `You are a visual prompt engineer for DALL-E 3. The user wants to 3D-print an organic object. Write a single, ultra-detailed English prompt to generate a photorealistic concept art on a neutral white background, ready for Image-to-3D scanning. Return ONLY the prompt text, no other words.`;

// ═══════════════════════════════════════════════════════════════
//  MASTER OPENSCAD ENGINEER — singola chiamata, few-shot
// ═══════════════════════════════════════════════════════════════
const OPENSCAD_SYSTEM_PROMPT = `You are an expert OpenSCAD programmer. Generate valid, compilable OpenSCAD code for 3D printing.
Return ONLY the raw OpenSCAD code. No markdown, no explanation, no backticks.

STRICT RULES:
1. Always define named variables at the top (e.g. body_h = 60; body_r = 14;)
2. Organize everything inside a module, then call it at the end
3. Use $fn=80 for smooth curves
4. Use hull() to create organic transitions between shapes
5. Use difference() for hollow parts — extend the cutting shape by 0.1 to avoid z-fighting
6. NEVER assign geometry to variables (WRONG: head = sphere(10); RIGHT: use sphere(r=10) inside union/difference blocks)
7. cylinder() must always use named params: cylinder(h=10, r=5) or cylinder(h=10, r1=5, r2=3)
8. Add // comments for each sub-component
9. Aim for at least 10 distinct sub-components for realism

Here is a PERFECT example of the style and quality expected:

$fn = 80;
body_h = 60;
body_r = 14;

module fire_extinguisher() {
    union() {
        // Base
        cylinder(h=3, r=body_r);
        // Main tank body
        translate([0,0,3]) cylinder(h=body_h, r=body_r);
        // Top dome
        translate([0,0,body_h+3]) sphere(r=body_r);
        // Valve neck
        translate([0,0,body_h+3+body_r-2]) cylinder(h=6, r=5);
        // Valve block
        translate([0,0,body_h+3+body_r+4]) cylinder(h=7, r=7);
        // Fixed lower handle
        translate([0,0,body_h+3+body_r+6])
            rotate([0,-15,90]) translate([-2.5,0,0]) cube([5,22,3]);
        // Trigger handle
        translate([0,0,body_h+3+body_r+11])
            rotate([0,10,90]) translate([-2.5,0,0]) cube([5,24,3]);
        // Safety pin
        translate([0,10,body_h+3+body_r+5]) cylinder(h=8, r=1);
        // Pressure gauge
        translate([6,0,body_h+3+body_r+9]) rotate([0,90,0]) cylinder(h=4, r=3.5);
        // Hose attachment
        translate([-6,0,body_h+3+body_r+9]) rotate([0,-90,0]) cylinder(h=3, r=3);
        // Flexible hose via hull
        hull() {
            translate([-9,0,body_h+3+body_r+9]) sphere(r=2);
            translate([-body_r-1,0,-10]) sphere(r=2);
            translate([-body_r-1,5,-30]) sphere(r=2);
        }
        // Nozzle
        translate([-body_r-1,5,-30]) rotate([0,180,0])
            cylinder(h=10, r1=2, r2=3.5);
        // Keychain ring
        translate([0,24,body_h+3+body_r+6])
            difference() {
                cylinder(h=4, r=6, center=true);
                cylinder(h=6, r=3.5, center=true);
            }
        // Label plate
        translate([-1,-body_r+0.5,body_h/2])
            rotate([90,0,0]) linear_extrude(height=1.5)
                text("FIRE", size=7, font="Liberation Sans:style=Bold", valign="center", halign="center");
    }
}

fire_extinguisher();`;

// ═══════════════════════════════════════════════════════════════
//  ROUTE: POST /api/generate
// ═══════════════════════════════════════════════════════════════
app.post('/api/generate', async (req, res) => {
    try {
        const userApiKey = req.headers['x-user-api-key'];
        if (!userApiKey) return res.status(401).json({ success: false, error: 'API Key mancante.' });

        const { prompt, model } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: 'Prompt vuoto.' });

        const selectedModel = model || 'gpt-4o-mini';

        // ── FLUSSO ORGANICO: classificazione locale, zero costo API ──
        if (isOrganic(prompt)) {
            try {
                // 1 sola chiamata per migliorare il prompt visivo
                const visualPrompt = await callCometAPI(
                    PROMPT_ENHANCER, prompt, userApiKey, 'gpt-4o-mini', false
                );
                console.log('[Organic] prompt:', visualPrompt.substring(0, 120));
                const imageUrl = await callCometImageAPI(visualPrompt, userApiKey);
                console.log('[Organic] URL:', imageUrl);
                return res.json({ success: true, type: 'organic', imageUrl });
            } catch (e) {
                console.error('[Organic] Error:', e.message);
                return res.status(500).json({ success: false, error: 'Errore generazione immagine: ' + e.message });
            }
        }

        // ── FLUSSO GEOMETRICO: singola chiamata al modello ──
        try {
            const userMessage = `Generate OpenSCAD code for the following object. Follow the style and quality of the example exactly.\n\nObject description: ${prompt}`;
            let code = await callCometAPI(OPENSCAD_SYSTEM_PROMPT, userMessage, userApiKey, selectedModel, false);
            // Pulizia markdown residuo
            code = code.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
            console.log('[Geometric] Generated', code.length, 'chars with model', selectedModel);
            return res.json({ success: true, type: 'geometric', code });
        } catch (e) {
            console.error('[Geometric] Error:', e.message);
            return res.status(500).json({ success: false, error: 'Errore generazione codice: ' + e.message });
        }

    } catch (error) {
        console.error('[Route] Unhandled error:', error);
        res.status(500).json({ success: false, error: error.message || 'Errore interno server.' });
    }
});

// ── AVVIO ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ FiorentinoStudio backend attivo su porta ${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
});