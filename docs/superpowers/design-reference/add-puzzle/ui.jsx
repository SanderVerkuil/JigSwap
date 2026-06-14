// Shared UI helpers used across shells and screens.
// Exports to window: Icon, SectionHead, ProgressBar, Sparkbars, StatusPill, Stars, RAW
const { useEffect: _ue, useRef: _ur, useState: _us } = React;

function toPascal(s) { return s.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join(""); }

// Lucide icon — builds the SVG directly from the icon node (no full-document rescans).
function Icon({ name, size = 18, color = "currentColor", strokeWidth = 2, style = {} }) {
  const ref = _ur(null);
  _ue(() => {
    const L = window.lucide;
    if (!L || !ref.current) return;
    const node = (L.icons && L.icons[toPascal(name)]) || (L.icons && L.icons[name]);
    ref.current.innerHTML = "";
    if (node && L.createElement) {
      const svg = L.createElement(node);
      svg.setAttribute("width", size); svg.setAttribute("height", size);
      svg.setAttribute("stroke-width", strokeWidth);
      ref.current.appendChild(svg);
    } else {
      const i = document.createElement("i");
      i.setAttribute("data-lucide", name);
      ref.current.appendChild(i);
      L.createIcons && L.createIcons({ attrs: { width: size, height: size, "stroke-width": strokeWidth } });
    }
  }, [name, size, strokeWidth]);
  return <span ref={ref} style={{ display: "inline-flex", color, lineHeight: 0, flexShrink: 0, ...style }} />;
}

// Section heading: title + thin rule + optional meta / action (card-free language).
function SectionHead({ title, meta, action, icon, style = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border)", marginBottom: 18, ...style }}>
      <h2 style={{ fontSize: "var(--text-xl)", display: "flex", alignItems: "center", gap: 9, whiteSpace: "nowrap" }}>
        {icon && <Icon name={icon} size={18} color="var(--jig-violet-500)" />}{title}
      </h2>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {meta && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textAlign: "right" }}>{meta}</span>}
        {action}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color = "var(--jig-violet-500)", height = 8 }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div style={{ width: "100%", height, borderRadius: "var(--radius-full)", background: "var(--surface-muted)", overflow: "hidden" }}>
      <div style={{ width: pct + "%", height: "100%", borderRadius: "var(--radius-full)", background: color, transition: "width .5s var(--ease-out)" }} />
    </div>
  );
}

function Sparkbars({ data, color = "var(--jig-violet-400)", height = 46 }) {
  const max = Math.max(...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, height: Math.max(6, (d / max) * height) + "px", background: color, borderRadius: 3, opacity: 0.45 + 0.55 * (d / max) }} />
      ))}
    </div>
  );
}

const STATUS_TONE = {
  "Pending": ["var(--amber-100, #fef3c7)", "var(--amber-700, #b45309)"],
  "Accepted": ["var(--jig-violet-50)", "var(--jig-violet-600)"],
  "In Transit": ["var(--jig-violet-50)", "var(--jig-violet-600)"],
  "Completed": ["color-mix(in oklab, var(--swap-green-400) 18%, transparent)", "var(--swap-green-700)"],
};
function StatusPill({ status }) {
  const [bg, fg] = STATUS_TONE[status] || ["var(--surface-muted)", "var(--text-muted)"];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--radius-full)", background: bg, color: fg, fontSize: "var(--text-xs)", fontWeight: 700 }}>{status}</span>;
}

function Stars({ n, size = 13 }) {
  return (
    <span style={{ display: "inline-flex", gap: 1, color: "var(--amber-400, #f59e0b)" }}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} color={i <= n ? "var(--amber-400, #f59e0b)" : "var(--border)"} style={{ }} />)}
    </span>
  );
}

Object.assign(window, { Icon, SectionHead, ProgressBar, Sparkbars, StatusPill, Stars });
