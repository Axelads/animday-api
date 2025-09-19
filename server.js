import express from "express";
import cors from "cors";
import morgan from "morgan";

// Config
const PORT = process.env.PORT || 8080;
const LT_URL = process.env.LT_URL || "https://libretranslate.com/translate";
const LT_API_KEY = process.env.LT_API_KEY || ""; // optionnel

// Petit cache en mémoire (clé = source|target|texte)
const MAX_ITEMS = 500;
const TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 jours
const cache = new Map(); // key -> { value, t }

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.t > TTL_MS) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value) {
  cache.set(key, { value, t: Date.now() });
  if (cache.size > MAX_ITEMS) {
    // retire le plus ancien
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(morgan("tiny"));

app.get("/", (_, res) => res.json({ ok: true, service: "animday-api" }));


app.post("/translate", async (req, res) => {
  try {
    const { q, source = "auto", target = "fr" } = req.body || {};
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Missing 'q' text" });
    }
    const key = `${source}|${target}|${q}`;
    const cached = cacheGet(key);
    if (cached) return res.json({ translatedText: cached, cached: true });

    // Appel LibreTranslate
    const body = {
      q,
      source,
      target,
      format: "text",
      api_key: LT_API_KEY || undefined,
    };

    const r = await fetch(LT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({ error: "LT upstream error", detail: txt });
    }

    const json = await r.json();
    const translated = json?.translatedText || "";
    cacheSet(key, translated);
    res.json({ translatedText: translated, cached: false });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`animday-api listening on :${PORT}`);
});
