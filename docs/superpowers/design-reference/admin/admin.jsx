// JigSwap — Admin / Moderation console.
// Two review queues (puzzle-definition submissions, flagged image uploads) with
// approve/reject actions, a detail pane per item, a week-at-a-glance header, and
// a moderator activity log. Actions are optimistic & local (resolve on click).
const { Avatar, Badge, Button, Input } = window.JigSwapDesignSystem_68a963;
const ADB = window.JIGSWAP;

const SEV_TONE = { high: "expert", medium: "warning", low: "default" };
const capw = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

function AdCover({ c1, c2, color, size = 52, radius = "var(--radius-md)", icon = "puzzle" }) {
  const bg = c1 ? `linear-gradient(140deg, ${c1}, ${c2})` : `linear-gradient(140deg, ${color}, color-mix(in oklab, ${color}, black 32%))`;
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
      <Icon name={icon} size={size * 0.4} color="rgba(255,255,255,.82)" />
    </span>
  );
}

/* -------------------------------------------------------------- KPI header */
function AdminKpis() {
  const s = ADB.adminMeta.weekStats;
  const kpis = [
    { v: s.approved, l: "Approved", icon: "circle-check", tone: "var(--swap-green-500)" },
    { v: s.rejected, l: "Rejected", icon: "circle-x", tone: "var(--orange-500)" },
    { v: s.flagsCleared, l: "Flags cleared", icon: "flag", tone: "var(--jig-violet-500)" },
    { v: s.avgReviewMins + "m", l: "Avg. review time", icon: "clock", tone: "var(--text-muted)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--col-gap)" }} className="admin-kpis">
      {kpis.map((k) => (
        <div key={k.l} style={{ display: "flex", alignItems: "center", gap: 13, padding: "16px 18px", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)", background: "var(--surface-card)" }}>
          <span style={{ width: 40, height: 40, borderRadius: "var(--radius-lg)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `color-mix(in oklab, ${k.tone} 14%, transparent)` }}><Icon name={k.icon} size={19} color={k.tone} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-2xl)", color: "var(--text-strong)", lineHeight: 1 }}>{k.v}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3 }}>{k.l} <span style={{ opacity: 0.7 }}>· this week</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================ SUBMISSIONS Q */
function SubmissionRow({ s, active, onClick }) {
  return (
    <button onClick={onClick} className="ad-qrow" style={{ borderLeft: "3px solid " + (active ? "var(--jig-violet-500)" : "transparent"), background: active ? "var(--jig-violet-50)" : "transparent" }}>
      <AdCover color={s.color} size={46} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
          {s.dup && <Badge variant="warning">Possible dup</Badge>}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.brand} · {s.pieceCount.toLocaleString()}pc · by {s.by}</div>
      </div>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{s.when}</span>
    </button>
  );
}

function SubmissionDetail({ s, onAction }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16 }}>
        <AdCover color={s.color} size={92} radius="var(--radius-xl)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)", margin: 0 }}>{s.title}</h3>
            <Badge variant="default">{s.id}</Badge>
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 4 }}>{s.brand} · {s.pieceCount.toLocaleString()} pieces · {capw(s.difficulty)} · {s.year}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {s.themes.map((t) => <span key={t} style={{ padding: "3px 10px", borderRadius: "var(--radius-full)", background: "var(--jig-violet-50)", color: "var(--jig-violet-700)", fontSize: "var(--text-xs)", fontWeight: 600 }}>{t}</span>)}
          </div>
        </div>
      </div>

      {s.dup && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: "var(--radius-lg)", background: "color-mix(in oklab, var(--amber-400) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--amber-400) 34%, transparent)" }}>
          <Icon name="alert-triangle" size={17} color="var(--orange-500)" />
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-body)" }}>Possible duplicate of <strong style={{ color: "var(--text-strong)" }}>{s.dup}</strong> already in the catalog. Review before approving.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[["Submitted by", s.by], ["Submitted", s.when], ["Difficulty", capw(s.difficulty)], ["Release year", s.year]].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 3 }}>{k}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {s.note && (
        <div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>Submitter note</div>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-body)", lineHeight: 1.5, fontStyle: "italic" }}>"{s.note}"</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 4, flexWrap: "wrap" }}>
        <Button variant="brand" onClick={() => onAction(s, "approved")}><Icon name="check" size={16} color="#fff" /> Approve &amp; Publish</Button>
        <Button variant="outline" onClick={() => onAction(s, "edited")}><Icon name="pencil" size={15} /> Edit &amp; Approve</Button>
        <Button variant="ghost" onClick={() => onAction(s, "rejected")} style={{ color: "var(--orange-500)", marginLeft: "auto" }}><Icon name="x" size={16} color="var(--orange-500)" /> Reject</Button>
      </div>
    </div>
  );
}

/* ================================================================= FLAGS Q */
function FlagRow({ f, active, onClick }) {
  return (
    <button onClick={onClick} className="ad-qrow" style={{ borderLeft: "3px solid " + (active ? "var(--jig-violet-500)" : "transparent"), background: active ? "var(--jig-violet-50)" : "transparent" }}>
      <AdCover c1={f.c1} c2={f.c2} size={46} icon="image" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: f.severity === "high" ? "var(--orange-500)" : f.severity === "medium" ? "var(--amber-400)" : "var(--text-muted)" }}></span>
          <span style={{ fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.reason}</span>
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>on {f.target} · {f.reports} report{f.reports > 1 ? "s" : ""}</div>
      </div>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{f.when}</span>
    </button>
  );
}

function FlagDetail({ f, onAction }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* the flagged image, with a blur-until-hover guard */}
      <div style={{ position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", aspectRatio: "16/10", background: `linear-gradient(140deg, ${f.c1}, ${f.c2})` }}>
        <span className="ad-flag-guard" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, backdropFilter: "blur(14px)", background: "rgb(20 16 40 / .3)", color: "#fff", cursor: "pointer", transition: "opacity .18s" }}>
          <Icon name="eye-off" size={22} color="#fff" />
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>Hover to reveal flagged image</span>
        </span>
        <Badge variant={SEV_TONE[f.severity]} style={{ position: "absolute", top: 12, left: 12 }}>{capw(f.severity)} severity</Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)", margin: 0 }}>{f.reason}</h3>
        <Badge variant="default">{f.id}</Badge>
      </div>
      <p style={{ margin: "-8px 0 0", fontSize: "var(--text-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>{f.detail}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[["On puzzle", f.target], ["Uploaded by", f.uploader], ["Reported by", f.by], ["Reports", f.reports + " total"]].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 3 }}>{k}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, paddingTop: 4, flexWrap: "wrap" }}>
        <Button variant="brand" onClick={() => onAction(f, "removed")} style={{ background: "var(--orange-500)" }}><Icon name="trash-2" size={15} color="#fff" /> Remove Image</Button>
        <Button variant="outline" onClick={() => onAction(f, "warned")}><Icon name="flag" size={15} /> Remove &amp; Warn User</Button>
        <Button variant="ghost" onClick={() => onAction(f, "dismissed")} style={{ marginLeft: "auto" }}><Icon name="check" size={16} /> Dismiss Flag</Button>
      </div>
    </div>
  );
}

/* ============================================================ activity log */
const LOG_ICON = { approve: ["circle-check", "var(--swap-green-500)"], reject: ["circle-x", "var(--orange-500)"], remove: ["trash-2", "var(--orange-500)"], dismiss: ["check", "var(--text-muted)"] };
function AdminActivity() {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", background: "var(--surface-card)", padding: "6px 16px" }}>
      {ADB.adminMeta.activity.map((a, i, arr) => {
        const [ic, tone] = LOG_ICON[a.kind] || LOG_ICON.dismiss;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
            <Icon name={ic} size={16} color={tone} />
            <div style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
              <strong style={{ color: "var(--text-strong)" }}>{a.who}</strong> {a.action} <strong style={{ color: "var(--text-strong)" }}>{a.what}</strong>
            </div>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{a.when}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ==================================================================== main */
function AdminPanel({ go }) {
  const [tab, setTab] = React.useState("submissions");
  const [subs, setSubs] = React.useState(ADB.submissions);
  const [flags, setFlags] = React.useState(ADB.flags);
  const [selSub, setSelSub] = React.useState(ADB.submissions[0].id);
  const [selFlag, setSelFlag] = React.useState(ADB.flags[0].id);
  const [toast, setToast] = React.useState(null);

  const flash = (msg) => { setToast(msg); clearTimeout(window.__adT); window.__adT = setTimeout(() => setToast(null), 2600); };

  function actSub(s, verb) {
    const rest = subs.filter((x) => x.id !== s.id);
    setSubs(rest);
    if (rest.length) setSelSub(rest[Math.min(rest.findIndex(() => true), rest.length - 1)].id);
    const label = verb === "rejected" ? "Rejected" : verb === "edited" ? "Approved (edited)" : "Approved";
    flash(`${label} “${s.title}” — ${rest.length} submission${rest.length === 1 ? "" : "s"} left in queue.`);
  }
  function actFlag(f, verb) {
    const rest = flags.filter((x) => x.id !== f.id);
    setFlags(rest);
    if (rest.length) setSelFlag(rest[0].id);
    const label = { removed: "Removed image", warned: "Removed & warned user", dismissed: "Dismissed flag" }[verb];
    flash(`${label} on “${f.target}” — ${rest.length} flag${rest.length === 1 ? "" : "s"} left.`);
  }

  const sub = subs.find((x) => x.id === selSub);
  const flag = flags.find((x) => x.id === selFlag);
  const TABS = [
    { id: "submissions", label: "Submissions", icon: "inbox", count: subs.length },
    { id: "flags", label: "Flagged Images", icon: "flag", count: flags.length },
    { id: "activity", label: "Activity Log", icon: "history", count: null },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--block-gap)", maxWidth: 1180 }}>
      {/* admin banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: "var(--radius-full)", background: "var(--jig-violet-500)", color: "#fff", fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: ".02em" }}><Icon name="shield" size={14} color="#fff" /> ADMIN</span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Moderation console · you and {ADB.adminMeta.moderators.length - 1} other moderators</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: -6 }}>
          {ADB.adminMeta.moderators.map((m, i) => <span key={m} style={{ marginLeft: i ? -8 : 0, borderRadius: "50%", boxShadow: "0 0 0 2px var(--background)" }}><Avatar name={m} size="sm" /></span>)}
        </div>
      </div>

      <AdminKpis />

      {/* tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", border: "none", borderBottom: "2px solid " + (on ? "var(--jig-violet-500)" : "transparent"), background: "transparent", cursor: "pointer", font: "inherit", fontSize: "var(--text-sm)", fontWeight: 600, color: on ? "var(--text-strong)" : "var(--text-muted)", marginBottom: -1 }}>
              <Icon name={t.icon} size={16} color={on ? "var(--jig-violet-600)" : "var(--text-muted)"} />{t.label}
              {t.count != null && <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: "var(--radius-full)", background: on ? "var(--jig-violet-500)" : "var(--surface-muted)", color: on ? "#fff" : "var(--text-muted)", fontSize: "var(--text-xs)", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {/* body */}
      {tab === "activity" ? (
        <AdminActivity />
      ) : tab === "submissions" ? (
        subs.length === 0 ? <QueueEmpty label="No submissions waiting. Nice — inbox zero!" />
        : <div className="ad-split" style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "var(--col-gap)", alignItems: "start" }}>
            <div className="ad-queue">{subs.map((s) => <SubmissionRow key={s.id} s={s} active={s.id === selSub} onClick={() => setSelSub(s.id)} />)}</div>
            <div className="ad-pane">{sub && <SubmissionDetail s={sub} onAction={actSub} />}</div>
          </div>
      ) : (
        flags.length === 0 ? <QueueEmpty label="No flagged images. The community's happy." />
        : <div className="ad-split" style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "var(--col-gap)", alignItems: "start" }}>
            <div className="ad-queue">{flags.map((f) => <FlagRow key={f.id} f={f} active={f.id === selFlag} onClick={() => setSelFlag(f.id)} />)}</div>
            <div className="ad-pane">{flag && <FlagDetail f={flag} onAction={actFlag} />}</div>
          </div>
      )}

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", zIndex: 80, display: "flex", alignItems: "center", gap: 9, padding: "11px 18px", borderRadius: "var(--radius-full)", background: "var(--text-strong)", color: "var(--background)", fontSize: "var(--text-sm)", fontWeight: 600, boxShadow: "var(--shadow-lg, 0 16px 40px -12px rgb(20 16 40 / .5))", animation: "jigSheetUp .2s var(--ease-out)" }}>
          <Icon name="check-circle" size={16} color="var(--swap-green-400)" />{toast}
        </div>
      )}
    </div>
  );
}

function QueueEmpty({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "56px 20px", border: "1px dashed var(--border)", borderRadius: "var(--radius-xl)", color: "var(--text-muted)" }}>
      <Icon name="check-circle" size={30} color="var(--swap-green-500)" />
      <span style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-strong)" }}>All clear</span>
      <span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
    </div>
  );
}

Object.assign(window, { AdminPanel });
