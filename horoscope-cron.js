// horoscope-cron.js
// Generates horoscopes and saves to Supabase
// Node 20-ready and Claude-4 compatible
//
// Environment variables required:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   SLACK_WEBHOOK_URL (optional for failure alerts)
//   RUN_NOW=true (optional for immediate test)

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import cron from "node-cron";

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Zodiac signs
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

// Helper: ISO date
const getISODate = () => new Date().toISOString().split("T")[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isMonday = () => new Date().getDay() === 1;
const isFirstOfMonth = () => new Date().getDate() === 1;
const isJanFirst = () => new Date().getMonth() === 0 && new Date().getDate() === 1;

// Send Slack notification on failure
async function notifyFailure(errorCount, date) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `⚠️ Celestia: ${errorCount} horoscope(s) failed for ${date}`,
    }),
  });
}

// Generate horoscope via Claude-4
async function generateHoroscope(sign, period, planetaryContext) {
  const wordCounts = { daily: 80, weekly: 120, monthly: 160, annual: 220 };
  const tones = {
    daily: "immediate, personal, actionable — as if speaking to them this morning",
    weekly: "forward-looking with specific days called out mid-week and weekend",
    monthly: "arc of the month: beginning, pivotal mid-point, and closing theme",
    annual: "sweeping and meaningful, covering love, career, health, and growth",
  };

  const prompt = `You are a gifted, poetic astrologer.

Today's planetary context: ${planetaryContext}

Write a ${period} horoscope for ${sign.name} (${sign.element}, ${sign.modality}, ruled by ${sign.ruler}).

Tone: ${tones[period]}
Length: approximately ${wordCounts[period]} words
Style: lyrical but grounded, specific rather than vague, never clichéd.
Do NOT start with "${sign.name}," or the sign name.
Output only the horoscope text.`;

  const response = await anthropic.messages.create({
    model: "claude-4",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text.trim();
}

// Save to Supabase
async function saveHoroscope(sign, period, text, date) {
  const { error } = await supabase
    .from("horoscopes")
    .upsert(
      { sign: sign.name.toLowerCase(), period, text, date, generated_at: new Date().toISOString() },
      { onConflict: "sign,period,date" }
    );

  if (error) throw new Error(`Supabase error for ${sign.name}/${period}: ${error.message}`);
}

// Build fallback planetary context
function buildFallbackContext() {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const sunSign = getSunSign(month, day);
  const lunarAge = ((date - new Date("2000-01-06")) / 86400000) % 29.5;
  const moonPhase =
    lunarAge < 3.7 ? "New Moon" :
    lunarAge < 7.4 ? "Waxing Crescent" :
    lunarAge < 11.1 ? "First Quarter" :
    lunarAge < 14.8 ? "Waxing Gibbous" :
    lunarAge < 18.5 ? "Full Moon" :
    lunarAge < 22.2 ? "Waning Gibbous" :
    lunarAge < 25.9 ? "Last Quarter" : "Waning Crescent";

  return `Sun in ${sunSign}. Moon phase: ${moonPhase}. Date: ${date.toDateString()}.`;
}

function getSunSign(month, day) {
  const cusps = [
    [3,21,"Aries"],[4,20,"Taurus"],[5,21,"Gemini"],[6,21,"Cancer"],
    [7,23,"Leo"],[8,23,"Virgo"],[9,23,"Libra"],[10,23,"Scorpio"],
    [11,22,"Sagittarius"],[12,22,"Capricorn"],[1,20,"Aquarius"],[2,19,"Pisces"]
  ];
  for (const [m,d,sign] of cusps) {
    if (month === m && day >= d) return sign;
    if (month === m+1 && day < d) return sign;
  }
  return "Capricorn";
}

// Main generation function
async function generateAllHoroscopes() {
  const date = getISODate();
  console.log(`[${new Date().toISOString()}] Generating horoscopes for ${date}`);
  const planetaryContext = buildFallbackContext();

  let successCount = 0;
  let errorCount = 0;

  for (const sign of SIGNS) {
    for (const period of PERIODS) {
      try {
        if (period === "weekly" && !isMonday()) continue;
        if (period === "monthly" && !isFirstOfMonth()) continue;
        if (period === "annual" && !isJanFirst()) continue;

        const text = await generateHoroscope(sign, period, planetaryContext);
        await saveHoroscope(sign, period, text, date);

        successCount++;
        console.log(`✓ ${sign.name} ${period}`);
        await sleep(1000); // rate limit ~1 req/sec
      } catch (err) {
        errorCount++;
        console.error(`✗ ${sign.name} ${period}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. ${successCount} generated, ${errorCount} errors.`);
  if (errorCount > 0) await notifyFailure(errorCount, date);
}

// Schedule: 03:00 UTC daily
cron.schedule("0 3 * * *", generateAllHoroscopes, { timezone: "UTC" });

// Immediate run for testing
if (process.env.RUN_NOW === "true") generateAllHoroscopes();

console.log("Celestia horoscope cron job running. Waiting for 03:00 UTC...");
