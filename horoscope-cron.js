import "dotenv/config";
import cron from "node-cron";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// --------------------
// Config & Clients
// --------------------

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MODEL = "claude-3-sonnet-20240229";

const SIGNS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];

// --------------------
// Helpers
// --------------------

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function generateHoroscope(sign, date) {
  const prompt = `
Write a concise daily horoscope for ${sign} dated ${date}.
Tone: warm, insightful, modern astrology.
Length: 3–4 sentences.
No emojis. No headings. No sign names in the text.
`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.content[0].text.trim();
}

async function saveHoroscope(sign, date, text) {
  const { error } = await supabase
    .from("horoscopes")
    .upsert(
      {
        sign,
        date,
        text,
      },
      {
        onConflict: "sign,date",
      }
    );

  if (error) throw error;
}

// --------------------
// Main Job
// --------------------

async function runJob() {
  const date = todayUTC();
  console.log(`[${new Date().toISOString()}] Generating horoscopes for ${date}`);

  let success = 0;
  let failed = 0;

  for (const sign of SIGNS) {
    try {
      const text = await generateHoroscope(sign, date);
      await saveHoroscope(sign, date, text);
      console.log(`✓ ${sign} daily generated`);
      success++;
    } catch (err) {
      console.error(`✗ ${sign} daily failed`, err?.message || err);
      failed++;
    }
  }

  console.log(`Done. ${success} generated, ${failed} errors.`);
}

// --------------------
// Cron Schedule
// --------------------

// Runs every day at 03:00 UTC
cron.schedule("0 3 * * *", async () => {
  await runJob();
});

// Run immediately on container start (Railway-friendly)
await runJob();
