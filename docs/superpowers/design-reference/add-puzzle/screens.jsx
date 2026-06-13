// JigSwap screens. Dashboard is hi-fi & card-free; every other section is a real,
// lighter screen so the whole IA is reachable. Each screen takes { go } to navigate.
const { Avatar, Badge, Button, Input, PuzzleCard, PuzzlePlank } = window.JigSwapDesignSystem_68a963;
const D = window.JIGSWAP;

/* ----------------------------------------------------------------- shared bits */
function Row({ children, last, onClick, style = {} }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: last ? "none" : "1px solid var(--border)", cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>
  );
}
function CoverChip({ c1, c2, size = 40, radius = "var(--radius-md)", icon = "puzzle" }) {
  return <span style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(150deg, ${c1}, ${c2 || c1})`, color: "#fff", boxShadow: "inset 0 0 0 1px rgb(0 0 0 / .08)" }}><Icon name={icon} size={size * 0.42} color="#fff" /></span>;
}
function Money() { return null; }

/* =============================================================== DASHBOARD ==== */
function Dashboard({ go }) {
  const quick = [
    { icon: "plus", label: "Add a Puzzle", to: "add-puzzle", brand: true },
    { icon: "search", label: "Browse Community", to: "browse" },
    { icon: "arrow-left-right", label: "Review Exchanges", to: "exchanges" },
    { icon: "circle-check", label: "Log a Completion", to: "completions" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--block-gap)", maxWidth: 1140 }}>
      {/* Stats — open divided row, no boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {D.stats.map((s, i) => (
          <button key={s.label} onClick={() => go(s.to)} style={{ textAlign: "left", border: "none", background: "transparent", cursor: "pointer", font: "inherit", paddingLeft: i === 0 ? 0 : 24, paddingRight: 12, borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}><Icon name={s.icon} size={15} color="var(--jig-violet-500)" />{s.label}</span>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-4xl)", color: "var(--text-strong)", lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.sub}</span>
          </button>
        ))}
      </div>

      {/* Shelf */}
      <section>
        <SectionHead title="Your Shelf" icon="book-open" meta="24 on the shelf · 12 up for trade"
          action={<Button variant="outline" size="sm" onClick={() => go("collections")}>View Collections</Button>} />
        <PuzzlePlank boxes={D.shelf} />
      </section>

      {/* Active exchanges + Goals */}
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "var(--col-gap)" }}>
        <section>
          <SectionHead title="Active Exchanges" icon="arrow-left-right" meta="3 ongoing"
            action={<Button variant="ghost" size="sm" onClick={() => go("exchanges")}>All</Button>} />
          {D.exchanges.slice(0, 3).map((e, i, a) => (
            <Row key={e.id} last={i === a.length - 1} onClick={() => go("exchanges")}>
              <CoverChip c1={e.color} c2={`color-mix(in oklab, ${e.color}, black 28%)`} icon={e.kind === "Lend" ? "package" : e.kind === "Sale" ? "tag" : "arrow-left-right"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: 600 }}>{e.kind} · {e.mine}{e.theirs ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> ↔ {e.theirs}</span> : null}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{e.dir} · {e.who} · {e.when}</div>
              </div>
              <StatusPill status={e.status} />
            </Row>
          ))}
        </section>

        <section>
          <SectionHead title="Goals" icon="target" action={<Button variant="ghost" size="sm" onClick={() => go("goals")}>All</Button>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {D.goals.slice(0, 3).map((g) => (
              <div key={g.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-strong)", fontWeight: 600 }}>{g.title}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{g.current}/{g.target}</span>
                </div>
                <ProgressBar value={g.current} max={g.target} />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Activity + Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "var(--col-gap)" }}>
        <section>
          <SectionHead title="Recent Activity" icon="bell" />
          {D.activity.map((a, i, arr) => (
            <Row key={i} last={i === arr.length - 1}>
              <span style={{ width: 34, height: 34, borderRadius: "var(--radius-full)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--jig-violet-50)", color: "var(--jig-violet-500)" }}><Icon name={a.icon} size={16} /></span>
              <div style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
                <strong style={{ color: "var(--text-strong)" }}>{a.who}</strong> {a.action} <strong style={{ color: "var(--jig-violet-600)" }}>{a.what}</strong>
              </div>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{a.when}</span>
            </Row>
          ))}
        </section>
        <section>
          <SectionHead title="Quick Actions" icon="zap" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            {quick.map((q, i, arr) => (
              <button key={q.label} onClick={() => go(q.to)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", background: "transparent", border: "none", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left", font: "inherit" }}>
                <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: q.brand ? "var(--action)" : "var(--jig-violet-50)", color: q.brand ? "var(--action-fg)" : "var(--jig-violet-500)" }}><Icon name={q.icon} size={16} /></span>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{q.label}</span>
                <Icon name="chevron-right" size={16} color="var(--text-muted)" />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Recently added */}
      <section>
        <SectionHead title="Recently Added" icon="puzzle" action={<Button variant="ghost" size="sm" onClick={() => go("puzzles")}>My Puzzles</Button>} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
          {D.puzzles.slice(0, 4).map((p) => (
            <PuzzleCard key={p.id} title={p.title} brand={p.brand} pieceCount={p.pieceCount} difficulty={p.difficulty} coverColor={p.color} available={p.available} onView={() => go("puzzles")} onAdd={() => go("exchanges")} />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================ MY PUZZLES ===== */
function MyPuzzles({ go }) {
  const [filter, setFilter] = React.useState("All");
  const filters = ["All", "Available", "For Trade", "For Lend", "In Progress", "Completed"];
  const list = D.puzzles.filter((p) => filter === "All" ? true : filter === "Available" ? p.available : p.status.includes(filter));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1140 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="brand" size="sm" onClick={() => go("add-puzzle")}><Icon name="plus" size={15} color="#fff" /> Add Puzzle</Button>
      </div>
      <FilterBar filters={filters} value={filter} onChange={setFilter} count={`${list.length} of ${D.puzzles.length} puzzles`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))", gap: 18 }}>
        {list.map((p) => <PuzzleCard key={p.id} title={p.title} brand={p.brand} pieceCount={p.pieceCount} difficulty={p.difficulty} coverColor={p.color} available={p.available} onView={() => {}} onAdd={() => go("exchanges")} />)}
      </div>
      {list.length === 0 && <Empty title="No puzzles here yet" sub="Add your first puzzle to start trading." />}
    </div>
  );
}

/* =========================================================== COLLECTIONS ===== */
function Collections({ go }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1140 }}>
      <SectionHead title="Your Collections" icon="folder" meta="6 shelves · 46 puzzles"
        action={<Button variant="brand" size="sm"><Icon name="plus" size={15} color="#fff" /> New Collection</Button>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
        {D.collections.map((c) => (
          <div key={c.id} onClick={() => go("collection:" + c.id)} className="jig-lift" style={{ display: "flex", gap: 14, padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)", cursor: "pointer" }}>
            <div style={{ position: "relative", width: 74, height: 74, flexShrink: 0, borderRadius: "var(--radius-lg)", overflow: "hidden", background: `linear-gradient(150deg, ${c.c1}, ${c.c2})` }}>
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", opacity: 0.9 }}><Icon name={c.icon || "folder"} size={26} color="#fff" /></span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--text-strong)" }}>{c.name}</span>
                {c.visibility === "Private" && <Icon name="lock" size={13} color="var(--text-muted)" />}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{c.blurb}</div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}><Badge variant="default">{c.count} puzzles</Badge><span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Updated {c.updated}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================== COMPLETIONS ===== */
function Completions() {
  const total = D.completions.reduce((a, c) => a + c.pieceCount, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 1000 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {[["Puzzles completed", 37], ["Pieces placed", "84,250"], ["This year", 12]].map(([l, v], i) => (
          <div key={l} style={{ paddingLeft: i === 0 ? 0 : 24, borderLeft: i === 0 ? "none" : "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-4xl)", color: "var(--text-strong)", lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 6 }}>{l}</div>
          </div>
        ))}
      </div>
      <section>
        <SectionHead title="Completion Log" icon="circle-check" meta="Most recent first"
          action={<Button variant="brand" size="sm"><Icon name="plus" size={15} color="#fff" /> Log Completion</Button>} />
        {D.completions.map((c, i, a) => (
          <Row key={c.id} last={i === a.length - 1}>
            <CoverChip c1={c.color} c2={`color-mix(in oklab, ${c.color}, black 28%)`} icon="circle-check" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{c.title}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{c.pieceCount.toLocaleString()} pieces · finished in {c.days} days</div>
            </div>
            <Stars n={c.rating} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", width: 78, textAlign: "right" }}>{c.when}</span>
          </Row>
        ))}
      </section>
    </div>
  );
}

/* ================================================================= GOALS ===== */
function Goals() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 860 }}>
      <SectionHead title="2026 Goals" icon="target" meta="4 active"
        action={<Button variant="brand" size="sm"><Icon name="plus" size={15} color="#fff" /> New Goal</Button>} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {D.goals.map((g) => {
          const pct = Math.round((g.current / g.target) * 100);
          return (
            <div key={g.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ width: 36, height: 36, borderRadius: "var(--radius-full)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--jig-violet-50)", color: "var(--jig-violet-500)" }}><Icon name={g.icon} size={17} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-strong)" }}>{g.title}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>Due {g.deadline}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)", lineHeight: 1 }}>{pct}%</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{g.current}/{g.target} {g.unit}</div>
                </div>
              </div>
              <ProgressBar value={g.current} max={g.target} height={10} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================== INSIGHTS ===== */
function Insights() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const completed = [2, 1, 3, 2, 4, 3];
  const swapped = [1, 2, 1, 3, 2, 3];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30, maxWidth: 1000 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {[["Completion rate", "84%"], ["Avg. difficulty", "Hard"], ["Fastest finish", "2 days"], ["Pieces this yr", "24.6k"]].map(([l, v], i) => (
          <div key={l} style={{ paddingLeft: i === 0 ? 0 : 24, borderLeft: i === 0 ? "none" : "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-3xl)", color: "var(--text-strong)", lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 6 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--col-gap)" }}>
        <section>
          <SectionHead title="Completions / month" icon="bar-chart-3" />
          <Sparkbars data={completed} height={120} color="var(--jig-violet-400)" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>{months.map((m) => <span key={m} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m}</span>)}</div>
        </section>
        <section>
          <SectionHead title="Swaps / month" icon="arrow-left-right" />
          <Sparkbars data={swapped} height={120} color="var(--swap-green-400)" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>{months.map((m) => <span key={m} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m}</span>)}</div>
        </section>
      </div>
    </div>
  );
}

/* =============================================================== BROWSE ====== */
function Browse({ go }) {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("All");
  const filters = ["All", "Available", "Easy", "Medium", "Hard", "Expert"];
  const list = D.puzzles.filter((p) => {
    const t = q.trim().toLowerCase();
    if (t && !(p.title.toLowerCase().includes(t) || p.brand.toLowerCase().includes(t))) return false;
    if (filter === "All") return true;
    if (filter === "Available") return p.available;
    return p.difficulty === filter.toLowerCase();
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1140 }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}><Icon name="search" size={16} /></span>
        <Input placeholder="Search puzzles by title, brand, or theme…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 38, height: 44 }} />
      </div>
      <FilterBar filters={filters} value={filter} onChange={setFilter} count={`${list.length} puzzles found`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))", gap: 18 }}>
        {list.map((p) => <PuzzleCard key={p.id} title={p.title} brand={p.brand} pieceCount={p.pieceCount} difficulty={p.difficulty} coverColor={p.color} available={p.available} onView={() => {}} onAdd={() => go("exchanges")} />)}
      </div>
      {list.length === 0 && <Empty title="No puzzles found" sub="Try adjusting your search or filters." />}
    </div>
  );
}

/* =============================================================== CIRCLES ===== */
function Circles() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1000 }}>
      <SectionHead title="Your Circles" icon="users" meta="Private groups to swap within"
        action={<Button variant="brand" size="sm"><Icon name="plus" size={15} color="#fff" /> Create Circle</Button>} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {D.circles.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ width: 52, height: 52, borderRadius: "var(--radius-lg)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(150deg, ${c.color}, color-mix(in oklab, ${c.color}, black 30%))`, color: "#fff" }}><Icon name="users" size={22} color="#fff" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--text-strong)" }}>{c.name}</span>
                <Badge variant="default">{c.role}</Badge>
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{c.blurb}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", marginRight: 4 }}>
                {c.avatars.slice(0, 4).map((a, i) => <span key={i} style={{ marginLeft: i ? -10 : 0, borderRadius: "50%", boxShadow: "0 0 0 2px var(--surface-card)" }}><Avatar name={a} size="sm" /></span>)}
              </div>
              <Stat2 v={c.members} l="members" />
              <Stat2 v={c.shared} l="shared" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Stat2({ v, l }) { return <div style={{ textAlign: "center", minWidth: 56 }}><div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)", lineHeight: 1 }}>{v}</div><div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3 }}>{l}</div></div>; }

/* ============================================================= EXCHANGES ===== */
function Exchanges() {
  const [tab, setTab] = React.useState("All");
  const tabs = ["All", "Incoming", "Outgoing", "Completed"];
  const list = D.exchanges.filter((e) => tab === "All" ? true : tab === "Completed" ? e.status === "Completed" : e.dir === tab);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1000 }}>
      <FilterBar filters={tabs} value={tab} onChange={setTab} count={`${list.length} exchanges`} />
      <section>
        {list.map((e, i, a) => (
          <Row key={e.id} last={i === a.length - 1}>
            <CoverChip c1={e.color} c2={`color-mix(in oklab, ${e.color}, black 28%)`} icon={e.kind === "Lend" ? "package" : e.kind === "Sale" ? "tag" : "arrow-left-right"} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-strong)" }}>{e.kind} · {e.mine}{e.theirs ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> ↔ {e.theirs}</span> : null}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{e.dir} · with {e.who} · {e.when}</div>
            </div>
            <StatusPill status={e.status} />
            <Button variant="outline" size="sm">View</Button>
          </Row>
        ))}
      </section>
    </div>
  );
}

/* ============================================================== MESSAGES ===== */
function Messages() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 }}>
      <SectionHead title="Messages" icon="message-square" meta="2 unread" />
      {D.messages.map((m, i, a) => (
        <Row key={m.id} last={i === a.length - 1} onClick={() => {}}>
          <Avatar name={m.who} size="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: m.unread ? 700 : 600, color: "var(--text-strong)" }}>{m.who}</div>
            <div style={{ fontSize: "var(--text-sm)", color: m.unread ? "var(--text-body)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.last}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m.when}</span>
            {m.unread ? <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: "var(--radius-full)", background: "var(--action)", color: "var(--action-fg)", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{m.unread}</span> : null}
          </div>
        </Row>
      ))}
    </div>
  );
}

/* ================================================================ PEOPLE ===== */
function People() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000 }}>
      <SectionHead title="Community" icon="globe" meta="Members near Utrecht" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {D.people.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
            <Avatar name={p.name} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-strong)" }}>{p.name}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 1 }}><Icon name="map-pin" size={12} />{p.location}</div>
              <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                <span><strong style={{ color: "var(--text-strong)" }}>{p.owned}</strong> owned</span>
                <span><strong style={{ color: "var(--text-strong)" }}>{p.swaps}</strong> swaps</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="star" size={11} color="var(--amber-400, #f59e0b)" /><strong style={{ color: "var(--text-strong)" }}>{p.rating}</strong></span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =============================================================== PROFILE ===== */
function Profile() {
  const u = D.user;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34, maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, paddingBottom: 24, borderBottom: "1px solid var(--border)" }}>
        <Avatar name={u.name} size={84} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: "var(--text-3xl)" }}>{u.name}</h1>
          <div style={{ display: "flex", gap: 16, color: "var(--text-muted)", fontSize: "var(--text-sm)", marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="at-sign" size={14} />{u.username}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="map-pin" size={14} />{u.location}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="calendar" size={14} />Member since {u.since}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Badge variant="success">★ {u.rating} Trust</Badge>
          <Button variant="outline"><Icon name="pencil" size={15} /> Edit Profile</Button>
        </div>
      </div>
      <section>
        <SectionHead title="Mara's Shelf" icon="book-open" meta={`${D.shelf.length} on display`} />
        <PuzzlePlank boxes={D.shelf} />
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {D.stats.map((s, i) => (
          <div key={s.label} style={{ textAlign: "center", padding: "0 12px", borderLeft: i === 0 ? "none" : "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-4xl)", color: "var(--jig-violet-500)", lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 8 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- small helpers */
function FilterBar({ filters, value, onChange, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button key={f} onClick={() => onChange(f)} style={{ padding: "6px 13px", borderRadius: "var(--radius-full)", border: "1px solid " + (value === f ? "transparent" : "var(--border)"), background: value === f ? "var(--action)" : "var(--surface-card)", color: value === f ? "var(--action-fg)" : "var(--text-body)", fontSize: "var(--text-sm)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{f}</button>
        ))}
      </div>
      {count && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{count}</span>}
    </div>
  );
}
function Empty({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 0", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 34, marginBottom: 8 }}>🧩</div>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, color: "var(--text-strong)", fontSize: "var(--text-lg)" }}>{title}</div>
      <div style={{ fontSize: "var(--text-sm)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

/* ====================================================== SECTION LANDINGS ==== */
// Overview page for a nav group (My Library / Community) — the breadcrumb's
// parent target. A clean directory of the section's surfaces with live counts.
function GroupLanding({ groupKey, go }) {
  const g = D.groups.find((x) => x.key === groupKey);
  return (
    <div style={{ maxWidth: 820, display: "flex", flexDirection: "column" }}>
      {g.items.map((it, i, a) => (
        <Row key={it.id} last={i === a.length - 1} onClick={() => go(it.id)} style={{ gap: 16, padding: "17px 0" }}>
          <span style={{ width: 44, height: 44, borderRadius: "var(--radius-lg)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--jig-violet-50)", color: "var(--jig-violet-600)" }}>
            <Icon name={it.icon} size={19} color="var(--jig-violet-600)" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-strong)" }}>{it.title}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 1 }}>{it.desc}</div>
          </div>
          {it.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{it.count}</span>}
          {it.badge ? <Badge variant="default">{it.badge} new</Badge> : null}
          <Icon name="chevron-right" size={16} color="var(--text-muted)" />
        </Row>
      ))}
    </div>
  );
}

/* ===================================================== COLLECTION DETAIL ==== */
const DIFF_RANK = { easy: 0, medium: 1, hard: 2, expert: 3 };
const DIFF_LABEL = ["Easy", "Medium", "Hard", "Expert"];
function CollectionDetail({ id, go }) {
  const c = D.collections.find((x) => String(x.id) === String(id)) || D.collections[0];
  const items = c.puzzleIds.map((pid) => D.puzzles.find((p) => p.id === pid)).filter(Boolean);
  const pieces = items.reduce((a, p) => a + p.pieceCount, 0);
  const available = items.filter((p) => p.available).length;
  const avgRank = items.length ? Math.round(items.reduce((a, p) => a + (DIFF_RANK[p.difficulty] || 0), 0) / items.length) : 0;
  const mix = [0, 1, 2, 3].map((r) => items.filter((p) => DIFF_RANK[p.difficulty] === r).length);
  const DIFF_FILL = ["var(--swap-green-400)", "var(--amber-400)", "var(--orange-500, #f97316)", "var(--danger, #ef4444)"];
  const stats = [
    { v: items.length, l: "puzzles" },
    { v: pieces.toLocaleString(), l: "pieces total" },
    { v: DIFF_LABEL[avgRank], l: "avg. difficulty" },
    { v: available, l: "up for trade" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--block-gap)", maxWidth: 1140 }}>
      {/* hero band — the one place a tinted panel earns its keep */}
      <section style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0, borderRadius: "var(--radius-2xl, 20px)", overflow: "hidden", background: `linear-gradient(150deg, ${c.c1}, ${c.c2})`, boxShadow: "var(--shadow-md, 0 12px 30px -16px rgb(20 16 40 / .4))" }}>
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Icon name={c.icon || "folder"} size={46} color="#fff" /></span>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "var(--text-3xl)" }}>{c.name}</h1>
            <Badge variant={c.visibility === "Public" ? "success" : "default"}>{c.visibility === "Public" ? "Public" : "Private"}</Badge>
          </div>
          <p style={{ fontSize: "var(--text-base)", color: "var(--text-body)", margin: "8px 0 0", maxWidth: 620, textWrap: "pretty" }}>{c.note}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            <Button variant="brand" size="sm" onClick={() => go("add-puzzle")}><Icon name="plus" size={15} color="#fff" /> Add Puzzles</Button>
            <Button variant="outline" size="sm"><Icon name="share-2" size={15} /> Share</Button>
            <Button variant="ghost" size="sm"><Icon name="pencil" size={15} /> Edit</Button>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="clock" size={13} />Updated {c.updated}</span>
          </div>
        </div>
      </section>

      {/* stats strip + difficulty mix */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "var(--col-gap)", alignItems: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {stats.map((s, i) => (
            <div key={s.l} style={{ paddingLeft: i === 0 ? 0 : 22, borderLeft: i === 0 ? "none" : "1px solid var(--border)" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "var(--text-3xl)", color: "var(--text-strong)", lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 6 }}>{s.l}</div>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: "var(--font-mono)" }}>Difficulty mix</div>
          <div style={{ display: "flex", height: 12, borderRadius: "var(--radius-full)", overflow: "hidden", background: "var(--surface-muted)" }}>
            {mix.map((n, r) => n > 0 ? <div key={r} title={`${DIFF_LABEL[r]}: ${n}`} style={{ width: (n / items.length * 100) + "%", background: DIFF_FILL[r] }} /> : null)}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            {DIFF_LABEL.map((l, r) => mix[r] > 0 ? (
              <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: DIFF_FILL[r] }} />{l} · {mix[r]}
              </span>
            ) : null)}
          </div>
        </div>
      </div>

      {/* the puzzles */}
      <section>
        <SectionHead title="Puzzles in this Collection" icon="puzzle" meta={`${items.length} puzzles`} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))", gap: 18 }}>
          {items.map((p) => <PuzzleCard key={p.id} title={p.title} brand={p.brand} pieceCount={p.pieceCount} difficulty={p.difficulty} coverColor={p.color} available={p.available} onView={() => {}} onAdd={() => go("exchanges")} />)}
        </div>
        {items.length === 0 && <Empty title="This collection is empty" sub="Add puzzles to start curating this shelf." />}
      </section>
    </div>
  );
}

const SCREENS = {
  dashboard: window.DashboardV2 || Dashboard, puzzles: MyPuzzles, collections: Collections, completions: Completions,
  goals: Goals, insights: Insights, browse: Browse, circles: Circles, exchanges: Exchanges,
  messages: Messages, people: People, profile: Profile,
  "add-puzzle": (p) => <AddPuzzle go={p.go} />,
  collection: (p) => <CollectionDetail id={p.param} go={p.go} />,
  library: (p) => <GroupLanding groupKey="library" {...p} />,
  community: (p) => <GroupLanding groupKey="community" {...p} />,
};
Object.assign(window, { SCREENS });
