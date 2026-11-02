import { Image } from "@/compat/image";
import { FitToWidth } from "@/components/marketing/fit-to-width";
import * as React from "react";

// The signature "puzzle plank" motif: 3D puzzle boxes on a wooden shelf with a
// finished right-hand end cap. Ported 1:1 from the design handoff (shell.jsx);
// kept as inline styles — it's a bespoke isometric illustration, not layout.

export interface PlankBox {
  title?: string;
  series?: string;
  pieceCount?: number;
  cover?: string;
  c1?: string;
  c2?: string;
  width?: number;
  height?: number;
}

const SHELF_LIP = 16; // the shelf's front-face thickness
const SHELF_OVERHANG = 16; // how far the shelf runs past the boxes on each side
const SHELF_SHADOW = 27; // how far the shadow under the lip reaches

/** The shelf's top-surface depth, which is also the width of its right end cap. */
const shelfDepth = (depth: number) => depth + 24;

export function JigPlank({
  boxes = [],
  depth = 18,
  style,
}: {
  boxes?: PlankBox[];
  depth?: number;
  style?: React.CSSProperties;
}) {
  const sd = shelfDepth(depth);
  const inset = depth - 1;
  const lip = SHELF_LIP;
  return (
    // Decorative illustration: the sample box titles, series and "pcs"
    // labels are not content, so screen readers skip the whole shelf.
    <div
      aria-hidden="true"
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
          left: -SHELF_OVERHANG,
          right: -SHELF_OVERHANG,
          bottom: 0,
          height: sd,
          transformOrigin: "bottom left",
          transform: "skewX(-45deg)",
          background:
            "repeating-linear-gradient(90deg, rgb(90 55 20 / .12) 0 1px, transparent 1px 15px), linear-gradient(170deg, #e0ae6e, #c98f4d)",
          boxShadow: "inset 0 2px 0 rgb(255 255 255 / .22)",
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
          <JigBox key={i} {...b} depth={depth} />
        ))}
      </div>
      {/* shelf front lip (projects toward viewer) */}
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: -SHELF_OVERHANG,
          right: -SHELF_OVERHANG,
          bottom: -lip,
          height: lip,
          background: "linear-gradient(180deg, #bd8449, #91602e)",
          boxShadow: "0 15px 22px -10px rgb(120 72 22 / .5)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 2,
            background: "rgb(255 255 255 / .3)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            background: "rgb(60 36 14 / .45)",
          }}
        />
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
            background: "linear-gradient(90deg, #8a5a28, #6f4519)",
            boxShadow: "inset 1px 0 0 rgb(255 255 255 / .12)",
          }}
        />
      </div>
    </div>
  );
}

/**
 * A JigPlank that scales down to fit its container. The boxes' top faces, the shelf's lip, shadow
 * and end cap all paint past the plank's layout box, and FitToWidth clips at its own edge, so the
 * layout box is padded by exactly that much: the whole shelf shows and counts towards the fit.
 */
export function FittedPlank({
  boxes,
  depth = 18,
}: {
  boxes: PlankBox[];
  depth?: number;
}) {
  const top = depth;
  const right = SHELF_OVERHANG + shelfDepth(depth);
  const bottom = SHELF_LIP + SHELF_SHADOW;
  return (
    <FitToWidth>
      <div
        style={{
          padding: `${top}px ${right}px ${bottom}px ${SHELF_OVERHANG}px`,
        }}
      >
        <JigPlank boxes={boxes} depth={depth} />
      </div>
    </FitToWidth>
  );
}

function JigBox({
  title,
  series,
  pieceCount,
  cover,
  c1 = "var(--mk-violet-400)",
  c2 = "var(--mk-violet-600)",
  width = 116,
  height,
  depth = 18,
}: PlankBox & { depth?: number }) {
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
          background: `linear-gradient(180deg, color-mix(in oklab, ${c1}, white 42%), color-mix(in oklab, ${c1}, white 24%))`,
          transformOrigin: "bottom left",
          transform: "skewX(-45deg)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / .35)",
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
          background: `linear-gradient(90deg, color-mix(in oklab, ${c2}, black 26%), color-mix(in oklab, ${c2}, black 40%))`,
          transformOrigin: "top left",
          transform: "skewY(-45deg)",
        }}
      />
      {/* soft cast shadow */}
      <div
        style={{
          position: "absolute",
          left: 5,
          bottom: -2,
          width,
          height: depth,
          background: "rgb(70 42 16 / .30)",
          transformOrigin: "bottom left",
          transform: "skewX(-45deg)",
          filter: "blur(3px)",
          zIndex: -1,
        }}
      />
      {/* box front */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          background: `linear-gradient(158deg, ${c1}, ${c2})`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow:
            "inset 0 0 0 1px rgb(0 0 0 / .12), inset 1.5px 1.5px 0 rgb(255 255 255 / .22), inset -2px -3px 5px rgb(0 0 0 / .16)",
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
                  fontFamily: "var(--font-mk-heading)",
                  fontWeight: 700,
                  fontSize: 9.5,
                  letterSpacing: ".03em",
                  color: "rgb(255 255 255 / .92)",
                  padding: "6px 8px 0",
                  textTransform: "uppercase",
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
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#fff",
                    borderRadius: 9999,
                    boxShadow: "0 1px 3px rgb(16 24 40 / .3)",
                  }}
                >
                  <b
                    style={{
                      fontFamily: "var(--font-mk-heading)",
                      fontWeight: 700,
                      fontSize: 11,
                      lineHeight: 1,
                      color: "#1f1b2e",
                    }}
                  >
                    {pieceCount}
                  </b>
                  <span
                    style={{
                      fontSize: 5.5,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "#5f596d",
                    }}
                  >
                    pcs
                  </span>
                </div>
              )}
            </div>
            {title && (
              <div
                style={{
                  position: "relative",
                  background: "#fff",
                  padding: "5px 8px 6px",
                  boxShadow: "inset 0 1px 0 rgb(0 0 0 / .08)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mk-heading)",
                    fontWeight: 700,
                    fontSize: 11,
                    color: "#1f1b2e",
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
