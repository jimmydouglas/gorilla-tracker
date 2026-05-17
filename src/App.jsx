import { useState, useEffect, useRef } from "react";

// ── constants ──────────────────────────────────────────────────────────────
const TARGETS = { protein: 165, calories: 2100, fiber: 35 };
const PROFILE = {
  name: "Jimmy",
  weight: 166.9,
  bodyFat: 14.9,
  smm: 81.4,
  goal: "Samuel Johnston physique",
  shredded: "Labor Day 2026",
  gorilla: "Summer 2027",
};

const TODAY_KEY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const EMPTY_DAY = () => ({ date: TODAY_KEY(), meals: [], sleep: null, workout: null });

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(n) { return Math.round(n); }
function pct(val, target) { return Math.min(100, Math.round((val / target) * 100)); }

function sumDay(meals) {
  return meals.reduce(
    (a, m) => ({ protein: a.protein + m.protein, calories: a.calories + m.calories, fiber: a.fiber + m.fiber }),
    { protein: 0, calories: 0, fiber: 0 }
  );
}

// ── Image compression ─────────────────────────────────────────────────────
function compressImage(file, maxPx = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error("Compression failed"));
        const reader = new FileReader();
        reader.onload = e => resolve({ base64: e.target.result.split(",")[1], mimeType: "image/jpeg" });
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Claude vision call ─────────────────────────────────────────────────────
async function analyzeFoodPhoto(base64, mimeType) {
  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are a precise nutrition analyzer for a fitness tracking app.
The user is a 41yo male, 167 lbs, targeting 165g protein / 2100 cal / 35g fiber daily.
When shown a food photo, estimate macros based ONLY on the actual portion visible in the image — not default restaurant or serving sizes. Use visual cues like plate size, density, and relative proportions to judge quantity. If the portion looks small, estimate small. Never default to a full serving size unless the photo clearly shows one.
Respond ONLY with valid JSON (no markdown, no explanation):
{"name":"<short meal name>","protein":<number>,"calories":<number>,"fiber":<number>,"notes":"<1 sentence on portion size observed>"}
Be accurate. Never refuse.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
            { type: "text", text: "Analyze this meal and return JSON with protein (g), calories, fiber (g), and a short name." },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No text in API response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    name: parsed.name || "Unknown meal",
    protein: Number(parsed.protein) || 0,
    calories: Number(parsed.calories) || 0,
    fiber: Number(parsed.fiber) || 0,
    notes: parsed.notes || "",
  };
}

// ── Claude text description call ──────────────────────────────────────────
async function analyzeTextDescription(description) {
  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are a precise nutrition analyzer for a fitness tracking app.
The user is a 41yo male, 167 lbs, targeting 165g protein / 2100 cal / 35g fiber daily.
The user will describe a meal in plain text. Estimate the macros as accurately as possible based on typical serving sizes.
Respond ONLY with valid JSON (no markdown, no explanation):
{"name":"<short meal name>","protein":<number>,"calories":<number>,"fiber":<number>,"notes":"<1 sentence on assumptions made>"}`,
      messages: [{
        role: "user",
        content: [{ type: "text", text: description }],
      }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No text in API response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    name: parsed.name || "Unknown meal",
    protein: Number(parsed.protein) || 0,
    calories: Number(parsed.calories) || 0,
    fiber: Number(parsed.fiber) || 0,
    notes: parsed.notes || "",
  };
}

// ── Screenshot analysis helpers ───────────────────────────────────────────
async function analyzeScreenshot(base64, mimeType, system, userText) {
  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
        { type: "text", text: userText },
      ]}],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message || `API error ${resp.status}`); }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No text in response");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

async function analyzeWorkoutScreenshot(base64, mimeType) {
  const r = await analyzeScreenshot(base64, mimeType,
    `Extract workout data from this Apple Fitness/Health app screenshot. Return ONLY valid JSON:
{"type":"<HIIT|Run|Walk|Cycle|Golf|Other>","duration":<minutes as integer>,"calories":<total calories as integer>,"hr":<avg heart rate BPM as integer>,"effort":<effort score 1-10 as integer or null if not shown>}`,
    "Extract the workout stats from this screenshot.");
  return { type: r.type || "HIIT", duration: parseInt(r.duration) || 0, calories: parseInt(r.calories) || 0, hr: parseInt(r.hr) || 0, effort: r.effort ? parseInt(r.effort) : null };
}

async function analyzeSleepScreenshot(base64, mimeType) {
  const r = await analyzeScreenshot(base64, mimeType,
    `Extract sleep data from this Oura Ring app screenshot. Return ONLY valid JSON:
{"hours":<total sleep in decimal hours, e.g. 7h 12m = 7.2>,"score":<sleep score or efficiency percentage as integer>}
Use Total Sleep for hours. Use Sleep Score if shown, otherwise use Efficiency %.`,
    "Extract the sleep stats from this screenshot.");
  return { hours: parseFloat(r.hours) || 0, score: parseInt(r.score) || 0 };
}

async function analyzeBodyScanScreenshot(base64, mimeType) {
  const r = await analyzeScreenshot(base64, mimeType,
    `Extract body composition data from this InBody scan screenshot. Return ONLY valid JSON:
{"weight":<lbs as decimal>,"smm":<skeletal muscle mass lbs as decimal>,"fatMass":<body fat mass lbs as decimal>,"inBodyScore":<score as integer or null>}`,
    "Extract the body scan stats from this screenshot.");
  return { weight: parseFloat(r.weight) || 0, smm: parseFloat(r.smm) || 0, fatMass: parseFloat(r.fatMass) || 0, inBodyScore: r.inBodyScore ? parseInt(r.inBodyScore) : null };
}

// ── Coaching functions ────────────────────────────────────────────────────
function buildHistorySummary(history) {
  return Object.entries(history)
    .filter(([, d]) => d.meals?.length || d.sleep || d.workout)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([date, d]) => {
      const s = sumDay(d.meals || []);
      const sleep = d.sleep ? `sleep ${d.sleep.hours}h/${d.sleep.score}` : "no sleep logged";
      const workout = d.workout ? `${d.workout.type} ${d.workout.calories}cal effort${d.workout.effort}` : "rest";
      return `${date.slice(5)}: protein ${s.protein}g cal ${s.calories} fiber ${s.fiber}g | ${sleep} | ${workout}`;
    }).join("\n");
}

async function getCoachingBrief(history, todayTotals, needed, profile) {
  const historySummary = buildHistorySummary(history);
  const scans = Object.entries(history).filter(([,d]) => d.bodyScan).sort(([a],[b]) => a.localeCompare(b));
  const latestScan = scans.length ? scans[scans.length-1][1].bodyScan : null;

  const prompt = `USER PROFILE:
Jimmy, 41M | Current: ${latestScan ? `${latestScan.weight}lbs, ${latestScan.smm}lb muscle, ${latestScan.fatMass}lb fat` : "166.9lbs, 81.4lb muscle, 24.9lb fat"}
Goals: Shredded Labor Day 2026 (~10-12% BF), Gorilla Summer 2027 (85-88lb SMM)
Daily targets: 165g protein, 2000-2100 cal, 35g fiber, 5g creatine
Meds: Zepbound tirzepatide — never push past fullness signals
Training: SixPax HIIT Mon/Wed/Fri, runs Tue/Thu

LAST 10 DAYS:
${historySummary}

TODAY SO FAR:
Protein: ${todayTotals.protein}g | Calories: ${todayTotals.calories} | Fiber: ${todayTotals.fiber}g
Still needed: ${needed.protein}g protein, ${needed.calories} cal, ${needed.fiber}g fiber

Analyze this data and respond ONLY with valid JSON:
{
  "todayStatus": "<2-3 sentences on how today is tracking and what to do to close it out>",
  "patterns": ["<pattern 1>", "<pattern 2>", "<pattern 3>"],
  "flags": ["<flag if any — skip array if none>"],
  "recommendation": "<one specific, actionable thing to do today or tomorrow>"
}`;

  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message || `API error ${resp.status}`); }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No response");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

async function getWeeklyReport(history) {
  const days = Object.entries(history)
    .filter(([, d]) => d.meals?.length || d.sleep || d.workout)
    .sort(([a], [b]) => a.localeCompare(b));

  const formatWeek = (weekDays) => weekDays.map(([date, d]) => {
    const s = sumDay(d.meals || []);
    const sleep = d.sleep ? `${d.sleep.hours}h sleep score ${d.sleep.score}` : "no sleep logged";
    const workout = d.workout ? `${d.workout.type} ${d.workout.calories}cal effort${d.workout.effort || "?"}` : "rest";
    return `  ${date.slice(5)}: protein ${s.protein}g, cal ${s.calories}, fiber ${s.fiber}g | ${sleep} | ${workout}`;
  }).join("\n");

  const week1 = days.filter(([d]) => d >= "2026-05-04" && d <= "2026-05-10");
  const week2 = days.filter(([d]) => d >= "2026-05-11" && d <= "2026-05-17");

  const avg = (weekDays, fn) => {
    const vals = weekDays.map(fn).filter(v => v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  const scans = Object.entries(history).filter(([,d]) => d.bodyScan).sort(([a],[b]) => a.localeCompare(b));
  const scanLines = scans.map(([date, d]) => `  ${date.slice(5)}: ${d.bodyScan.weight}lbs, ${d.bodyScan.smm}lb muscle, ${d.bodyScan.fatMass}lb fat${d.bodyScan.inBodyScore ? `, score ${d.bodyScan.inBodyScore}` : ""}`).join("\n");

  const prompt = `WEEKLY FITNESS REPORT — be direct, data-driven, no fluff.

USER: Jimmy, 41M | Goals: Shredded Labor Day 2026 (10-12% BF), Gorilla Summer 2027 (85-88lb SMM)
Targets: 165g protein, 2000-2100 cal, 35g fiber/day
Meds: Zepbound tirzepatide

WEEK 1 (May 4-10):
${formatWeek(week1)}
Averages: protein ${avg(week1, ([,d]) => sumDay(d.meals||[]).protein)}g, cal ${avg(week1, ([,d]) => sumDay(d.meals||[]).calories)}, fiber ${avg(week1, ([,d]) => sumDay(d.meals||[]).fiber)}g, sleep ${avg(week1, ([,d]) => d.sleep?.score||0)} score

WEEK 2 (May 11-17):
${formatWeek(week2)}
Averages: protein ${avg(week2, ([,d]) => sumDay(d.meals||[]).protein)}g, cal ${avg(week2, ([,d]) => sumDay(d.meals||[]).calories)}, fiber ${avg(week2, ([,d]) => sumDay(d.meals||[]).fiber)}g, sleep ${avg(week2, ([,d]) => d.sleep?.score||0)} score

BODY SCANS:
${scanLines || "  Baseline May 4: 165.2lbs, 79.6lb muscle, 27.0lb fat\n  May 16: 166.9lbs, 81.4lb muscle, 24.9lb fat"}

Respond ONLY with valid JSON:
{
  "headline": "<one punchy sentence summarizing Week 2 performance>",
  "weekComparison": "<2-3 sentences comparing week 1 vs week 2 across protein, calories, sleep>",
  "bodyComp": "<1-2 sentences on body comp progress and trajectory toward Labor Day>",
  "wins": ["<win 1>", "<win 2>", "<win 3>"],
  "fixes": ["<fix 1>", "<fix 2>"],
  "week3Focus": "<one specific focus for next week>"
}`;

  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message || `API error ${resp.status}`); }
  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No response");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

async function getMealNudge(todayTotals, needed, lastMealName) {
  const prompt = `FITNESS COACH — respond in ONE sentence, direct, no fluff.
User just logged: "${lastMealName}"
Today's totals now: ${todayTotals.protein}g protein, ${todayTotals.calories} cal, ${todayTotals.fiber}g fiber
Still needed to hit targets: ${needed.protein}g protein, ${needed.calories} cal, ${needed.fiber}g fiber
Targets: 165g protein, 2000-2100 cal, 35g fiber.
Meds: Zepbound — never suggest eating past fullness.

If targets are met or exceeded, say so briefly. Otherwise give one specific suggestion for what to eat next to close the gap. Be direct.`;

  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 150,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.content?.find(b => b.type === "text")?.text?.trim() || null;
}

// ── Claude before/after call ───────────────────────────────────────────────
async function analyzeBeforeAfter(b64Before, mimeBefore, b64After, mimeAfter) {
  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are a precise nutrition analyzer for a fitness tracking app.
The user is a 41yo male, 167 lbs, targeting 165g protein / 2100 cal / 35g fiber daily.
You will receive two photos of the same plate: the first is BEFORE eating, the second is AFTER.
Estimate ONLY what was actually consumed (the difference between the two photos).
Respond ONLY with valid JSON (no markdown, no explanation):
{"name":"<short meal name>","protein":<number>,"calories":<number>,"fiber":<number>,"notes":"<note what was left uneaten>"}`,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "BEFORE eating:" },
          { type: "image", source: { type: "base64", media_type: mimeBefore, data: b64Before } },
          { type: "text", text: "AFTER eating:" },
          { type: "image", source: { type: "base64", media_type: mimeAfter, data: b64After } },
          { type: "text", text: "Return JSON for only what was consumed." },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("No text in API response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    name: parsed.name || "Unknown meal",
    protein: Number(parsed.protein) || 0,
    calories: Number(parsed.calories) || 0,
    fiber: Number(parsed.fiber) || 0,
    notes: parsed.notes || "",
  };
}

// ── MacroRing ──────────────────────────────────────────────────────────────
function MacroRing({ label, value, target, color, unit = "g" }) {
  const p = pct(value, target);
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (p / 100) * circ;
  const over = value > target;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={88} height={88} viewBox="0 0 88 88">
        <circle cx={44} cy={44} r={r} fill="none" stroke="#1a1a1a" strokeWidth={8} />
        <circle
          cx={44} cy={44} r={r} fill="none"
          stroke={over ? "#ff4444" : color}
          strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x={44} y={40} textAnchor="middle" fill="#f5f2ed" fontSize={13} fontFamily="'DM Mono', monospace" fontWeight="500">
          {fmt(value)}
        </text>
        <text x={44} y={54} textAnchor="middle" fill="#666" fontSize={9} fontFamily="'DM Mono', monospace">
          /{target}{unit}
        </text>
      </svg>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

// ── MealRow ────────────────────────────────────────────────────────────────
function MealRow({ meal, onDelete }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 16px", background: "#141414", borderRadius: 6,
      borderLeft: "3px solid #c8f542", marginBottom: 8,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#f5f2ed", fontSize: 13, marginBottom: 4 }}>{meal.name}</div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888" }}>
          {meal.protein}g protein · {meal.calories} cal · {meal.fiber}g fiber
        </div>
        {meal.notes && <div style={{ fontSize: 11, color: "#555", marginTop: 3, fontStyle: "italic" }}>{meal.notes}</div>}
      </div>
      <button onClick={onDelete} style={{
        background: "none", border: "none", color: "#333", cursor: "pointer",
        fontSize: 18, padding: "0 4px", lineHeight: 1,
      }}>×</button>
    </div>
  );
}

// ── PhotoUpload ────────────────────────────────────────────────────────────
function PhotoUpload({ onAnalyzed, loading, setLoading }) {
  const fileRef = useRef();
  const [pendingFiles, setPendingFiles] = useState(null);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setPendingFiles(null);
    setLoading(true);
    try {
      const fileData = await Promise.all(Array.from(files).map(f => compressImage(f)));
      const results = await Promise.all(fileData.map(({ base64, mimeType }) => analyzeFoodPhoto(base64, mimeType)));
      onAnalyzed(results);
    } catch (err) {
      console.error(err);
      alert("Analysis failed: " + err.message + "\n\nUse manual entry instead.");
    } finally {
      setLoading(false);
    }
  };

  const handleBeforeAfter = async (files) => {
    setPendingFiles(null);
    setLoading(true);
    try {
      const [f1, f2] = await Promise.all([compressImage(files[0]), compressImage(files[1])]);
      const result = await analyzeBeforeAfter(f1.base64, f1.mimeType, f2.base64, f2.mimeType);
      onAnalyzed([result]);
    } catch (err) {
      console.error(err);
      alert("Analysis failed: " + err.message + "\n\nUse manual entry instead.");
    } finally {
      setLoading(false);
    }
  };

  const onFileChange = (e) => {
    const files = e.target.files;
    if (files.length === 2) {
      setPendingFiles(files);
    } else {
      handleFiles(files);
    }
    e.target.value = "";
  };

  return (
    <div>
      <input
        ref={fileRef} type="file" accept="image/*" multiple
        style={{ display: "none" }}
        onChange={onFileChange}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        style={{
          width: "100%", padding: "16px", background: loading ? "#1a1a1a" : "#c8f542",
          border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.05em",
          color: loading ? "#888" : "#0a0a0a", transition: "all 0.2s",
        }}
      >
        {loading ? "ANALYZING..." : "📸 LOG FOOD PHOTO"}
      </button>
      {pendingFiles && (
        <div style={{ marginTop: 8, background: "#141414", border: "1px solid #333", borderRadius: 8, padding: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
            2 PHOTOS SELECTED
          </div>
          <div style={{ fontSize: 13, color: "#f5f2ed", marginBottom: 12 }}>
            Same plate before &amp; after?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleBeforeAfter(pendingFiles)} style={{
              flex: 1, padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a", letterSpacing: "0.1em",
            }}>BEFORE &amp; AFTER</button>
            <button onClick={() => handleFiles(pendingFiles)} style={{
              flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em",
            }}>SEPARATE MEALS</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TextEntry ─────────────────────────────────────────────────────────────
function TextEntry({ onAnalyzed }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!description.trim()) return;
    setLoading(true);
    try {
      const result = await analyzeTextDescription(description.trim());
      onAnalyzed([result]);
      setDescription("");
      setOpen(false);
    } catch (err) {
      console.error(err);
      alert("Analysis failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); analyze(); }
  };

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", padding: "12px", background: "transparent",
        border: "1px solid #2a2a2a", borderRadius: 6, cursor: "pointer",
        fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888",
        letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 8,
      }}>
        {open ? "CANCEL" : "✏️ DESCRIBE MEAL"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea
            autoFocus
            placeholder="e.g. grilled salmon fillet, half cup of rice, side salad"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            style={{
              width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 4, padding: "10px 12px", color: "#f5f2ed", fontSize: 13,
              fontFamily: "'DM Sans', sans-serif", resize: "none", boxSizing: "border-box",
            }}
          />
          <button onClick={analyze} disabled={loading || !description.trim()} style={{
            width: "100%", marginTop: 6, padding: "12px", background: loading ? "#1a1a1a" : "#2a2a2a",
            border: "none", borderRadius: 4, cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "'DM Mono', monospace", fontSize: 11, color: loading ? "#555" : "#c8f542",
            letterSpacing: "0.15em", textTransform: "uppercase",
          }}>
            {loading ? "ANALYZING..." : "ESTIMATE MACROS →"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ManualEntry ────────────────────────────────────────────────────────────
function ManualEntry({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", protein: "", calories: "", fiber: "" });

  const submit = () => {
    if (!form.name || !form.protein || !form.calories) return;
    onAdd({
      name: form.name,
      protein: parseFloat(form.protein) || 0,
      calories: parseFloat(form.calories) || 0,
      fiber: parseFloat(form.fiber) || 0,
      notes: "",
    });
    setForm({ name: "", protein: "", calories: "", fiber: "" });
    setOpen(false);
  };

  const inp = (field, placeholder) => (
    <input
      type={field === "name" ? "text" : "number"}
      placeholder={placeholder}
      value={form[field]}
      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
      style={{
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4,
        padding: "10px 12px", color: "#f5f2ed", fontSize: 13,
        fontFamily: "'DM Sans', sans-serif", width: "100%", boxSizing: "border-box",
      }}
    />
  );

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", padding: "12px", background: "transparent",
        border: "1px solid #2a2a2a", borderRadius: 6, cursor: "pointer",
        fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888",
        letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 8,
      }}>
        {open ? "CANCEL" : "+ MANUAL ENTRY"}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {inp("name", "Meal name")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {inp("protein", "Protein g")}
            {inp("calories", "Calories")}
            {inp("fiber", "Fiber g")}
          </div>
          <button onClick={submit} style={{
            padding: "12px", background: "#2a2a2a", border: "none", borderRadius: 6,
            color: "#c8f542", cursor: "pointer", fontFamily: "'DM Mono', monospace",
            fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase",
          }}>ADD MEAL</button>
        </div>
      )}
    </div>
  );
}

// ── SleepWorkout Logger ────────────────────────────────────────────────────
function MetaLogger({ day, onUpdate }) {
  const [sleepOpen, setSleepOpen] = useState(false);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [sleepScanning, setSleepScanning] = useState(false);
  const [workoutScanning, setWorkoutScanning] = useState(false);
  const [sleep, setSleep] = useState({ hours: "", score: "" });
  const [workout, setWorkout] = useState({ type: "HIIT", duration: "", calories: "", hr: "", effort: "" });
  const sleepFileRef = useRef();
  const workoutFileRef = useRef();

  const scanSleep = async (file) => {
    if (!file) return;
    setSleepScanning(true);
    try {
      const { base64, mimeType } = await compressImage(file);
      const r = await analyzeSleepScreenshot(base64, mimeType);
      setSleep({ hours: String(r.hours), score: String(r.score) });
      setSleepOpen(true);
    } catch (err) { alert("Scan failed: " + err.message); }
    finally { setSleepScanning(false); sleepFileRef.current.value = ""; }
  };

  const scanWorkout = async (file) => {
    if (!file) return;
    setWorkoutScanning(true);
    try {
      const { base64, mimeType } = await compressImage(file);
      const r = await analyzeWorkoutScreenshot(base64, mimeType);
      setWorkout({ type: r.type, duration: String(r.duration), calories: String(r.calories), hr: String(r.hr), effort: r.effort ? String(r.effort) : "" });
      setWorkoutOpen(true);
    } catch (err) { alert("Scan failed: " + err.message); }
    finally { setWorkoutScanning(false); workoutFileRef.current.value = ""; }
  };

  const saveSleep = () => {
    onUpdate({ sleep: { hours: parseFloat(sleep.hours), score: parseInt(sleep.score) } });
    setSleepOpen(false);
  };

  const saveWorkout = () => {
    onUpdate({ workout: { ...workout, duration: parseInt(workout.duration), calories: parseInt(workout.calories), hr: parseInt(workout.hr), effort: parseInt(workout.effort) } });
    setWorkoutOpen(false);
  };

  const inp = (val, setter, placeholder, type = "number") => (
    <input type={type} placeholder={placeholder} value={val}
      onChange={e => setter(e.target.value)}
      style={{
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4,
        padding: "10px 12px", color: "#f5f2ed", fontSize: 13,
        fontFamily: "'DM Sans', sans-serif", flex: 1, minWidth: 0,
      }}
    />
  );

  const scanBtn = (loading, label) => ({
    padding: "10px", background: loading ? "#1a1a1a" : "#0a1a0a",
    border: "1px solid #c8f542", borderRadius: 4, cursor: loading ? "not-allowed" : "pointer",
    fontFamily: "'DM Mono', monospace", fontSize: 10, color: loading ? "#555" : "#c8f542",
    letterSpacing: "0.1em", whiteSpace: "nowrap",
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <input ref={sleepFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => scanSleep(e.target.files[0])} />
      <input ref={workoutFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => scanWorkout(e.target.files[0])} />

      {/* Button row — always side by side */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={() => { setSleepOpen(o => !o); setWorkoutOpen(false); }} style={{
          flex: 1, padding: "10px", background: day.sleep ? "#1a2a1a" : "#1a1a1a",
          border: `1px solid ${day.sleep ? "#c8f542" : "#2a2a2a"}`, borderRadius: 6,
          cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: day.sleep ? "#c8f542" : "#888", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>{day.sleep ? `😴 ${day.sleep.hours}h · ${day.sleep.score}` : "😴 SLEEP"}</button>
        <button onClick={() => sleepFileRef.current?.click()} style={scanBtn(sleepScanning)}>
          {sleepScanning ? "..." : "📸"}
        </button>
        <button onClick={() => { setWorkoutOpen(o => !o); setSleepOpen(false); }} style={{
          flex: 1, padding: "10px", background: day.workout ? "#1a2a1a" : "#1a1a1a",
          border: `1px solid ${day.workout ? "#c8f542" : "#2a2a2a"}`, borderRadius: 6,
          cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: day.workout ? "#c8f542" : "#888", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>{day.workout ? `💪 ${day.workout.calories}cal` : "💪 WORKOUT"}</button>
        <button onClick={() => workoutFileRef.current?.click()} style={scanBtn(workoutScanning)}>
          {workoutScanning ? "..." : "📸"}
        </button>
      </div>

      {/* Sleep form — full width below buttons */}
      {sleepOpen && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {inp(sleep.hours, v => setSleep(s => ({ ...s, hours: v })), "Hours")}
          {inp(sleep.score, v => setSleep(s => ({ ...s, score: v })), "Score")}
          <button onClick={saveSleep} style={{
            padding: "10px 14px", background: "#c8f542", border: "none", borderRadius: 4,
            cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a",
          }}>✓</button>
        </div>
      )}

      {/* Workout form — full width below buttons */}
      {workoutOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select value={workout.type} onChange={e => setWorkout(w => ({ ...w, type: e.target.value }))}
            style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4, padding: "10px 12px", color: "#f5f2ed", fontSize: 13 }}>
            <option>HIIT</option><option>Run</option><option>Golf</option><option>Rest</option>
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            {inp(workout.duration, v => setWorkout(w => ({ ...w, duration: v })), "Mins")}
            {inp(workout.calories, v => setWorkout(w => ({ ...w, calories: v })), "Cal")}
            {inp(workout.hr, v => setWorkout(w => ({ ...w, hr: v })), "BPM")}
            {inp(workout.effort, v => setWorkout(w => ({ ...w, effort: v })), "Effort")}
          </div>
          <button onClick={saveWorkout} style={{
            padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
            cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a",
          }}>SAVE WORKOUT</button>
        </div>
      )}
    </div>
  );
}

// ── WeeklyReport ───────────────────────────────────────────────────────────
function WeeklyReport({ history }) {
  const days = Object.values(history).slice(-7);
  if (days.length === 0) return <div style={{ color: "#555", textAlign: "center", padding: 40 }}>No data yet</div>;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #222" }}>
              {["Date", "Protein", "Calories", "Fiber", "Sleep", "Workout"].map(h => (
                <th key={h} style={{ padding: "8px 12px", color: "#888", textAlign: "left", letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map(day => {
              const s = sumDay(day.meals || []);
              const pOk = s.protein >= TARGETS.protein;
              const cOk = s.calories <= TARGETS.calories;
              const fOk = s.fiber >= TARGETS.fiber;
              return (
                <tr key={day.date} style={{ borderBottom: "1px solid #1a1a1a" }}>
                  <td style={{ padding: "10px 12px", color: "#888" }}>{day.date.slice(5)}</td>
                  <td style={{ padding: "10px 12px", color: pOk ? "#c8f542" : "#ff4444" }}>{fmt(s.protein)}g</td>
                  <td style={{ padding: "10px 12px", color: cOk ? "#c8f542" : "#f5a623" }}>{fmt(s.calories)}</td>
                  <td style={{ padding: "10px 12px", color: fOk ? "#c8f542" : "#f5a623" }}>{fmt(s.fiber)}g</td>
                  <td style={{ padding: "10px 12px", color: "#888" }}>{day.sleep ? `${day.sleep.hours}h` : "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#888" }}>{day.workout ? `${day.workout.type} ${day.workout.calories}cal` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Body comp progress */}
      <div style={{ marginTop: 24, padding: 16, background: "#141414", borderRadius: 8 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Body Comp Progress (vs May 4 baseline)
        </div>
        {[
          { label: "Weight", base: 165.2, curr: PROFILE.weight, unit: "lbs", lower: false },
          { label: "Body Fat", base: 27.0, curr: 24.9, unit: "lbs", lower: true },
          { label: "Muscle", base: 79.6, curr: PROFILE.smm, unit: "lbs", lower: false },
        ].map(({ label, base, curr, unit, lower }) => {
          const delta = curr - base;
          const good = lower ? delta < 0 : delta > 0;
          return (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "#888", fontSize: 12 }}>{label}</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: good ? "#c8f542" : "#ff4444" }}>
                {curr}{unit} ({delta > 0 ? "+" : ""}{delta.toFixed(1)})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AnalyzedCard ───────────────────────────────────────────────────────────
function AnalyzedCard({ item, index, total, onConfirm, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [form, setForm] = useState({ name: item.name, protein: item.protein, calories: item.calories, fiber: item.fiber });

  const recalculate = async () => {
    if (!form.name.trim()) return;
    setRecalculating(true);
    try {
      const result = await analyzeTextDescription(form.name.trim());
      setForm({ name: form.name, protein: result.protein, calories: result.calories, fiber: result.fiber });
    } catch (err) {
      alert("Recalculation failed: " + err.message);
    } finally {
      setRecalculating(false);
    }
  };

  const save = () => {
    onConfirm({
      ...item,
      name: form.name || item.name,
      protein: parseFloat(form.protein) || 0,
      calories: parseFloat(form.calories) || 0,
      fiber: parseFloat(form.fiber) || 0,
    });
  };

  const inp = (field, placeholder) => (
    <input
      type={field === "name" ? "text" : "number"}
      placeholder={placeholder}
      value={form[field]}
      onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
      style={{
        background: "#0a0a0a", border: "1px solid #333", borderRadius: 4,
        padding: "8px 10px", color: "#f5f2ed", fontSize: 13,
        fontFamily: "'DM Sans', sans-serif", width: "100%", boxSizing: "border-box",
      }}
    />
  );

  return (
    <div style={{ background: "#141414", border: "1px solid #c8f542", borderRadius: 8, padding: 16, marginBottom: 8 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#c8f542", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
        DETECTED {total > 1 ? `${index + 1}/${total}` : ""}
      </div>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>{inp("name", "Meal name")}</div>
            <button onClick={recalculate} disabled={recalculating} style={{
              padding: "8px 12px", background: recalculating ? "#1a1a1a" : "#1a2a1a",
              border: "1px solid #c8f542", borderRadius: 4, cursor: recalculating ? "not-allowed" : "pointer",
              fontFamily: "'DM Mono', monospace", fontSize: 10, color: recalculating ? "#555" : "#c8f542",
              letterSpacing: "0.1em", whiteSpace: "nowrap",
            }}>{recalculating ? "..." : "↻ RECALC"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {inp("protein", "Protein g")}
            {inp("calories", "Calories")}
            {inp("fiber", "Fiber g")}
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 15, color: "#f5f2ed", marginBottom: 6 }}>{item.name}</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", marginBottom: 12 }}>
            {item.protein}g protein · {item.calories} cal · {item.fiber}g fiber
          </div>
          {item.notes && <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginBottom: 12 }}>{item.notes}</div>}
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {editing ? (
          <>
            <button onClick={save} style={{
              flex: 2, padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a", letterSpacing: "0.1em",
            }}>CONFIRM</button>
            <button onClick={() => setEditing(false)} style={{
              flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em",
            }}>BACK</button>
          </>
        ) : (
          <>
            <button onClick={() => onConfirm(item)} style={{
              flex: 2, padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a", letterSpacing: "0.1em",
            }}>CONFIRM</button>
            <button onClick={() => setEditing(true)} style={{
              flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #444", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#c8f542", letterSpacing: "0.1em",
            }}>EDIT</button>
            <button onClick={onDismiss} style={{
              flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em",
            }}>DISMISS</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── ProfileTab ─────────────────────────────────────────────────────────────
function ProfileTab({ history, onScan }) {
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState(null);
  const fileRef = useRef();

  const scans = Object.entries(history)
    .filter(([, d]) => d.bodyScan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d.bodyScan }));

  const baseline = scans[0] || { weight: 165.2, smm: 79.6, fatMass: 27.0 };
  const latest = scans[scans.length - 1] || baseline;

  const fatDelta = (latest.fatMass - baseline.fatMass).toFixed(1);
  const smmDelta = (latest.smm - baseline.smm).toFixed(1);

  const handleScanFile = async (file) => {
    if (!file) return;
    setScanning(true);
    try {
      const { base64, mimeType } = await compressImage(file);
      const r = await analyzeBodyScanScreenshot(base64, mimeType);
      setForm({ date: TODAY_KEY(), ...r });
    } catch (err) { alert("Scan failed: " + err.message); }
    finally { setScanning(false); fileRef.current.value = ""; }
  };

  const saveForm = () => {
    if (!form) return;
    onScan(form.date, { weight: parseFloat(form.weight), smm: parseFloat(form.smm), fatMass: parseFloat(form.fatMass), inBodyScore: form.inBodyScore ? parseInt(form.inBodyScore) : null });
    setForm(null);
  };

  const inp = (field, label) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#555", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <input type="number" value={form?.[field] ?? ""} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        style={{ width: "100%", background: "#0a0a0a", border: "1px solid #333", borderRadius: 4, padding: "8px 10px", color: "#f5f2ed", fontSize: 13, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleScanFile(e.target.files[0])} />

      {/* Targets */}
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, marginBottom: 16 }}>Body Stats</div>
      {[
        { label: "Protein Target", val: "165g/day" },
        { label: "Calorie Target", val: "2,000–2,100/day" },
        { label: "Fiber Target", val: "35g/day" },
        { label: "Shredded By", val: PROFILE.shredded, color: "#c8f542" },
        { label: "Gorilla By", val: PROFILE.gorilla, color: "#c8f542" },
      ].map(({ label, val, color }) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a1a1a" }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
          <span style={{ fontSize: 14, color: color || "#f5f2ed" }}>{val}</span>
        </div>
      ))}

      {/* Progress */}
      <div style={{ marginTop: 20, padding: 16, background: "#141414", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
          Progress vs Baseline
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "Weight", val: `${latest.weight} lbs` },
            { label: "Fat Lost", val: `${fatDelta > 0 ? "+" : ""}${fatDelta} lbs`, color: fatDelta < 0 ? "#c8f542" : "#ff4444" },
            { label: "Muscle", val: `${smmDelta > 0 ? "+" : ""}${smmDelta} lbs`, color: smmDelta > 0 ? "#c8f542" : "#ff4444" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: color || "#f5f2ed", lineHeight: 1 }}>{val}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#555", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
        {latest.inBodyScore && (
          <div style={{ textAlign: "center", marginTop: 12, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888" }}>
            InBody Score: <span style={{ color: "#c8f542" }}>{latest.inBodyScore}</span>
          </div>
        )}
      </div>

      {/* Log scan */}
      <button onClick={() => fileRef.current?.click()} disabled={scanning} style={{
        width: "100%", padding: "14px", background: scanning ? "#1a1a1a" : "#0a1a0a",
        border: "1px solid #c8f542", borderRadius: 6, cursor: scanning ? "not-allowed" : "pointer",
        fontFamily: "'DM Mono', monospace", fontSize: 11, color: scanning ? "#555" : "#c8f542",
        letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8,
      }}>{scanning ? "SCANNING..." : "📸 SCAN INBODY SCREENSHOT"}</button>

      {form && (
        <div style={{ background: "#141414", border: "1px solid #c8f542", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#c8f542", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>DETECTED</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {inp("weight", "Weight (lbs)")}
            {inp("smm", "Muscle (lbs)")}
            {inp("fatMass", "Fat (lbs)")}
            {inp("inBodyScore", "Score")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveForm} style={{
              flex: 2, padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a", letterSpacing: "0.1em",
            }}>SAVE SCAN</button>
            <button onClick={() => setForm(null)} style={{
              flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em",
            }}>DISMISS</button>
          </div>
        </div>
      )}

      {/* Scan history */}
      {scans.length > 0 && (
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Scan History</div>
          {[...scans].reverse().map(s => (
            <div key={s.date} style={{ background: "#141414", borderRadius: 6, padding: "10px 14px", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#555" }}>{s.date.slice(5)}</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#f5f2ed" }}>{s.weight}lbs · {s.smm}lb muscle · {s.fatMass}lb fat</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CoachTab ───────────────────────────────────────────────────────────────
function CoachTab({ history, todayTotals, needed }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await getCoachingBrief(history, todayTotals, needed, PROFILE);
      setBrief(result);
    } catch (err) {
      alert("Coach failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateWeekly = async () => {
    setWeeklyLoading(true);
    try {
      const result = await getWeeklyReport(history);
      setWeeklyReport(result);
    } catch (err) {
      alert("Weekly report failed: " + err.message);
    } finally {
      setWeeklyLoading(false);
    }
  };

  const section = (label, color, items) => (
    <div style={{ background: "#141414", borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      {Array.isArray(items)
        ? items.map((item, i) => (
          <div key={i} style={{ fontSize: 13, color: "#f5f2ed", marginBottom: i < items.length - 1 ? 6 : 0, paddingLeft: 8, borderLeft: `2px solid ${color}` }}>{item}</div>
        ))
        : <div style={{ fontSize: 13, color: "#f5f2ed", lineHeight: 1.5 }}>{items}</div>
      }
    </div>
  );

  return (
    <div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, marginBottom: 4 }}>Coach</div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 20 }}>Analyzes your food, sleep, workouts, and trends against your goals.</div>

      <button onClick={generate} disabled={loading} style={{
        width: "100%", padding: "16px", background: loading ? "#1a1a1a" : "#c8f542",
        border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.05em",
        color: loading ? "#888" : "#0a0a0a", marginBottom: 12,
      }}>
        {loading ? "ANALYZING YOUR DATA..." : brief ? "↻ REFRESH BRIEF" : "GENERATE COACHING BRIEF"}
      </button>

      <button onClick={generateWeekly} disabled={weeklyLoading} style={{
        width: "100%", padding: "16px", background: weeklyLoading ? "#1a1a1a" : "#1a1a0a",
        border: "1px solid #c8f542", borderRadius: 6, cursor: weeklyLoading ? "not-allowed" : "pointer",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.05em",
        color: weeklyLoading ? "#888" : "#c8f542", marginBottom: 20,
      }}>
        {weeklyLoading ? "BUILDING REPORT..." : weeklyReport ? "↻ REFRESH WEEKLY REPORT" : "WEEKLY REPORT"}
      </button>

      {brief && (
        <>
          {section("Today", "#5599ff", brief.todayStatus)}
          {brief.flags?.length > 0 && section("Flags", "#ff4444", brief.flags)}
          {section("Patterns", "#f5a623", brief.patterns)}
          {section("Recommendation", "#c8f542", brief.recommendation)}
        </>
      )}

      {weeklyReport && (
        <div style={{ marginTop: brief ? 24 : 0 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#555", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>Weekly Report</div>
          <div style={{ background: "#141414", borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: "3px solid #c8f542" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#c8f542", lineHeight: 1.2 }}>{weeklyReport.headline}</div>
          </div>
          {section("Week vs Week", "#5599ff", weeklyReport.weekComparison)}
          {section("Body Composition", "#ff9500", weeklyReport.bodyComp)}
          {weeklyReport.wins?.length > 0 && section("Wins", "#c8f542", weeklyReport.wins)}
          {weeklyReport.fixes?.length > 0 && section("Fix These", "#ff4444", weeklyReport.fixes)}
          {section("Week 3 Focus", "#aa88ff", weeklyReport.week3Focus)}
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function GorillaTracker() {
  const [tab, setTab] = useState("today");
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(null);
  const [nudge, setNudge] = useState(null);
  const [storageReady, setStorageReady] = useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gorilla-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
    setStorageReady(true);
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (!storageReady) return;
    try { localStorage.setItem("gorilla-history", JSON.stringify(history)); } catch {}
  }, [history, storageReady]);

  const todayKey = TODAY_KEY();
  const today = history[todayKey] || EMPTY_DAY();
  const totals = sumDay(today.meals || []);

  const updateToday = (patch) => {
    setHistory(h => ({
      ...h,
      [todayKey]: { ...EMPTY_DAY(), ...(h[todayKey] || {}), ...patch },
    }));
  };

  const pushMeal = (meal) => {
    setHistory(h => {
      const existing = h[todayKey] || EMPTY_DAY();
      return { ...h, [todayKey]: { ...existing, meals: [...(existing.meals || []), { ...meal, id: Date.now() }] } };
    });
  };

  const addMeal = (meal) => {
    pushMeal(meal);
    setAnalyzed(null);
  };

  const deleteMeal = (id) => {
    updateToday({ meals: today.meals.filter(m => m.id !== id) });
  };

  const onAnalyzed = (results) => {
    setAnalyzed(results);
  };

  const dismissOne = (i) => setAnalyzed(a => a.filter((_, j) => j !== i));

  const triggerNudge = (meal, updatedTotals) => {
    const updatedNeeded = {
      protein: Math.max(0, TARGETS.protein - updatedTotals.protein),
      calories: Math.max(0, TARGETS.calories - updatedTotals.calories),
      fiber: Math.max(0, TARGETS.fiber - updatedTotals.fiber),
    };
    getMealNudge(updatedTotals, updatedNeeded, meal.name).then(msg => { if (msg) setNudge(msg); });
  };

  const confirmOne = (i) => {
    const meal = analyzed[i];
    const currentMeals = today.meals || [];
    const updatedTotals = sumDay([...currentMeals, meal]);
    pushMeal(meal);
    dismissOne(i);
    triggerNudge(meal, updatedTotals);
  };

  const confirmAll = () => {
    const allMeals = analyzed;
    const updatedTotals = sumDay([...(today.meals || []), ...allMeals]);
    allMeals.forEach(pushMeal);
    setAnalyzed(null);
    triggerNudge({ name: `${allMeals.length} meals` }, updatedTotals);
  };

  const needed = {
    protein: Math.max(0, TARGETS.protein - totals.protein),
    calories: Math.max(0, TARGETS.calories - totals.calories),
    fiber: Math.max(0, TARGETS.fiber - totals.fiber),
  };

  const TABS = ["today", "coach", "history", "profile", "import"];

  const HISTORICAL_DATA = {
    "2026-05-04": { date: "2026-05-04", meals: [{ id: 1, name: "Eggs + chicken + shake", protein: 69, calories: 590, fiber: 3, notes: "Post-HIIT" }, { id: 2, name: "Kale salad + salmon (Bluey's)", protein: 40, calories: 570, fiber: 8, notes: "" }, { id: 3, name: "Cottage cheese", protein: 19, calories: 180, fiber: 0, notes: "" }, { id: 4, name: "Salmon + miracle noodles + asparagus", protein: 38, calories: 410, fiber: 4, notes: "" }, { id: 5, name: "Chobani + Chomps", protein: 30, calories: 250, fiber: 0, notes: "" }], sleep: { hours: 4.4, score: 59 }, workout: { type: "HIIT", duration: 27, calories: 226, hr: 123, effort: 4 } },
    "2026-05-05": { date: "2026-05-05", meals: [{ id: 10, name: "Eggs + chicken + shake", protein: 69, calories: 590, fiber: 3, notes: "" }, { id: 11, name: "Kale salad + salmon (Bluey's)", protein: 40, calories: 570, fiber: 8, notes: "" }, { id: 12, name: "Sashimi + roll + miso", protein: 54, calories: 670, fiber: 2, notes: "" }, { id: 13, name: "Chobani shake", protein: 20, calories: 150, fiber: 0, notes: "" }], sleep: { hours: 5.97, score: 74 }, workout: { type: "Run", duration: 26, calories: 262, hr: 123, effort: 5 } },
    "2026-05-06": { date: "2026-05-06", meals: [{ id: 20, name: "Eggs + chicken + shake", protein: 70, calories: 590, fiber: 3, notes: "" }, { id: 21, name: "Kale salad + salmon (Bluey's)", protein: 40, calories: 570, fiber: 8, notes: "" }, { id: 22, name: "Oikos Pro", protein: 20, calories: 150, fiber: 0, notes: "" }, { id: 23, name: "Double burger + bacon + sweet potato fries", protein: 60, calories: 1150, fiber: 5, notes: "" }], sleep: { hours: 6.58, score: 75 }, workout: { type: "HIIT", duration: 30, calories: 284, hr: 127, effort: 8 } },
    "2026-05-07": { date: "2026-05-07", meals: [{ id: 30, name: "Eggs + chicken + shake", protein: 70, calories: 590, fiber: 3, notes: "" }, { id: 31, name: "Kale salad + salmon (Bluey's)", protein: 40, calories: 570, fiber: 8, notes: "" }, { id: 32, name: "Oikos Pro", protein: 20, calories: 150, fiber: 0, notes: "" }, { id: 33, name: "Salmon + noodles + asparagus", protein: 42, calories: 500, fiber: 4, notes: "" }, { id: 34, name: "Clams x2 portions", protein: 30, calories: 400, fiber: 0, notes: "" }], sleep: { hours: 6.07, score: 71 }, workout: { type: "Run", duration: 28, calories: 278, hr: 164, effort: 6 } },
    "2026-05-08": { date: "2026-05-08", meals: [{ id: 40, name: "Eggs + shake", protein: 45, calories: 440, fiber: 3, notes: "" }, { id: 41, name: "Kale salad + salmon (Bluey's)", protein: 40, calories: 570, fiber: 8, notes: "" }, { id: 42, name: "Sashimi + roll + miso", protein: 54, calories: 670, fiber: 2, notes: "" }, { id: 43, name: "Cocktails + whiskey", protein: 0, calories: 300, fiber: 0, notes: "" }], sleep: { hours: 6.07, score: 75 }, workout: null },
    "2026-05-09": { date: "2026-05-09", meals: [{ id: 50, name: "Cottage cheese omelette + shake", protein: 60, calories: 600, fiber: 3, notes: "" }, { id: 51, name: "Oikos Pro", protein: 20, calories: 150, fiber: 0, notes: "" }, { id: 52, name: "Party taco", protein: 15, calories: 250, fiber: 2, notes: "" }, { id: 53, name: "Erewhon sashimi + protein bite", protein: 30, calories: 400, fiber: 1, notes: "" }, { id: 54, name: "Miso cod + pizza + popcorn + Chomps", protein: 71, calories: 1100, fiber: 2, notes: "" }], sleep: { hours: 8.47, score: 75 }, workout: { type: "HIIT", duration: 30, calories: 280, hr: 125, effort: 6 } },
    "2026-05-10": { date: "2026-05-10", meals: [{ id: 60, name: "1 egg + 3 whites + Chobani", protein: 42, calories: 280, fiber: 0, notes: "" }, { id: 61, name: "Remedy Pro Power shake", protein: 35, calories: 230, fiber: 6, notes: "" }, { id: 62, name: "Osteria lunch - eggs + crab + pizza + wine", protein: 57, calories: 1110, fiber: 3, notes: "" }, { id: 63, name: "Short rib + pizza + Chomps", protein: 42, calories: 870, fiber: 1, notes: "" }], sleep: { hours: 6.07, score: 71 }, workout: null },
    "2026-05-11": { date: "2026-05-11", meals: [{ id: 70, name: "Burrito + Chobani shake", protein: 68, calories: 800, fiber: 4, notes: "Travel day" }, { id: 71, name: "Chomps + half plane pizza", protein: 20, calories: 300, fiber: 1, notes: "" }, { id: 72, name: "Steak frites Vancouver (half)", protein: 55, calories: 650, fiber: 3, notes: "Got sick" }], sleep: { hours: 4.37, score: 59 }, workout: null },
    "2026-05-12": { date: "2026-05-12", meals: [{ id: 80, name: "Hotel eggs + bacon (partial)", protein: 20, calories: 400, fiber: 1, notes: "Recovery" }, { id: 81, name: "Sashimi + edamame", protein: 25, calories: 240, fiber: 5, notes: "" }, { id: 82, name: "Lobster salad + margarita", protein: 25, calories: 550, fiber: 3, notes: "" }, { id: 83, name: "More sashimi + roll", protein: 25, calories: 430, fiber: 1, notes: "" }], sleep: { hours: 5.37, score: 74 }, workout: null },
    "2026-05-13": { date: "2026-05-13", meals: [{ id: 90, name: "Hotel room service eggs + bacon", protein: 28, calories: 550, fiber: 1, notes: "" }, { id: 91, name: "Mini quiches x2", protein: 6, calories: 150, fiber: 0, notes: "" }, { id: 92, name: "Sashimi x2 + extra salmon", protein: 55, calories: 440, fiber: 0, notes: "" }, { id: 93, name: "Joe and Juice smoothie + protein", protein: 40, calories: 380, fiber: 6, notes: "" }, { id: 94, name: "SFO sashimi + miso", protein: 35, calories: 280, fiber: 1, notes: "" }, { id: 95, name: "Air Canada chicken stew + bread", protein: 23, calories: 380, fiber: 1, notes: "" }], sleep: { hours: 6.97, score: 75 }, workout: null },
    "2026-05-14": { date: "2026-05-14", meals: [{ id: 100, name: "Steak and eggs - Baltimore", protein: 58, calories: 750, fiber: 1, notes: "" }, { id: 101, name: "Plug smoothies x2", protein: 10, calories: 400, fiber: 4, notes: "" }, { id: 102, name: "Pretzel roll + butter", protein: 5, calories: 200, fiber: 1, notes: "" }, { id: 103, name: "Ribeye + wine + cocktail", protein: 65, calories: 1050, fiber: 0, notes: "The Civilized Steakhouse" }], sleep: { hours: 1.6, score: 45 }, workout: null },
    "2026-05-15": { date: "2026-05-15", meals: [{ id: 110, name: "Chick-fil-A Egg White Grills x2", protein: 50, calories: 600, fiber: 4, notes: "" }, { id: 111, name: "Hippeas", protein: 3, calories: 100, fiber: 3, notes: "" }, { id: 112, name: "Kale salad + salmon (Bluey's)", protein: 39, calories: 515, fiber: 7, notes: "" }, { id: 113, name: "Chobani protein drink", protein: 20, calories: 140, fiber: 2, notes: "" }, { id: 114, name: "Steak frites + pizza + margaritas x3", protein: 48, calories: 1600, fiber: 5, notes: "" }], sleep: { hours: 6.43, score: 73 }, workout: null },
    "2026-05-16": { date: "2026-05-16", meals: [{ id: 120, name: "3 eggs + ground chicken + chia berry shake", protein: 73, calories: 760, fiber: 18, notes: "Post-SixPax" }, { id: 121, name: "Bowl Formerly Known As + bacon (Bluey's)", protein: 26, calories: 620, fiber: 10, notes: "" }, { id: 122, name: "Chobani protein drink", protein: 20, calories: 140, fiber: 2, notes: "" }], sleep: { hours: 6.43, score: 86 }, workout: { type: "HIIT", duration: 30, calories: 300, hr: 132, effort: 7 } },
  };

  return (
    <div style={{
      background: "#0a0a0a", minHeight: "100vh", color: "#f5f2ed",
      fontFamily: "'DM Sans', sans-serif",
      paddingBottom: 80,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "24px 20px 16px", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#c8f542", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
          Shredded Gorilla Program
        </div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, lineHeight: 1 }}>
          {PROFILE.name}'s Tracker
        </div>
        <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "12px", background: "none", border: "none",
            borderBottom: tab === t ? "2px solid #c8f542" : "2px solid transparent",
            color: tab === t ? "#c8f542" : "#555", cursor: "pointer",
            fontFamily: "'DM Mono', monospace", fontSize: 10,
            letterSpacing: "0.15em", textTransform: "uppercase", transition: "all 0.2s",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: "20px" }}>

        {/* TODAY TAB */}
        {tab === "today" && (
          <div>
            {/* Macro rings */}
            <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 24 }}>
              <MacroRing label="Protein" value={totals.protein} target={TARGETS.protein} color="#c8f542" />
              <MacroRing label="Calories" value={totals.calories} target={TARGETS.calories} color="#5599ff" unit="" />
              <MacroRing label="Fiber" value={totals.fiber} target={TARGETS.fiber} color="#f5a623" />
            </div>

            {/* Still needed */}
            <div style={{ background: "#141414", borderRadius: 8, padding: "12px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between" }}>
              {[
                { label: "Protein left", val: needed.protein, unit: "g", color: "#c8f542" },
                { label: "Cal left", val: needed.calories, unit: "", color: "#5599ff" },
                { label: "Fiber left", val: needed.fiber, unit: "g", color: "#f5a623" },
              ].map(({ label, val, unit, color }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color, lineHeight: 1 }}>{fmt(val)}{unit}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Sleep + Workout */}
            <MetaLogger day={today} onUpdate={updateToday} />

            {/* Photo upload */}
            <PhotoUpload onAnalyzed={onAnalyzed} loading={loading} setLoading={setLoading} />

            {/* Text description */}
            <TextEntry onAnalyzed={onAnalyzed} />

            {/* Analyzed result confirmation */}
            {analyzed?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {analyzed.map((item, i) => (
                  <AnalyzedCard
                    key={i}
                    item={item}
                    index={i}
                    total={analyzed.length}
                    onConfirm={(edited) => { pushMeal(edited); dismissOne(i); }}
                    onDismiss={() => dismissOne(i)}
                  />
                ))}
                {analyzed.length > 1 && (
                  <button onClick={confirmAll} style={{
                    width: "100%", padding: "12px", background: "#1a2a1a", border: "1px solid #c8f542", borderRadius: 6,
                    cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#c8f542", letterSpacing: "0.15em", textTransform: "uppercase",
                  }}>CONFIRM ALL {analyzed.length} MEALS</button>
                )}
              </div>
            )}

            <ManualEntry onAdd={addMeal} />

            {/* Coach nudge */}
            {nudge && (
              <div style={{ marginTop: 12, background: "#0a1a0a", border: "1px solid #c8f542", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 16, lineHeight: 1.4 }}>🤖</span>
                <div style={{ flex: 1, fontSize: 13, color: "#f5f2ed", lineHeight: 1.5 }}>{nudge}</div>
                <button onClick={() => setNudge(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            )}

            {/* Meal list */}
            {today.meals?.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#555", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
                  TODAY'S MEALS
                </div>
                {today.meals.map(m => <MealRow key={m.id} meal={m} onDelete={() => deleteMeal(m.id)} />)}
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === "coach" && <CoachTab history={history} todayTotals={totals} needed={needed} />}

        {tab === "history" && <WeeklyReport history={history} />}

        {/* PROFILE TAB */}
        {tab === "profile" && (
          <ProfileTab history={history} onScan={(date, scan) => setHistory(h => ({ ...h, [date]: { ...(h[date] || EMPTY_DAY()), bodyScan: scan } }))} />
        )}

        {/* IMPORT TAB */}
        {tab === "import" && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, marginBottom: 8 }}>Data Import</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Load all historical data from May 4 through today in one tap.</div>
            <button
              onClick={() => {
                setHistory(prev => {
                  const merged = { ...prev };
                  Object.entries(HISTORICAL_DATA).forEach(([k, v]) => {
                    if (!merged[k]) {
                      merged[k] = v;
                    } else {
                      const existingIds = new Set((merged[k].meals || []).map(m => m.id));
                      const newMeals = (v.meals || []).filter(m => !existingIds.has(m.id));
                      merged[k] = {
                        ...v,
                        ...merged[k],
                        meals: [...newMeals, ...(merged[k].meals || [])],
                      };
                    }
                  });
                  return merged;
                });
                alert("13 days of data loaded!");
              }}
              style={{
                width: "100%", padding: "18px", background: "#c8f542", border: "none",
                borderRadius: 6, cursor: "pointer", fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 22, color: "#0a0a0a", letterSpacing: "0.05em", marginBottom: 16,
              }}
            >
              LOAD HISTORICAL DATA (MAY 4–16)
            </button>
            <button
              onClick={() => { if (window.confirm("Clear ALL data?")) setHistory({}); }}
              style={{
                width: "100%", padding: "14px", background: "transparent", border: "1px solid #333",
                borderRadius: 6, cursor: "pointer", fontFamily: "'DM Mono', monospace",
                fontSize: 11, color: "#555", letterSpacing: "0.15em", textTransform: "uppercase",
              }}
            >
              CLEAR ALL DATA
            </button>
            <div style={{ marginTop: 24, padding: 16, background: "#141414", borderRadius: 8 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Days in storage</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, color: "#c8f542" }}>{Object.keys(history).length}</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav spacing handled by paddingBottom */}
    </div>
  );
}
