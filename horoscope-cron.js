// horoscope-cron.js
// Runs daily at 3:00 AM UTC — generates horoscopes and saves to Supabase
// Designed for Railway / cloud deployment (no local tooling required)

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import cron from "node-cron";

// ─── Clients ────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Zodiac data ─────────────────────────────────────────────────────────────
const SIGNS = [
  { name: "Aries", element: "Fire", modality: "Cardinal", ruler: "Mars" },
  { name: "Taurus", element: "Earth", modality: "Fixed", ruler: "Venus" },
  { name: "Gemini", element: "Air", modality: "Mutable", ruler: "Mercury" },
  { name: "Cancer", element: "Water", modality: "Cardinal", ruler: "Moon" },
  { name: "Leo", element: "Fire", modality: "Fixed", ruler: "Sun" },
  { name: "Virgo", element: "Earth", modality: "Mutable", ruler: "Mercury" },
  { name: "Libra", element: "Air", modality: "Cardinal", ruler: "Venus" },
  { name: "Scorpio", element: "Water", modality: "Fixed", ruler: "Pluto" },
  { name: "Sagittarius", element: "Fire", modality: "Mutable", ruler: "Jupiter" },
  { name: "Capricorn", element: "Earth", modality: "Cardinal", ruler: "Saturn" },
  { name: "Aquarius", element: "Air", modality: "Fixed", ruler: "Uranus" },
  { name: "Pisces", element: "Water", modality: "Mutable", ruler: "Neptune" },
];

const PERIODS = ["daily", "weekly", "monthly", "annual"];

// ─── Planetary context (deterministic, no API calls) ─────────────────────────
function getPlanetaryContext() {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const sunSign = getSunSign(month, day);
  const lunarAge = ((date - new Date("2000-01-06")) / 86400000) % 29.53;

  const moonPhase =
    lunarAge < 3.7 ? "New Moon" :
    lunarAge < 7.4 ? "Waxing Crescent" :
    lunarAge < 11.1 ? "First Quarter" :
    lunarAge < 14.8 ? "Waxing Gibbous" :
    lunarAge < 18.5 ? "Full Moon" :
    lunarAge < 22.2 ? "Waning Gibbous" :
    lunarAge < 25.9 ? "Last Quarter" :
    "Waning Crescent";

  return `Sun in ${sunSign}. Moon phase: ${moonPhase}. Date: ${date.toDateString()}.`;
}

function getSunSign(month, day) {
  const cusps = [
    [3,21,"Aries"],[4,20,"Taurus"],[5,21,"Gemini"],[6,21,"Cancer"],
    [7,23,"Leo"],[8,23,"Virgo"],[9,23,"Libra"],[10,23,"Scorpio"],
    [11,22,"Sagittarius"],[12,22,"Capricorn"],[1,20,"Aquarius"],[2,19,"Pisces"]
  ];
  for (const [m, d, sign] of cusps) {
    if (month === m && day >= d) return sign;
    if (month === m + 1 && day < d) return sign;
  }
  return "Capricorn";
}

// ─── Claude generation ───────────────────────────────────────────────────────
async function generateHoroscope(sign, period, planetaryContext) {
  const wordCounts = { daily: 80, weekly: 120, monthly: 160, annual: 220 };
  const tones = {
    daily: "immediate and actionable, written for this morning",
    weekly: "forward-looking with a clear mid-week pivot",
    monthly: "a narrative arc with a turning point",
    annual: "expansive, meaningful, covering love, work, health, and growth",
  };

  const prompt = `You are a gifted astrologer writing for a premium horoscope app.

Planetary context:
${planetaryContext}

Write a ${period} horoscope for ${sign.name} (${sign.element}, ${sign.modality}, ruled by ${sign.ruler}).

Tone: ${tones[period]}
Length: ~${wordCounts[period]} words
Style: poetic but grounded, specific, never clichéd.
Rules:
- Do NOT start with the sign name
- Do NOT use the words "journey", "universe", "cosmos", or "celestial"
- Output only the horoscope text`;

  const message = await anthropic.messages.create({
    model: "claude-3-sonnet-20240229",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].text.trim();
}

// ─── Supabase persistence ────────────────────────────────────────────────────
async function saveHoroscope(sign, period, text, date) {
  const { error } = await supabase
    .from("horoscopes")
    .upsert(
      {
        sign: sign.name.toLowerCase(),
        period,
        text,
        date,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "sign,period,date" }
    );

  if (error) throw new Error(error.message);
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateAllHoroscopes() {
  const date = getISODate();
  console.log(`[${new Date().toISOString()}] Generating horoscopes for ${date}`);

  const planetaryContext = getPlanetaryContext();
  let success = 0;
  let errors = 0;

  for (const sign of SIGNS) {
    for (const period of PERIODS) {
      if (period === "weekly" && !isMonday()) continue;
      if (period === "monthly" && !isFirstOfMonth()) continue;
      if (period === "annual" && !isJanFirst()) continue;

      try {
        const text = await generateHoroscope(sign, period, planetaryContext);
        await saveHoroscope(sign, period, text, date);
        success++;
        console.log(`✓ ${sign.name} ${period}`);
        await sleep(1000); // rate limit
      } catch (err) {
        errors++;
        console.error(`✗ ${sign.name} ${period}: ${err.message}`);
      }
    }
  }

  console.log(`Done. ${success} created, ${errors} errors.`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getISODate = () => new Date().toISOString().split("T")[0];
const isMonday = () => new Date().getDay() === 1;
const isFirstOfMonth = () => new Date().getDate() === 1;
const isJanFirst = () => new Date().getMonth() === 0 && new Date().getDate() === 1;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Schedule ────────────────────────────────────────────────────────────────
cron.schedule("0 3 * * *", generateAllHoroscopes, { timezone: "UTC" });

if (process.env.RUN_NOW === "true") {
  generateAllHoroscopes();
}

console.log("Celestia horoscope cron running — waiting for 03:00 UTC");
