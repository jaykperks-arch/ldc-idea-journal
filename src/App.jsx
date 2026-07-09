import { useState, useEffect, useRef } from "react";

const TOPICS = [
  "Faith", "Repentance", "Atonement", "Prayer",
  "Service", "Covenant", "Family", "Holy Ghost",
  "Scriptures", "Temple", "Gratitude", "Restoration",
  "Jesus Christ", "Other"
];

const ENRICH_PROMPT = `You are an LDS spiritual content assistant. Given an idea and topic, return ONLY valid JSON with no markdown or preamble:
{
  "scriptures": [{ "reference": "string", "text": "string", "connection": "string" }],
  "talks": [{ "title": "string", "speaker": "string", "year": "string", "connection": "string" }],
  "stories": [{ "title": "string", "content": "string", "source": "string" }],
  "philosophy": [{ "quote": "string", "author": "string", "connection": "string" }]
}
Include 2-3 scriptures (all standard works), 2-3 real conference talks, 1-2 stories, 1-2 philosophical quotes. Return ONLY the JSON.`;

const BUILD_PROMPT = `You are an LDS talk builder. Create a complete sacrament talk from the provided idea and notes.
Return ONLY valid JSON with no markdown or preamble:
{
  "title": "string",
  "sections": [
    {
      "type": "opening|point|scripture|story|talk|testimony",
      "heading": "string",
      "bullets": ["short scannable phrase"],
      "fullText": "string (natural spoken paragraph)"
    }
  ]
}
Time guidelines:
- 5 min: opening + 1 point + 1 scripture + testimony
- 10 min: opening + 2 points + 2 scriptures + 1 story + testimony
- 15 min: opening + 3 points + 3 scriptures + 2 stories + 1 conference talk + testimony
- 20 min: opening + 3 points + 4 scriptures + 2 stories + 2 conference talks + testimony
Bullets = key phrases only. Full text = conversational, warm, spoken naturally. Return ONLY the JSON.`;

function loadIdeas() {
  try {
    const saved = localStorage.getItem("lds-journal-ideas");
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return parsed.map(idea => {
      if (!idea.notes) return { ...idea, notes: [{ id: idea.id + "_0", text: idea.text || "", date: idea.date }] };
      return idea;
    });
  } catch (e) { return []; }
}

function saveIdeas(ideas) {
  try { localStorage.setItem("lds-journal-ideas", JSON.stringify(ideas)); } catch (e) {}
}

async function callClaude(payload) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function fetchEnrichment(notes, topic) {
  const combined = notes.map((n, i) => `Note ${i + 1}: "${n.text}"`).join("\n");
  return callClaude({
    model: "claude-sonnet-4-6", max_tokens: 1000,
    system: ENRICH_PROMPT,
    messages: [{ role: "user", content: `Topic: ${topic}\n\n${combined}` }]
  });
}

async function buildTalk(idea, minutes) {
  const notes = idea.notes.map((n, i) => `Note ${i + 1}: "${n.text}"`).join("\n");
  const enrichment = idea.enrichment
    ? `\n\nAvailable resources:\nScriptures: ${JSON.stringify(idea.enrichment.scriptures)}\nTalks: ${JSON.stringify(idea.enrichment.talks)}\nStories: ${JSON.stringify(idea.enrichment.stories)}`
    : "";
  return callClaude({
    model: "claude-sonnet-4-6", max_tokens: 2000,
    system: BUILD_PROMPT,
    messages: [{ role: "user", content: `Topic: ${idea.topic}\nTarget time: ${minutes} minutes\n\nIdea notes:\n${notes}${enrichment}\n\nBuild a complete ${minutes}-minute talk.` }]
  });
}

const C = {
  navy: "#1B2A4A", gold: "#C9A84C", parchment: "#F5F0E8",
  sage: "#7A9E7E", white: "#FFFFFF", border: "#DDD6C5",
  softGold: "#FDF6E3", rust: "#C0392B"
};

const SECTION_STYLES = {
  opening:   { accent: C.sage,    label: "Opening"         },
  point:     { accent: C.navy,    label: "Main Point"      },
  scripture: { accent: C.gold,    label: "Scripture"       },
  story:     { accent: "#A0856C", label: "Story"           },
  talk:      { accent: C.sage,    label: "Conference Talk" },
  testimony: { accent: C.navy,    label: "Testimony"       },
};

function MicButton({ isRecording, onStart, onStop, size = 128 }) {
  return (
    <button onClick={isRecording ? onStop : onStart} style={{
      width: size, height: size, borderRadius: "50%", border: "none", cursor: "pointer",
      backgroundColor: isRecording ? C.gold : C.navy,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: isRecording
        ? "0 0 0 10px rgba(201,168,76,0.18), 0 0 0 20px rgba(201,168,76,0.09)"
        : "0 8px 32px rgba(27,42,74,0.28)",
      transition: "background-color 0.3s, box-shadow 0.3s",
      animation: isRecording ? "pulse 2s ease-in-out infinite" : "none",
      WebkitTapHighlightColor: "transparent",
    }}>
      {isRecording
        ? <div style={{ width: size * 0.27, height: size * 0.27, backgroundColor: C.navy, borderRadius: 5 }} />
        : <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 24 24" fill="none">
            <rect x="9" y="2" width="6" height="11" rx="3" fill={C.gold} />
            <path d="M5 10a7 7 0 0 0 14 0" stroke={C.gold} strokeWidth="2.2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="21" stroke={C.gold} strokeWidth="2.2" strokeLinecap="round" />
            <line x1="8.5" y1="21" x2="15.5" y2="21" stroke={C.gold} strokeWidth="2.2" strokeLinecap="round" />
          </svg>
      }
    </button>
  );
}

function useVoice() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const ref = useRef(null);
  const start = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice recording needs Chrome or Safari."); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    let acc = "";
    r.onresult = e => {
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) acc += e.results[i][0].transcript + " ";
        else it += e.results[i][0].transcript;
      }
      setTranscript(acc); setInterim(it);
    };
    r.onerror = e => { if (e.error !== "no-speech") setIsRecording(false); };
    ref.current = r; r.start(); setIsRecording(true); setTranscript(""); setInterim("");
  };
  const stop = () => { ref.current?.stop(); ref.current = null; setIsRecording(false); setInterim(""); };
  const reset = () => { stop(); setTranscript(""); setInterim(""); };
  return { isRecording, transcript, interim, start, stop, reset };
}

function AddNotePanel({ onSave, onCancel }) {
  const v = useVoice();
  const [confirming, setConfirming] = useState(false);
  const handleStop = () => { v.stop(); setConfirming(true); };
  const handleSave = () => { if (v.transcript.trim()) onSave(v.transcript.trim()); v.reset(); setConfirming(false); };
  const handleDiscard = () => { v.reset(); setConfirming(false); onCancel(); };
  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.sage, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>Add a voice note</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <MicButton isRecording={v.isRecording} onStart={v.start} onStop={handleStop} size={60} />
        <p style={{ color: v.isRecording ? C.gold : C.navy, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: v.isRecording ? 1 : 0.5, margin: 0 }}>
          {v.isRecording ? "● Tap to stop" : confirming ? "Review below" : "Tap to speak"}
        </p>
      </div>
      {(v.transcript || v.interim) && (
        <div style={{ backgroundColor: C.softGold, borderRadius: 12, padding: "12px 14px", marginBottom: 12, borderLeft: `3px solid ${C.gold}` }}>
          <p style={{ color: C.navy, fontSize: 14, lineHeight: 1.65, fontFamily: "Georgia, serif", margin: 0 }}>
            {v.transcript}{v.interim && <span style={{ opacity: 0.4 }}>{v.interim}</span>}
          </p>
        </div>
      )}
      {confirming && v.transcript.trim() && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleDiscard} style={{ flex: 1, padding: 10, borderRadius: 12, border: `1.5px solid ${C.border}`, backgroundColor: "transparent", color: C.navy, fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>Discard</button>
          <button onClick={handleSave} style={{ flex: 2, padding: 10, borderRadius: 12, border: "none", backgroundColor: C.navy, color: C.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", WebkitTapHighlightColor: "transparent" }}>Add to Idea →</button>
        </div>
      )}
      {!confirming && !v.isRecording && (
        <button onClick={handleDiscard} style={{ background: "none", border: "none", color: C.navy, opacity: 0.3, fontSize: 12, cursor: "pointer", padding: 0, WebkitTapHighlightColor: "transparent" }}>Cancel</button>
      )}
    </div>
  );
}

function EnrichmentView({ data }) {
  const sections = [
    { key: "scriptures", icon: "📖", label: "Scriptures", render: (s, i) => (
      <div key={i} style={{ backgroundColor: C.softGold, borderRadius: 12, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${C.gold}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 4 }}>{s.reference}</div>
        <p style={{ fontSize: 13, color: C.navy, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.6, margin: "0 0 6px" }}>{s.text}</p>
        <p style={{ fontSize: 12, color: C.navy, opacity: 0.6, margin: 0, lineHeight: 1.5 }}>{s.connection}</p>
      </div>
    )},
    { key: "talks", icon: "🎙️", label: "Conference Talks", render: (t, i) => (
      <div key={i} style={{ backgroundColor: C.white, borderRadius: 12, padding: "12px 14px", marginBottom: 8, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 2, lineHeight: 1.4 }}>"{t.title}"</div>
        <div style={{ fontSize: 11, color: C.sage, fontWeight: 600, marginBottom: 6 }}>{t.speaker} · {t.year}</div>
        <p style={{ fontSize: 12, color: C.navy, opacity: 0.65, margin: 0, lineHeight: 1.5 }}>{t.connection}</p>
      </div>
    )},
    { key: "stories", icon: "📚", label: "Stories & Examples", render: (s, i) => (
      <div key={i} style={{ backgroundColor: C.white, borderRadius: 12, padding: "12px 14px", marginBottom: 8, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{s.title}</div>
        <p style={{ fontSize: 13, color: C.navy, fontFamily: "Georgia, serif", lineHeight: 1.65, margin: "0 0 6px" }}>{s.content}</p>
        {s.source && <div style={{ fontSize: 11, color: C.navy, opacity: 0.45 }}>— {s.source}</div>}
      </div>
    )},
    { key: "philosophy", icon: "💭", label: "Deeper Angles", render: (p, i) => (
      <div key={i} style={{ backgroundColor: C.softGold, borderRadius: 12, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${C.border}` }}>
        <p style={{ fontSize: 13, color: C.navy, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.65, margin: "0 0 6px" }}>"{p.quote}"</p>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, opacity: 0.55, marginBottom: 4 }}>— {p.author}</div>
        <p style={{ fontSize: 12, color: C.navy, opacity: 0.6, margin: 0, lineHeight: 1.5 }}>{p.connection}</p>
      </div>
    )},
  ];
  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
      {sections.map(s => data[s.key]?.length > 0 && (
        <div key={s.key}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 18 }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.navy, opacity: 0.5, letterSpacing: "0.12em", textTransform: "uppercase" }}>{s.label}</span>
          </div>
          {data[s.key].map(s.render)}
        </div>
      ))}
    </div>
  );
}

function TalkView({ talk, onClose }) {
  const [view, setView] = useState("bullets");
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: C.white, zIndex: 100, display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ backgroundColor: C.navy, padding: "14px 20px", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent", padding: 0 }}>← Back</button>
          <div style={{ display: "flex", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20, padding: 3 }}>
            {["bullets", "full"].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "6px 14px", borderRadius: 17, border: "none", cursor: "pointer",
                backgroundColor: view === v ? C.gold : "transparent",
                color: view === v ? C.navy : C.gold,
                fontSize: 12, fontWeight: 700, transition: "all 0.2s", WebkitTapHighlightColor: "transparent"
              }}>{v === "bullets" ? "Bullets" : "Full Text"}</button>
            ))}
          </div>
        </div>
        <h2 style={{ color: C.white, fontSize: 18, fontFamily: "Georgia, serif", margin: 0, lineHeight: 1.3 }}>{talk.title}</h2>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 60px" }}>
        {talk.sections?.map((section, i) => {
          const style = SECTION_STYLES[section.type] || SECTION_STYLES.point;
          return (
            <div key={i} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 3, height: 20, backgroundColor: style.accent, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: style.accent, textTransform: "uppercase", letterSpacing: "0.12em" }}>{style.label}</span>
                {section.heading && <span style={{ fontSize: 10, color: C.navy, opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.08em" }}>· {section.heading}</span>}
              </div>
              {view === "bullets" ? (
                <ul style={{ margin: 0, padding: "0 0 0 8px", listStyle: "none" }}>
                  {section.bullets?.map((b, j) => (
                    <li key={j} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                      <span style={{ color: style.accent, fontSize: 16, lineHeight: 1.3, flexShrink: 0, marginTop: 1 }}>◆</span>
                      <span style={{ color: C.navy, fontSize: 17, fontWeight: 600, lineHeight: 1.45 }}>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{
                  color: C.navy, fontSize: 17, lineHeight: 1.8,
                  fontFamily: section.type === "scripture" ? "Georgia, serif" : "inherit",
                  fontStyle: section.type === "scripture" ? "italic" : "normal",
                  margin: 0,
                  backgroundColor: section.type === "scripture" ? C.softGold : "transparent",
                  borderLeft: section.type === "scripture" ? `3px solid ${C.gold}` : "none",
                  borderRadius: section.type === "scripture" ? "0 8px 8px 0" : 0,
                  padding: section.type === "scripture" ? "10px 12px" : 0,
                }}>
                  {section.fullText}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BuildMode({ ideas, onIdeasChange }) {
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [minutes, setMinutes] = useState(10);
  const [talk, setTalk] = useState(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    try {
      const result = await buildTalk(selectedIdea, minutes);
      setTalk(result);
    } catch (e) {
      setError("Something went wrong. Please try again.");
    }
    setBuilding(false);
  };

  if (talk) return <TalkView talk={talk} onClose={() => { setTalk(null); setSelectedIdea(null); }} />;

  return (
    <div style={{ padding: "24px 20px 60px" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, opacity: 0.5, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>1 · Choose an idea</div>
        {ideas.length === 0 ? (
          <p style={{ color: C.navy, opacity: 0.45, fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, lineHeight: 1.6 }}>No ideas saved yet. Record some thoughts in the Capture tab first.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ideas.map(idea => {
              const selected = selectedIdea?.id === idea.id;
              return (
                <button key={idea.id} onClick={() => setSelectedIdea(idea)} style={{
                  textAlign: "left", backgroundColor: selected ? C.navy : C.white,
                  borderRadius: 16, padding: "14px 16px",
                  border: `2px solid ${selected ? C.navy : C.border}`,
                  cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  boxShadow: "0 2px 8px rgba(27,42,74,0.06)", transition: "all 0.15s"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ backgroundColor: selected ? C.gold : C.navy, color: selected ? C.navy : C.gold, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 8, letterSpacing: "0.06em" }}>{idea.topic}</span>
                    <span style={{ fontSize: 10, color: selected ? "rgba(255,255,255,0.5)" : C.navy, opacity: selected ? 1 : 0.35 }}>{idea.notes?.length} note{idea.notes?.length !== 1 ? "s" : ""}{idea.enrichment ? " · ✦ enriched" : ""}</span>
                  </div>
                  <p style={{ color: selected ? C.white : C.navy, fontSize: 14, lineHeight: 1.55, fontFamily: "Georgia, serif", margin: 0 }}>
                    {idea.notes?.[0]?.text?.slice(0, 100)}{idea.notes?.[0]?.text?.length > 100 ? "…" : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedIdea && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, opacity: 0.5, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>2 · How long is your talk?</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
            {[5, 10, 15, 20].map(m => (
              <button key={m} onClick={() => setMinutes(m)} style={{
                flex: 1, padding: "14px 0", borderRadius: 14,
                backgroundColor: minutes === m ? C.navy : C.white,
                color: minutes === m ? C.gold : C.navy,
                fontSize: 15, fontWeight: 700,
                border: `2px solid ${minutes === m ? C.navy : C.border}`,
                cursor: "pointer", WebkitTapHighlightColor: "transparent", transition: "all 0.15s"
              }}>{m}<span style={{ fontSize: 11 }}>m</span></button>
            ))}
          </div>
          <p style={{ color: C.navy, opacity: 0.45, fontSize: 12, marginBottom: 20, textAlign: "center" }}>
            {minutes === 5 ? "1 main point, 1 scripture, testimony"
             : minutes === 10 ? "2 main points, 2 scriptures, 1 story, testimony"
             : minutes === 15 ? "3 points, 3 scriptures, 2 stories, 1 conference talk, testimony"
             : "3 points, 4 scriptures, 2 stories, 2 conference talks, testimony"}
          </p>
          {error && <p style={{ color: C.rust, fontSize: 13, textAlign: "center", marginBottom: 14 }}>{error}</p>}
          <button onClick={handleBuild} disabled={building} style={{
            width: "100%", padding: 18, borderRadius: 16, border: "none",
            backgroundColor: building ? C.border : C.gold,
            color: building ? "#999" : C.navy,
            fontSize: 17, fontWeight: 700, cursor: building ? "not-allowed" : "pointer",
            fontFamily: "Georgia, serif", WebkitTapHighlightColor: "transparent", transition: "all 0.2s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10
          }}>
            {building ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 20 }}>✦</span> Building your talk...</> : "Build Talk →"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("capture");
  const [ideas, setIdeas] = useState(() => loadIdeas());
  const [filterTopic, setFilterTopic] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [addingToId, setAddingToId] = useState(null);
  const [enrichingId, setEnrichingId] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const capture = useVoice();

  const updateIdeas = (next) => { setIdeas(next); saveIdeas(next); };

  const saveNewIdea = () => {
    const text = capture.transcript.trim();
    if (!text || !selectedTopic) return;
    setSaving(true);
    const now = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const idea = { id: Date.now(), topic: selectedTopic, date: now, notes: [{ id: Date.now() + "_0", text, date: now }], enrichment: null };
    updateIdeas([idea, ...ideas]);
    capture.reset(); setSelectedTopic(null); setShowSave(false); setSaving(false);
  };

  const addNoteToIdea = (ideaId, text) => {
    const now = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    updateIdeas(ideas.map(i => i.id === ideaId ? { ...i, notes: [...i.notes, { id: Date.now() + "_n", text, date: now }], enrichment: null } : i));
    setAddingToId(null);
  };

  const deleteNote = (ideaId, noteId) => {
    const updated = ideas.map(i => {
      if (i.id !== ideaId) return i;
      const notes = i.notes.filter(n => n.id !== noteId);
      return notes.length === 0 ? null : { ...i, notes };
    }).filter(Boolean);
    updateIdeas(updated);
  };

  const deleteIdea = (id) => {
    updateIdeas(ideas.filter(i => i.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (addingToId === id) setAddingToId(null);
  };

  const enrichIdea = async (idea) => {
    setEnrichingId(idea.id);
    try {
      const data = await fetchEnrichment(idea.notes, idea.topic);
      const updated = ideas.map(i => i.id === idea.id ? { ...i, enrichment: data } : i);
      updateIdeas(updated); setExpandedId(idea.id);
    } catch (e) {}
    setEnrichingId(null);
  };

  const discard = () => { capture.reset(); setSelectedTopic(null); setShowSave(false); };
  const filtered = filterTopic ? ideas.filter(i => i.topic === filterTopic) : ideas;
  const topicsUsed = [...new Set(ideas.map(i => i.topic))];

  const tabs = [
    { id: "capture", label: "Capture" },
    { id: "review", label: ideas.length > 0 ? `Ideas ${ideas.length}` : "Ideas" },
    { id: "build", label: "Build" },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.parchment, fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ backgroundColor: C.navy, padding: "16px 20px 0", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ color: C.gold, fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>Light &amp; Truth</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: C.white, fontSize: "21px", fontWeight: 700, fontFamily: "Georgia, serif" }}>Idea Journal</span>
        </div>
        <div style={{ display: "flex", borderBottom: `2px solid rgba(255,255,255,0.08)` }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setMode(t.id)} style={{
              flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
              backgroundColor: "transparent",
              color: mode === t.id ? C.gold : "rgba(255,255,255,0.45)",
              fontSize: 13, fontWeight: 700,
              borderBottom: `2px solid ${mode === t.id ? C.gold : "transparent"}`,
              marginBottom: -2, transition: "all 0.2s", WebkitTapHighlightColor: "transparent"
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {mode === "capture" && (
        <div style={{ padding: "36px 24px 48px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          {!capture.transcript && !capture.isRecording && (
            <p style={{ color: C.navy, opacity: 0.55, fontSize: 15, textAlign: "center", marginBottom: 44, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.7 }}>
              Capture a thought, a feeling,<br />or the seed of a talk.
            </p>
          )}
          <MicButton isRecording={capture.isRecording} onStart={capture.start} onStop={() => { capture.stop(); setShowSave(true); }} />
          <p style={{ color: capture.isRecording ? C.gold : C.navy, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 14, marginBottom: 32, opacity: capture.isRecording ? 1 : 0.6 }}>
            {capture.isRecording ? "● Recording — tap to stop" : "Tap to speak"}
          </p>
          {(capture.transcript || capture.interim || capture.isRecording) && (
            <div style={{ width: "100%", backgroundColor: C.white, borderRadius: 18, padding: 20, boxShadow: "0 2px 16px rgba(27,42,74,0.09)", marginBottom: 20, borderLeft: `4px solid ${C.gold}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.sage, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                {capture.isRecording ? "● Listening" : "Captured"}
              </div>
              <p style={{ color: C.navy, fontSize: 16, lineHeight: 1.65, fontFamily: "Georgia, serif", margin: 0, minHeight: 40 }}>
                {capture.transcript}{capture.interim && <span style={{ opacity: 0.4 }}>{capture.interim}</span>}
                {capture.isRecording && !capture.transcript && !capture.interim && <span style={{ opacity: 0.3 }}>Listening...</span>}
              </p>
            </div>
          )}
          {showSave && capture.transcript.trim() && (
            <div style={{ width: "100%" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, opacity: 0.6, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Tag this idea</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
                {TOPICS.map(t => (
                  <button key={t} onClick={() => setSelectedTopic(t)} style={{
                    padding: "9px 16px", borderRadius: 20,
                    border: `2px solid ${selectedTopic === t ? C.navy : C.border}`,
                    backgroundColor: selectedTopic === t ? C.navy : "transparent",
                    color: selectedTopic === t ? C.gold : C.navy,
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    transition: "all 0.15s", WebkitTapHighlightColor: "transparent"
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={discard} style={{ flex: 1, padding: 16, borderRadius: 14, border: `2px solid ${C.border}`, backgroundColor: "transparent", color: C.navy, fontSize: 15, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>Discard</button>
                <button onClick={saveNewIdea} disabled={!selectedTopic || saving} style={{ flex: 2, padding: 16, borderRadius: 14, border: "none", backgroundColor: selectedTopic ? C.navy : C.border, color: selectedTopic ? C.gold : "#999", fontSize: 15, fontWeight: 700, cursor: selectedTopic ? "pointer" : "not-allowed", fontFamily: "Georgia, serif", WebkitTapHighlightColor: "transparent", transition: "all 0.2s" }}>
                  {saving ? "Saving..." : "Save Idea →"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "review" && (
        <div style={{ padding: "20px 20px 48px" }}>
          {topicsUsed.length > 1 && (
            <div style={{ display: "flex", overflowX: "auto", gap: 8, marginBottom: 20, paddingBottom: 4, scrollbarWidth: "none" }}>
              <button onClick={() => setFilterTopic(null)} style={{ padding: "7px 14px", borderRadius: 20, flexShrink: 0, border: `2px solid ${filterTopic === null ? C.navy : C.border}`, backgroundColor: filterTopic === null ? C.navy : "transparent", color: filterTopic === null ? C.gold : C.navy, fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>All</button>
              {topicsUsed.map(t => (
                <button key={t} onClick={() => setFilterTopic(t === filterTopic ? null : t)} style={{ padding: "7px 14px", borderRadius: 20, flexShrink: 0, border: `2px solid ${filterTopic === t ? C.navy : C.border}`, backgroundColor: filterTopic === t ? C.navy : "transparent", color: filterTopic === t ? C.gold : C.navy, fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>{t}</button>
              ))}
            </div>
          )}
          {ideas.length === 0 ? (
            <div style={{ textAlign: "center", paddingTop: 70 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
              <p style={{ fontFamily: "Georgia, serif", color: C.navy, opacity: 0.5, fontSize: 16, fontStyle: "italic", lineHeight: 1.7 }}>No ideas yet.<br />Tap Capture to record your first thought.</p>
            </div>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: "center", color: C.navy, opacity: 0.4, paddingTop: 60, fontFamily: "Georgia, serif", fontStyle: "italic" }}>No ideas tagged "{filterTopic}" yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filtered.map(idea => {
                const isExpanded = expandedId === idea.id;
                const isAdding = addingToId === idea.id;
                const isEnriching = enrichingId === idea.id;
                const noteCount = idea.notes?.length || 0;
                return (
                  <div key={idea.id} style={{ backgroundColor: C.white, borderRadius: 18, padding: "18px 20px", boxShadow: "0 2px 12px rgba(27,42,74,0.07)", borderLeft: `4px solid ${C.gold}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ backgroundColor: C.navy, color: C.gold, fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 10, letterSpacing: "0.06em" }}>{idea.topic}</span>
                      <span style={{ color: C.navy, opacity: 0.35, fontSize: 11 }}>{idea.date}</span>
                    </div>
                    {idea.notes?.map((note, idx) => (
                      <div key={note.id} style={{ marginBottom: idx < noteCount - 1 ? 14 : 6 }}>
                        {noteCount > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: idx === 0 ? C.gold : C.sage, flexShrink: 0 }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: idx === 0 ? C.gold : C.sage, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                              {idx === 0 ? `Original · ${note.date}` : `Added · ${note.date}`}
                            </span>
                            <button onClick={() => deleteNote(idea.id, note.id)} style={{ background: "none", border: "none", color: C.navy, opacity: 0.2, fontSize: 11, cursor: "pointer", padding: 0, marginLeft: "auto", WebkitTapHighlightColor: "transparent" }}>✕</button>
                          </div>
                        )}
                        <div style={noteCount > 1 && idx < noteCount - 1 ? { marginLeft: 3, borderLeft: `1.5px dashed ${C.border}`, paddingLeft: 12 } : {}}>
                          <p style={{ color: C.navy, fontSize: noteCount === 1 ? 15 : 14, lineHeight: 1.65, fontFamily: "Georgia, serif", margin: 0 }}>{note.text}</p>
                        </div>
                      </div>
                    ))}
                    {!isAdding && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                        <button onClick={() => { setAddingToId(idea.id); setExpandedId(null); }} style={{ padding: "8px 13px", borderRadius: 20, border: `1.5px solid ${C.border}`, backgroundColor: "transparent", color: C.navy, fontSize: 12, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent", display: "flex", alignItems: "center", gap: 5 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="11" rx="3" fill={C.navy} /><path d="M5 10a7 7 0 0 0 14 0" stroke={C.navy} strokeWidth="2" strokeLinecap="round" /><line x1="12" y1="17" x2="12" y2="21" stroke={C.navy} strokeWidth="2" strokeLinecap="round" /></svg>
                          Add note
                          {noteCount > 1 && <span style={{ backgroundColor: C.sage, color: C.white, borderRadius: 8, padding: "1px 5px", fontSize: 10 }}>{noteCount}</span>}
                        </button>
                        {!idea.enrichment ? (
                          <button onClick={() => enrichIdea(idea)} disabled={isEnriching} style={{ padding: "8px 13px", borderRadius: 20, border: "none", backgroundColor: isEnriching ? C.border : C.gold, color: isEnriching ? "#999" : C.navy, fontSize: 12, fontWeight: 700, cursor: isEnriching ? "not-allowed" : "pointer", WebkitTapHighlightColor: "transparent", display: "flex", alignItems: "center", gap: 5 }}>
                            {isEnriching ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>✦</span> Finding...</> : "✦ Enrich"}
                          </button>
                        ) : (
                          <button onClick={() => setExpandedId(isExpanded ? null : idea.id)} style={{ padding: "8px 13px", borderRadius: 20, border: `1.5px solid ${C.gold}`, backgroundColor: isExpanded ? C.navy : "transparent", color: isExpanded ? C.gold : C.navy, fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                            {isExpanded ? "Hide resources" : "✦ Resources"}
                          </button>
                        )}
                        <button onClick={() => deleteIdea(idea.id)} style={{ background: "none", border: "none", color: C.navy, opacity: 0.22, fontSize: 12, cursor: "pointer", padding: 0, marginLeft: "auto", WebkitTapHighlightColor: "transparent" }}>Delete</button>
                      </div>
                    )}
                    {isAdding && <AddNotePanel onSave={(text) => addNoteToIdea(idea.id, text)} onCancel={() => setAddingToId(null)} />}
                    {isExpanded && idea.enrichment && <EnrichmentView data={idea.enrichment} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {mode === "build" && <BuildMode ideas={ideas} onIdeasChange={updateIdeas} />}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 10px rgba(201,168,76,0.18), 0 0 0 20px rgba(201,168,76,0.09); }
          50%  { box-shadow: 0 0 0 16px rgba(201,168,76,0.13), 0 0 0 32px rgba(201,168,76,0.05); }
          100% { box-shadow: 0 0 0 10px rgba(201,168,76,0.18), 0 0 0 20px rgba(201,168,76,0.09); }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { display: none; }
      `}} />
    </div>
  );
}
