import express from "express";
import cors from "cors";
import morgan from "morgan";

// Config
const PORT = process.env.PORT || 8080;
const PRIMARY_URL = process.env.LT_URL || "https://libretranslate.de/translate";
// Liste de secours séparée par des virgules (peut être vide) :
const FALLBACKS = (process.env.LT_FALLBACKS || "https://libretranslate.com/translate,https://translate.astian.org/translate")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const LT_API_KEY = process.env.LT_API_KEY || ""; // optionnel

// Petit cache mémoire
const MAX_ITEMS = 500;
const TTL_MS = 1000 * 60 * 60 * 24 * 60;
const cache = new Map();
const cacheGet = (k) => {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > TTL_MS) { cache.delete(k); return null; }
  return e.value;
};
const cacheSet = (k, v) => {
  cache.set(k, { value: v, t: Date.now() });
  if (cache.size > MAX_ITEMS) cache.delete(cache.keys().next().value);
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(morgan("tiny"));

app.get("/", (_, res) => res.json({ ok: true, service: "animday-api" }));
app.get("/health", (_, res) => res.json({ ok: true }));

// Helper: POST JSON avec timeout
async function postJson(url, body, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return r;
  } finally {
    clearTimeout(id);
  }
}

app.post("/translate", async (req, res) => {
  try {
    const { q, source = "auto", target = "fr" } = req.body || {};
    if (!q || typeof q !== "string") return res.status(400).json({ error: "Missing 'q' text" });

    const key = `${source}|${target}|${q}`;
    const cached = cacheGet(key);
    if (cached) return res.json({ translatedText: cached, cached: true });

    const body = { q, source, target, format: "text", api_key: LT_API_KEY || undefined };

    const urls = [PRIMARY_URL, ...FALLBACKS];
    const tried = [];

    for (const url of urls) {
      try {
        const r = await postJson(url, body, 8000);
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          tried.push({ url, status: r.status, body: txt?.slice(0, 200) });
          console.error("LT upstream non-OK:", { url, status: r.status, snippet: txt?.slice(0, 120) });
          continue;
        }
        const json = await r.json();
        const translated = json?.translatedText || "";
        cacheSet(key, translated);
        return res.json({ translatedText: translated, cached: false, upstream: url });
      } catch (e) {
        tried.push({ url, error: String(e) });
        console.error("LT upstream error:", url, e);
      }
    }

    return res.status(502).json({ error: "LT upstream error", tried });
  } catch (e) {
    console.error("translate handler error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`animday-api listening on :${PORT}`);
  console.log("Primary:", PRIMARY_URL);
  console.log("Fallbacks:", FALLBACKS);
});
