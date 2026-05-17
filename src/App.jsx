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

const TODAY_KEY = () => new Date().toISOString().slice(0, 10);

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
When shown a food photo, respond ONLY with valid JSON (no markdown, no explanation):
{"name":"<short meal name>","protein":<number>,"calories":<number>,"fiber":<number>,"notes":"<1 sentence observation>"}
Be accurate. If the image is unclear, make your best estimate. Never refuse.`,
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

  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ base64: e.target.result.split(",")[1], mimeType: file.type || "image/jpeg" });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setPendingFiles(null);
    setLoading(true);
    try {
      const fileData = await Promise.all(Array.from(files).map(readFile));
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
      const [f1, f2] = await Promise.all([readFile(files[0]), readFile(files[1])]);
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
  const [sleep, setSleep] = useState({ hours: "", score: "" });
  const [workout, setWorkout] = useState({ type: "HIIT", duration: "", calories: "", hr: "", effort: "" });

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
        fontFamily: "'DM Sans', sans-serif", flex: 1,
      }}
    />
  );

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      {/* Sleep */}
      <div style={{ flex: 1 }}>
        <button onClick={() => setSleepOpen(o => !o)} style={{
          width: "100%", padding: "10px", background: day.sleep ? "#1a2a1a" : "#1a1a1a",
          border: `1px solid ${day.sleep ? "#c8f542" : "#2a2a2a"}`, borderRadius: 6,
          cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: day.sleep ? "#c8f542" : "#888", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>
          {day.sleep ? `😴 ${day.sleep.hours}h · ${day.sleep.score}` : "😴 LOG SLEEP"}
        </button>
        {sleepOpen && (
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {inp(sleep.hours, v => setSleep(s => ({ ...s, hours: v })), "Hours")}
            {inp(sleep.score, v => setSleep(s => ({ ...s, score: v })), "Score")}
            <button onClick={saveSleep} style={{
              padding: "10px 14px", background: "#c8f542", border: "none", borderRadius: 4,
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a",
            }}>✓</button>
          </div>
        )}
      </div>
      {/* Workout */}
      <div style={{ flex: 1 }}>
        <button onClick={() => setWorkoutOpen(o => !o)} style={{
          width: "100%", padding: "10px", background: day.workout ? "#1a2a1a" : "#1a1a1a",
          border: `1px solid ${day.workout ? "#c8f542" : "#2a2a2a"}`, borderRadius: 6,
          cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: day.workout ? "#c8f542" : "#888", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>
          {day.workout ? `💪 ${day.workout.calories}cal` : "💪 LOG WORKOUT"}
        </button>
        {workoutOpen && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={workout.type} onChange={e => setWorkout(w => ({ ...w, type: e.target.value }))}
              style={{
                background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4,
                padding: "10px 12px", color: "#f5f2ed", fontSize: 13,
              }}>
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

// ── Main App ───────────────────────────────────────────────────────────────
export default function GorillaTracker() {
  const [tab, setTab] = useState("today");
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(null);
  const [storageReady, setStorageReady] = useState(false);

  // Load from storage
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.storage.get("gorilla-history");
        if (result?.value) setHistory(JSON.parse(result.value));
      } catch {}
      setStorageReady(true);
    };
    load();
  }, []);

  // Save to storage
  useEffect(() => {
    if (!storageReady) return;
    const save = async () => {
      try { await window.storage.set("gorilla-history", JSON.stringify(history)); } catch {}
    };
    save();
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
  const confirmOne = (i) => { pushMeal(analyzed[i]); dismissOne(i); };
  const confirmAll = () => { analyzed.forEach(pushMeal); setAnalyzed(null); };

  const needed = {
    protein: Math.max(0, TARGETS.protein - totals.protein),
    calories: Math.max(0, TARGETS.calories - totals.calories),
    fiber: Math.max(0, TARGETS.fiber - totals.fiber),
  };

  const TABS = ["today", "history", "profile", "import"];

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

            {/* Analyzed result confirmation */}
            {analyzed?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {analyzed.map((item, i) => (
                  <div key={i} style={{ background: "#141414", border: "1px solid #c8f542", borderRadius: 8, padding: 16, marginBottom: 8 }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#c8f542", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
                      DETECTED {analyzed.length > 1 ? `${i + 1}/${analyzed.length}` : ""}
                    </div>
                    <div style={{ fontSize: 15, color: "#f5f2ed", marginBottom: 6 }}>{item.name}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", marginBottom: 12 }}>
                      {item.protein}g protein · {item.calories} cal · {item.fiber}g fiber
                    </div>
                    {item.notes && <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginBottom: 12 }}>{item.notes}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => confirmOne(i)} style={{
                        flex: 1, padding: "10px", background: "#c8f542", border: "none", borderRadius: 4,
                        cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0a0a0a", letterSpacing: "0.1em",
                      }}>CONFIRM</button>
                      <button onClick={() => dismissOne(i)} style={{
                        flex: 1, padding: "10px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 4,
                        cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em",
                      }}>DISMISS</button>
                    </div>
                  </div>
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
        {tab === "history" && <WeeklyReport history={history} />}

        {/* PROFILE TAB */}
        {tab === "profile" && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, marginBottom: 20 }}>Body Stats</div>
            {[
              { label: "Weight", val: `${PROFILE.weight} lbs` },
              { label: "Body Fat", val: "14.9% (24.9 lbs)" },
              { label: "Skeletal Muscle", val: `${PROFILE.smm} lbs` },
              { label: "Protein Target", val: "165g/day" },
              { label: "Calorie Target", val: "2,000–2,100/day" },
              { label: "Fiber Target", val: "35g/day" },
              { label: "Shredded By", val: PROFILE.shredded, color: "#c8f542" },
              { label: "Gorilla By", val: PROFILE.gorilla, color: "#c8f542" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 0", borderBottom: "1px solid #1a1a1a",
              }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
                <span style={{ fontSize: 14, color: color || "#f5f2ed" }}>{val}</span>
              </div>
            ))}

            <div style={{ marginTop: 24, padding: 16, background: "#141414", borderRadius: 8 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#888", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
                Progress vs Baseline (May 4)
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "#c8f542" }}>−2.1</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#555", textTransform: "uppercase" }}>lbs fat lost</div>
                </div>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "#c8f542" }}>+1.8</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#555", textTransform: "uppercase" }}>lbs muscle gained</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* IMPORT TAB */}
        {tab === "import" && (
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, marginBottom: 8 }}>Data Import</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Load all historical data from May 4 through today in one tap.</div>
            <button
              onClick={() => {
                setHistory(prev => { const merged = { ...prev }; Object.entries(HISTORICAL_DATA).forEach(([k, v]) => { if (!merged[k] || !merged[k].meals || merged[k].meals.length === 0) { merged[k] = v; } }); return merged; });
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
