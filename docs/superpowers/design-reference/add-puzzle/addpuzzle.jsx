// JigSwap — "Add a Puzzle" screen.
// A calm, open form (no card grid) with a smart URL-import zone at the top and a
// sticky live PuzzleCard preview that updates as you type.
const AP = window.JigSwapDesignSystem_68a963;
const APDB = window.JIGSWAP;

/* Mocked "import from a link" catalogue — keyed loosely by host keyword so a
   pasted URL feels like it really resolved to a product. */
const IMPORT_CATALOG = [
  { match: ["ravensburger"], source: "Ravensburger", title: "Starry Night", brand: "Ravensburger", pieceCount: 1000, difficulty: "hard", condition: "Excellent", color: "var(--jig-violet-500)", tags: ["art", "night"] },
  { match: ["gibsons"], source: "Gibsons", title: "Sunset Harbour", brand: "Gibsons", pieceCount: 1000, difficulty: "medium", condition: "Excellent", color: "var(--orange-500)", tags: ["coast", "boats"] },
  { match: ["clementoni"], source: "Clementoni", title: "Tuscan Hills", brand: "Clementoni", pieceCount: 1500, difficulty: "hard", condition: "Excellent", color: "var(--swap-green-500)", tags: ["landscape"] },
  { match: ["amazon", "bol.com", "bol"], source: "Amazon", title: "Cozy Cabin Retreat", brand: "Buffalo Games", pieceCount: 1000, difficulty: "medium", condition: "Excellent", color: "var(--amber-400)", tags: ["cabin", "winter"] },
];
const IMPORT_DEFAULT = { source: "the web", title: "Mountain Lake Reflections", brand: "Educa", pieceCount: 1000, difficulty: "medium", condition: "Excellent", color: "var(--swap-green-600)", tags: ["nature"] };

const DIFFS = [["easy", "Easy", "var(--swap-green-400)"], ["medium", "Medium", "var(--amber-400)"], ["hard", "Hard", "var(--orange-500)"], ["expert", "Expert", "var(--danger, #ef4444)"]];
const CONDITIONS = ["Excellent", "Good", "Fair", "Poor"];
const STATUSES = ["For Trade", "For Lend", "For Sale"];
const PIECE_PRESETS = [300, 500, 750, 1000, 1500, 2000];
const COVER_SWATCHES = ["var(--jig-violet-500)", "var(--swap-green-500)", "var(--piece-pink-400)", "var(--amber-400)", "var(--orange-500)", "var(--jig-violet-700)", "var(--swap-green-700)", "var(--piece-pink-500)"];

/* ---------------------------------------------------------------- field bits */
function Field({ label, hint, htmlFor, children, optional }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label htmlFor={htmlFor} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{label}</span>
        {optional && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Optional</span>}
      </label>
      {children}
      {hint && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{hint}</span>}
    </div>
  );
}
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const val = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o, dot = Array.isArray(o) ? o[2] : null;
        const on = value === val;
        return (
          <button key={val} type="button" onClick={() => onChange(val)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: "var(--radius-full)", border: "1px solid " + (on ? "transparent" : "var(--border)"), background: on ? "var(--action)" : "var(--surface-card)", color: on ? "var(--action-fg)" : "var(--text-body)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer" }}>
            {dot && <span style={{ width: 9, height: 9, borderRadius: 3, background: on ? "#fff" : dot }}></span>}
            {label}
          </button>
        );
      })}
    </div>
  );
}
function ChipMulti({ options, values, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = values.includes(o);
        return (
          <button key={o} type="button" onClick={() => onToggle(o)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: "var(--radius-full)", border: "1px solid " + (on ? "color-mix(in oklab, var(--swap-green-500) 50%, transparent)" : "var(--border)"), background: on ? "var(--swap-green-50, color-mix(in oklab, var(--swap-green-400) 14%, white))" : "var(--surface-card)", color: on ? "var(--swap-green-700)" : "var(--text-body)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer" }}>
            <Icon name={on ? "check" : "plus"} size={14} color={on ? "var(--swap-green-600)" : "var(--text-muted)"} />{o}
          </button>
        );
      })}
    </div>
  );
}
const inputBase = { width: "100%" };

/* =================================================================== screen */
function AddPuzzle({ go }) {
  const [f, setF] = React.useState({ title: "", brand: "", pieceCount: "", difficulty: "medium", condition: "Excellent", statuses: ["For Trade"], color: "var(--jig-violet-500)", cover: "", tags: [], notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const [url, setUrl] = React.useState("");
  const [imp, setImp] = React.useState({ state: "idle", source: null }); // idle | loading | done
  const [tagDraft, setTagDraft] = React.useState("");

  function runImport() {
    const u = url.trim();
    if (!u) return;
    setImp({ state: "loading", source: null });
    setTimeout(() => {
      const host = u.toLowerCase();
      const hit = IMPORT_CATALOG.find((c) => c.match.some((m) => host.includes(m))) || IMPORT_DEFAULT;
      setF((s) => ({ ...s, title: hit.title, brand: hit.brand, pieceCount: String(hit.pieceCount), difficulty: hit.difficulty, condition: hit.condition, color: hit.color, cover: "", tags: hit.tags.slice() }));
      setImp({ state: "done", source: hit.source });
    }, 950);
  }
  function addTag(t) {
    const v = (t || "").trim().replace(/,$/, "");
    if (v && !f.tags.includes(v)) set("tags", [...f.tags, v]);
    setTagDraft("");
  }

  const ready = f.title.trim() && f.brand.trim() && f.pieceCount;
  const checklist = [
    { ok: !!f.title.trim(), label: "Title" },
    { ok: !!f.brand.trim(), label: "Brand" },
    { ok: !!f.pieceCount, label: "Piece count" },
    { ok: f.statuses.length > 0, label: "Availability" },
  ];

  return (
    <div className="addpuzzle-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 332px", gap: "var(--col-gap)", alignItems: "start", maxWidth: 1080 }}>
      {/* ---------------------------------------------------------- form column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>

        {/* URL import zone — single-hue violet tint, the one accented surface here */}
        <section style={{ borderRadius: "var(--radius-xl)", border: "1px solid color-mix(in oklab, var(--jig-violet-400) 26%, transparent)", background: "var(--jig-violet-50)", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--jig-violet-500)", color: "#fff", flexShrink: 0 }}><Icon name="link" size={16} color="#fff" /></span>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--text-strong)" }}>Import from a Link</span>
          </div>
          <p style={{ margin: "0 0 12px 40px", fontSize: "var(--text-sm)", color: "var(--text-body)" }}>Paste a link from Ravensburger, Gibsons, Amazon or another shop and we'll fill in the details for you.</p>
          <div style={{ display: "flex", gap: 9, marginLeft: 40, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><Icon name="link-2" size={15} color="var(--text-muted)" /></span>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runImport()} placeholder="https://www.ravensburger.com/…" style={{ paddingLeft: 34 }} />
            </div>
            <Button variant="brand" onClick={runImport} disabled={imp.state === "loading"}>
              {imp.state === "loading" ? <><Spinner /> Importing…</> : <><Icon name="sparkles" size={15} color="#fff" /> Import Details</>}
            </Button>
          </div>
          <div style={{ marginLeft: 40, marginTop: 9, minHeight: 18 }}>
            {imp.state === "done" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-xs)", color: "var(--swap-green-700)", fontWeight: 600 }}>
                <Icon name="circle-check" size={14} color="var(--swap-green-600)" /> Imported from {imp.source} — review the details below and save.
              </span>
            ) : (
              <button type="button" onClick={() => { setUrl("https://www.ravensburger.com/starry-night-1000"); }} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--jig-violet-600)", fontWeight: 600 }}>Try a sample link →</button>
            )}
          </div>
        </section>

        <Divider label="or enter the details yourself" />

        {/* core details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <Field label="Puzzle Title" htmlFor="ap-title">
            <Input id="ap-title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Starry Night" style={inputBase} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Field label="Brand" htmlFor="ap-brand">
              <Input id="ap-brand" list="ap-brands" value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Ravensburger" style={inputBase} />
              <datalist id="ap-brands">{["Ravensburger", "Clementoni", "Gibsons", "Schmidt", "Educa", "Heye", "Buffalo Games"].map((b) => <option key={b} value={b} />)}</datalist>
            </Field>
            <Field label="Piece Count" htmlFor="ap-pieces" hint="Common sizes below">
              <Input id="ap-pieces" type="number" inputMode="numeric" value={f.pieceCount} onChange={(e) => set("pieceCount", e.target.value)} placeholder="1000" style={inputBase} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                {PIECE_PRESETS.map((n) => (
                  <button key={n} type="button" onClick={() => set("pieceCount", String(n))} style={{ padding: "4px 10px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: String(n) === f.pieceCount ? "var(--jig-violet-50)" : "var(--surface-card)", color: String(n) === f.pieceCount ? "var(--jig-violet-700)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", cursor: "pointer" }}>{n}</button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Difficulty">
            <Segmented options={DIFFS} value={f.difficulty} onChange={(v) => set("difficulty", v)} />
          </Field>
          <Field label="Condition">
            <Segmented options={CONDITIONS} value={f.condition} onChange={(v) => set("condition", v)} />
          </Field>
          <Field label="Availability" hint="How you'd like to share this puzzle. Pick any that apply.">
            <ChipMulti options={STATUSES} values={f.statuses} onToggle={(s) => set("statuses", f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s])} />
          </Field>
        </div>

        <Divider label="cover & extras" />

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <Field label="Cover Colour" hint="No box photo yet? Pick a colour for the placeholder cover.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {COVER_SWATCHES.map((c) => (
                <button key={c} type="button" onClick={() => { set("color", c); set("cover", ""); }} aria-label="cover colour" style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", cursor: "pointer", border: f.color === c && !f.cover ? "2px solid var(--text-strong)" : "2px solid transparent", boxShadow: "0 0 0 1px var(--border)", background: `linear-gradient(140deg, ${c}, color-mix(in oklab, ${c}, black 30%))` }}></button>
              ))}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: "var(--radius-md)", border: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer" }}>
                <Icon name="upload" size={15} color="var(--text-muted)" /> Upload photo
                <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files && e.target.files[0]; if (file) set("cover", URL.createObjectURL(file)); }} style={{ display: "none" }} />
              </label>
            </div>
          </Field>

          <Field label="Tags" optional hint="Press Enter to add. Helps people discover your puzzle.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", padding: "7px 8px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", background: "var(--surface-card)", minHeight: 42 }}>
              {f.tags.map((t) => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 10px", borderRadius: "var(--radius-full)", background: "var(--jig-violet-50)", color: "var(--jig-violet-700)", fontSize: "var(--text-xs)", fontWeight: 600 }}>
                  {t}<button type="button" onClick={() => set("tags", f.tags.filter((x) => x !== t))} style={{ border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", padding: 0 }}><Icon name="x" size={12} color="var(--jig-violet-600)" /></button>
                </span>
              ))}
              <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagDraft); } else if (e.key === "Backspace" && !tagDraft && f.tags.length) { set("tags", f.tags.slice(0, -1)); } }} placeholder={f.tags.length ? "" : "landscape, ocean, calm…"} style={{ flex: 1, minWidth: 120, border: "none", outline: "none", background: "transparent", font: "inherit", fontSize: "var(--text-sm)", color: "var(--text-body)", padding: "3px 2px" }} />
            </div>
          </Field>

          <Field label="Notes" optional htmlFor="ap-notes">
            <textarea id="ap-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Anything worth mentioning — missing pieces, special edition, where you got it…" style={{ width: "100%", resize: "vertical", padding: "10px 12px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", background: "var(--surface-card)", font: "inherit", fontSize: "var(--text-sm)", color: "var(--text-body)", lineHeight: 1.5 }}></textarea>
          </Field>
        </div>

        {/* footer actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 6, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <Button variant="brand" disabled={!ready} onClick={() => go("puzzles")}><Icon name="plus" size={16} color="#fff" /> Add to Library</Button>
          <Button variant="outline" disabled={!ready} onClick={() => go("puzzles")}>Save &amp; Add Another</Button>
          <Button variant="ghost" onClick={() => go("puzzles")}>Cancel</Button>
          {!ready && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginLeft: "auto" }}>Add a title, brand and piece count to continue.</span>}
        </div>
      </div>

      {/* ------------------------------------------------------- preview column */}
      <aside className="addpuzzle-preview" style={{ position: "sticky", top: 8, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted)" }}>Live Preview</div>
        <PuzzleCard
          title={f.title || "Your puzzle title"}
          brand={f.brand || "Brand"}
          pieceCount={f.pieceCount ? Number(f.pieceCount) : 0}
          difficulty={f.difficulty}
          cover={f.cover || undefined}
          coverColor={f.color}
          available={f.statuses.length > 0}
          onView={() => {}}
          onAdd={() => {}}
        />
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.5 }}>This is how your puzzle will appear in your library and to the community.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {checklist.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: "var(--text-sm)", color: c.ok ? "var(--text-strong)" : "var(--text-muted)" }}>
              <span style={{ width: 18, height: 18, borderRadius: "var(--radius-full)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: c.ok ? "var(--swap-green-400)" : "var(--surface-muted)", color: "#fff" }}>{c.ok && <Icon name="check" size={12} color="#fff" />}</span>
              {c.label}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Spinner() {
  return <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgb(255 255 255 / .45)", borderTopColor: "#fff", display: "inline-block", animation: "apSpin .7s linear infinite" }}></span>;
}
function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ height: 1, flex: 1, background: "var(--border)" }}></span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ height: 1, flex: 1, background: "var(--border)" }}></span>
    </div>
  );
}

Object.assign(window, { AddPuzzle });
