import { Image } from "@/compat/image";
import * as React from "react";

// The signature "puzzle plank" motif for the logged-in app: 3D puzzle boxes on
// a wooden shelf with a finished right-hand end cap. Adapted from the marketing
// plank (components/marketing/plank.tsx) but bound to app tokens instead, so it
// can render a member's real collection on the dashboard. Boxes show real cover
// art when a thumbnail exists and fall back to a flat painted box with the title
// and piece count — never an empty gray box. Kept as inline styles — it's a
// bespoke isometric illustration, not layout.

export interface PuzzlePlankBox {
  title?: string;
  series?: string;
  pieceCount?: number;
  cover?: string;
  c1?: string;
  c2?: string;
  width?: number;
  height?: number;
}

export function PuzzlePlank({
  boxes = [],
  depth = 18,
  style,
}: {
  boxes?: PuzzlePlankBox[];
  depth?: number;
  style?: React.CSSProperties;
}) {
  const sd = depth + 24; // shelf top-surface depth
  const inset = depth - 1;
  const lip = 16; // shelf front-face thickness
  return (
    <div
      style={{
        position: "relative",
        width: "fit-content",
        margin: "0 auto",
        ...style,
      }}
    >
      {/* shelf top surface (recedes up-right) */}
      <div
        style={{
          position: "absolute",
          zIndex: 1,
          left: -16,
          right: -16,
          bottom: 0,
          height: sd,
          transformOrigin: "bottom left",
          transform: "skewX(-45deg)",
          background: "var(--mk-plank)",
        }}
      />
      {/* boxes, set back onto the shelf */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "flex-end",
          gap: depth * 2 + 2,
          padding: "0 46px",
          transform: `translate(${inset}px, ${-inset}px)`,
        }}
      >
        {boxes.map((b, i) => (
          <PlankBox key={i} {...b} depth={depth} />
        ))}
      </div>
      {/* shelf front lip (projects toward viewer) */}
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: -16,
          right: -16,
          bottom: -lip,
          height: lip,
          background: "color-mix(in oklab, var(--mk-plank), black 16%)",
        }}
      >
        {/* RIGHT end cap — the shelf's side face, receding up-right like the boxes' sides */}
        <div
          style={{
            position: "absolute",
            left: "100%",
            top: 0,
            width: sd,
            height: lip,
            transformOrigin: "top left",
            transform: "skewY(-45deg)",
            background: "color-mix(in oklab, var(--mk-plank), black 32%)",
          }}
        />
      </div>
    </div>
  );
}

function PlankBox({
  title,
  series,
  pieceCount,
  cover,
  c1 = "var(--jigsaw-primary)",
  c2 = "var(--jigsaw-primary)",
  width = 116,
  height,
  depth = 18,
}: PuzzlePlankBox & { depth?: number }) {
  const isArt = !!cover;
  const [boxH, setBoxH] = React.useState(
    height || (isArt ? Math.round(width / 1.4) : 144),
  );
  const onImg = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    if (im.naturalWidth)
      setBoxH(Math.round(width / (im.naturalWidth / im.naturalHeight)));
  };
  return (
    <div
      style={{ position: "relative", width, height: boxH, marginTop: depth }}
    >
      {/* box top face */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -depth,
          width,
          height: depth,
          background: `color-mix(in oklab, ${c1}, white 30%)`,
          transformOrigin: "bottom left",
          transform: "skewX(-45deg)",
        }}
      />
      {/* box side face */}
      <div
        style={{
          position: "absolute",
          left: width,
          top: 0,
          width: depth,
          height: boxH,
          background: `color-mix(in oklab, ${c2}, black 30%)`,
          transformOrigin: "top left",
          transform: "skewY(-45deg)",
        }}
      />
      {/* box front */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: c1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "inset 0 0 0 1px rgb(0 0 0 / .12)",
        }}
      >
        {isArt ? (
          <Image
            src={cover ?? ""}
            alt={title || ""}
            fill
            className="object-cover"
            onLoad={onImg}
            onError={(e) => e.currentTarget.remove()}
          />
        ) : (
          <>
            {series && (
              <div
                style={{
                  position: "relative",
                  fontWeight: 600,
                  fontSize: 11,
                  color: "rgb(255 255 255 / .92)",
                  padding: "6px 8px 0",
                }}
              >
                {series}
              </div>
            )}
            <div style={{ flex: 1, position: "relative" }}>
              {pieceCount != null && (
                <div
                  style={{
                    position: "absolute",
                    top: 7,
                    right: 7,
                    minWidth: 28,
                    height: 28,
                    padding: "0 4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#fff",
                    borderRadius: 9999,
                    fontWeight: 600,
                    fontSize: 11,
                    lineHeight: 1,
                    color: "var(--jigsaw-on-gold)",
                  }}
                >
                  {pieceCount}
                </div>
              )}
            </div>
            {title && (
              <div
                style={{
                  position: "relative",
                  background: "#fff",
                  padding: "5px 8px 6px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 11,
                    color: "var(--jigsaw-on-gold)",
                    lineHeight: 1.1,
                    textAlign: "center",
                  }}
                >
                  {title}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
