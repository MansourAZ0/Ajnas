/**
 * The animated zand (زند): a drawn oud neck that shows where each note lies
 * and reacts to what is heard. The canvas holds the wood, strings and motion;
 * an SVG layer above it keeps every target a focusable button, and note
 * labels are HTML so quarter-tone glyphs and Arabic script render properly.
 *
 * The canvas animates only while something moves (a sounding note, a fading
 * string or a ripple) and stops otherwise; the static wood is cached.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { NoteName } from "@naghma/ui";
import type { PerformanceStore } from "../lib/live";
import { FRESH_MS } from "../lib/liveHooks";
import {
  INTONATION_COLOURS,
  ZAND_VIEW,
  across,
  intonation,
  staticNoteKey,
  zandMarks,
  zandPoint,
  type ZandMark,
} from "../lib/zand";
import type { Fingerboard as Board, Settings, Target } from "../lib/types";

const V = ZAND_VIEW;
/** Strings continue past the fingerboard end towards the bridge. */
const STRING_END = V.width;
const PAIR_GAP = 3.2;
const RIPPLE_MS = 700;
/** Visual (not acoustic) vibration rate of a sounding string, per second. */
const WOBBLE_HZ = 11;

interface Ripple {
  x: number;
  y: number;
  colour: string;
  born: number;
}

export const AnimatedZand = memo(function AnimatedZand({
  store,
  board,
  settings,
  selected,
  onSelect,
}: {
  store: PerformanceStore;
  board: Board;
  settings: Settings;
  selected: Target | null;
  onSelect: (target: Target) => void;
}) {
  const ar = settings.language === "ar";
  const marks = useMemo(() => zandMarks(board), [board]);
  const targets = useMemo(
    () => new Map(board.targets.map((t) => [t.id, t])),
    [board],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const courses = board.courses.length;
  const labelled = !!board.scale;

  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d");
    if (!context) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const still = () => settings.visuals === "off" || media.matches;
    const reduced = () => settings.visuals === "reduced";
    let wood: HTMLCanvasElement | null = null;
    let scale = 1;
    let frame = 0;
    let lastEvent = -1;
    let lastKey = "";
    let lastTime = performance.now();
    const energy = new Array<number>(courses).fill(0);
    const stop = new Array<number>(courses).fill(0);
    let ripples: Ripple[] = [];

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(element.clientWidth * dpr));
      const height = Math.max(1, Math.round(element.clientHeight * dpr));
      if (element.width === width && element.height === height && wood) return;
      element.width = width;
      element.height = height;
      scale = width / V.width;
      wood = paintWood(width, height, scale, marks, labelled);
      lastKey = "";
      kick();
    };

    const fresh = () => {
      const note = store.frame?.note;
      return note && performance.now() - store.receivedAt < FRESH_MS
        ? note
        : null;
    };

    const draw = (now: number) => {
      frame = 0;
      const dt = Math.min(100, now - lastTime);
      lastTime = now;
      const note = fresh();
      const level = Math.max(
        0,
        Math.min(1, ((store.frame?.levelDb ?? -90) + 60) / 50),
      );
      const decay = Math.exp(-dt / 260);
      for (let c = 0; c < courses; c++) {
        const position = note?.positions.find((p) => p.course === c);
        if (position) {
          energy[c] = Math.max(energy[c] * decay, 0.35 + 0.65 * level);
          stop[c] = position.distanceMm / board.fingerboardLengthMm;
        } else energy[c] *= decay;
        if (energy[c] < 0.01) energy[c] = 0;
      }
      ripples = ripples.filter((r) => now - r.born < RIPPLE_MS);
      const moving = energy.some((e) => e > 0) || ripples.length > 0;
      // Reduced motion: redraw only when what is shown changes.
      const key = still() ? staticNoteKey(note) : "";
      if (still() && key === lastKey) return;
      lastKey = key;

      const { width, height } = element;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      if (wood) context.drawImage(wood, 0, 0);
      context.setTransform(scale, 0, 0, scale, 0, 0);

      const amplitude = still() ? 0 : reduced() ? 1.4 : 3.6;
      const t = now / 1000;
      for (let c = 0; c < courses; c++) {
        const a = across(c, courses);
        const e = energy[c];
        for (const pair of [0, 1]) {
          const offset = (pair - 0.5) * PAIR_GAP;
          drawString(
            context,
            a,
            offset,
            c === 0 ? 1.6 : 0.85,
            e > 0 ? stop[c] : 1,
            e * amplitude,
            2 * Math.PI * WOBBLE_HZ * t + c * 1.3 + pair * 0.4,
            e,
          );
        }
      }

      if (note) {
        const colour = INTONATION_COLOURS[intonation(note.cents)];
        for (const p of note.positions) {
          const { x, y } = zandPoint(
            p.distanceMm / board.fingerboardLengthMm,
            across(p.course, courses),
          );
          const glow = context.createRadialGradient(x, y, 0, x, y, 22);
          glow.addColorStop(0, colour + "cc");
          glow.addColorStop(0.35, colour + "55");
          glow.addColorStop(1, colour + "00");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, 22, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = colour;
          context.beginPath();
          context.arc(x, y, 4.5, 0, Math.PI * 2);
          context.fill();
        }
      }
      for (const r of ripples) {
        const age = (now - r.born) / RIPPLE_MS;
        context.strokeStyle = r.colour;
        context.globalAlpha = (1 - age) * 0.8;
        context.lineWidth = 2 * (1 - age) + 0.5;
        context.beginPath();
        context.arc(r.x, r.y, 6 + age * 34, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
      if (moving || note) kick();
    };

    function kick() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    const unsubscribe = store.subscribe((f) => {
      const note = f?.note;
      if (note && note.eventId !== lastEvent && !note.holding) {
        lastEvent = note.eventId;
        if (!still() && !reduced()) {
          const colour = INTONATION_COLOURS[intonation(note.cents)];
          const born = performance.now();
          for (const p of note.positions) {
            const point = zandPoint(
              p.distanceMm / board.fingerboardLengthMm,
              across(p.course, courses),
            );
            ripples.push({ ...point, colour, born });
          }
        }
      }
      kick();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    media.addEventListener("change", kick);
    resize();
    return () => {
      unsubscribe();
      observer.disconnect();
      media.removeEventListener("change", kick);
      cancelAnimationFrame(frame);
    };
  }, [store, board, marks, courses, labelled, settings.visuals]);

  const ticks = [0, 50, 100, 150, 200, 250, 300].filter(
    (mm) => mm <= board.fingerboardLengthMm,
  );
  return (
    <div className="fingerboard-wrap" dir="ltr">
      <div className="zand">
        <canvas ref={canvas} className="zand-canvas" aria-hidden="true" />
        <svg
          className="zand-targets"
          viewBox={`0 0 ${V.width} ${V.height}`}
          aria-label={ar ? "مواضع النغمات على زند العود" : "Oud neck (zand)"}
        >
          {board.courses.map((course, i) => (
            <text
              key={i}
              x={V.left - 30}
              y={zandPoint(0, across(i, courses)).y + 4}
              textAnchor="end"
              className="zand-course"
            >
              {course.text}
            </text>
          ))}
          {ticks.map((mm) => (
            <text
              key={mm}
              x={zandPoint(mm / board.fingerboardLengthMm, 1).x}
              y={V.height - 5}
              textAnchor="middle"
              className="zand-tick"
            >
              {mm} mm
            </text>
          ))}
          {marks.map((mark) => (
            <TargetMark
              key={mark.key}
              mark={mark}
              target={targets.get(mark.targetId)!}
              chosen={mark.targetId === selected?.id}
              arabic={ar}
              onSelect={onSelect}
            />
          ))}
        </svg>
        {labelled && (
          <div className="zand-labels" aria-hidden="true">
            {marks.map((mark) => {
              // Open strings are already named beside the nut.
              if (mark.open) return null;
              const { x, y } = zandPoint(mark.along, mark.across);
              return (
                <span
                  key={mark.key}
                  className={`zand-label ${mark.tonic ? "tonic" : ""} ${mark.targetId === selected?.id ? "chosen" : ""}`}
                  style={{
                    left: `${(x / V.width) * 100}%`,
                    top: `${(y / V.height) * 100}%`,
                  }}
                >
                  <NoteName
                    label={mark.label}
                    style={settings.accidentalStyle}
                  />
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="board-key">
        <span>
          <i className="dot gold" />{" "}
          {ar ? "النغمة المختارة" : "Selected target"}
        </span>
        <span>
          <i
            className="dot"
            style={{ background: INTONATION_COLOURS.inTune }}
          />{" "}
          {ar ? "مضبوطة ±١٠ سنت" : "In tune ±10 cents"}
        </span>
        <span>
          <i className="dot" style={{ background: INTONATION_COLOURS.flat }} />{" "}
          {ar ? "منخفضة" : "Flat"}
        </span>
        <span>
          <i className="dot" style={{ background: INTONATION_COLOURS.sharp }} />{" "}
          {ar ? "مرتفعة" : "Sharp"}
        </span>
        <span>
          {ar
            ? "الهالات: مدى ±١٠ سنت حول كل موضع نظري"
            : "Halos: ±10 cents around each theoretical position"}
        </span>
      </div>
      {selected && (
        <div className="selected-note">
          <NoteName label={selected.label} style={settings.accidentalStyle} />
          <span>
            <bdi>{selected.soundingHz.toFixed(2)} Hz</bdi> ·{" "}
            {selected.positions.length}{" "}
            {ar ? "مواضع ممكنة" : "possible positions"}
          </span>
        </div>
      )}
    </div>
  );
});

function TargetMark({
  mark,
  target,
  chosen,
  arabic,
  onSelect,
}: {
  mark: ZandMark;
  target: Target;
  chosen: boolean;
  arabic: boolean;
  onSelect: (target: Target) => void;
}) {
  const { x, y } = zandPoint(mark.along, mark.across);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${mark.label.text}, ${arabic ? "وتر" : "course"} ${mark.course + 1}, ${mark.distanceMm.toFixed(1)} mm`}
      onClick={() => onSelect(target)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(target);
        }
      }}
      className={`finger-target zand-target ${mark.quarterTone ? "quarter" : ""} ${mark.tonic ? "tonic" : ""} ${chosen ? "chosen" : ""}`}
    >
      <title>
        {mark.label.text} · {mark.distanceMm.toFixed(1)} mm
      </title>
      {chosen && <circle className="zand-halo" cx={x} cy={y} r={15} />}
      <circle cx={x} cy={y} r={chosen ? 9 : mark.tonic ? 6 : 4.5} />
      {chosen && (
        <text x={x} y={y + 3.5} textAnchor="middle" className="zand-course-no">
          {mark.course + 1}
        </text>
      )}
    </g>
  );
}

/** One string of a course pair; the part beyond the stop vibrates. */
function drawString(
  context: CanvasRenderingContext2D,
  acrossValue: number,
  offset: number,
  width: number,
  stopAlong: number,
  amplitude: number,
  phase: number,
  energy: number,
) {
  const at = (along: number) => {
    const p = zandPoint(along, acrossValue);
    return { x: p.x, y: p.y + offset };
  };
  const nut = at(0);
  const stopPoint = at(stopAlong);
  const endY = at(1).y;
  context.lineCap = "round";
  context.strokeStyle =
    energy > 0 ? `rgba(255,240,205,${0.55 + 0.45 * energy})` : "#d9cba8a6";
  context.lineWidth = width + energy * 0.6;
  context.beginPath();
  context.moveTo(nut.x, nut.y);
  context.lineTo(stopPoint.x, stopPoint.y);
  if (amplitude <= 0.01) {
    context.lineTo(STRING_END, endY);
    context.stroke();
    return;
  }
  // Fundamental standing wave between the stop and the bridge side.
  const segments = 28;
  const swing = Math.sin(phase) * amplitude;
  for (let i = 1; i <= segments; i++) {
    const u = i / segments;
    const x = stopPoint.x + (STRING_END - stopPoint.x) * u;
    const along = (x - V.left) / (V.right - V.left);
    const base = along <= 1 ? at(along).y : endY;
    context.lineTo(x, base + Math.sin(Math.PI * u) * swing);
  }
  context.stroke();
}

/** Wood, nut, soundboard edge and intonation halos; redrawn only on resize or a new board. */
function paintWood(
  width: number,
  height: number,
  scale: number,
  marks: ZandMark[],
  labelled: boolean,
): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const c = layer.getContext("2d")!;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  const edge = (along: number, side: number) =>
    zandPoint(along, side < 0 ? -0.13 : 1.13);

  // Soundboard (spruce) beyond the fingerboard end.
  const body = c.createRadialGradient(
    V.right + 320,
    138,
    40,
    V.right + 320,
    138,
    360,
  );
  body.addColorStop(0, "#5a4a33");
  body.addColorStop(1, "#2c241a");
  c.fillStyle = body;
  c.beginPath();
  c.ellipse(V.right + 330, (V.top + V.bottom) / 2, 360, 190, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#8a6e4655";
  c.lineWidth = 1.2;
  c.stroke();

  // Fingerboard (ebony), tapering towards the nut.
  c.beginPath();
  const top0 = edge(0, -1),
    top1 = edge(1.02, -1),
    bottom1 = edge(1.02, 1),
    bottom0 = edge(0, 1);
  c.moveTo(top0.x - 8, top0.y);
  c.lineTo(top1.x, top1.y);
  c.quadraticCurveTo(
    top1.x + 14,
    (top1.y + bottom1.y) / 2,
    bottom1.x,
    bottom1.y,
  );
  c.lineTo(bottom0.x - 8, bottom0.y);
  c.closePath();
  const ebony = c.createLinearGradient(0, top0.y, 0, bottom0.y);
  ebony.addColorStop(0, "#3a2e24");
  ebony.addColorStop(0.5, "#241c16");
  ebony.addColorStop(1, "#1a1410");
  c.fillStyle = ebony;
  c.shadowColor = "#00000080";
  c.shadowBlur = 18;
  c.shadowOffsetY = 6;
  c.fill();
  c.shadowColor = "transparent";
  c.save();
  c.clip();
  // Deterministic grain, so the wood looks the same on every redraw.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const a = random() * 1.3 - 0.15;
    c.strokeStyle = `rgba(${random() > 0.5 ? "255,220,170" : "0,0,0"},${0.025 + random() * 0.05})`;
    c.lineWidth = 0.5 + random() * 1.4;
    c.beginPath();
    for (let x = V.left - 10; x <= V.right + 20; x += 40) {
      const along = (x - V.left) / (V.right - V.left);
      const y =
        zandPoint(along, a).y + Math.sin(x / (60 + random() * 90) + i) * 2.5;
      if (x === V.left - 10) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  c.restore();
  c.strokeStyle = "#ffffff14";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(top0.x - 8, top0.y);
  c.lineTo(top1.x, top1.y);
  c.stroke();

  // Nut (bone).
  const nut = c.createLinearGradient(V.left - 8, 0, V.left, 0);
  nut.addColorStop(0, "#c9b994");
  nut.addColorStop(1, "#f3e8cc");
  c.fillStyle = nut;
  c.fillRect(V.left - 8, top0.y - 4, 8, bottom0.y - top0.y + 8);

  // Intonation halos: ±ZONE_CENTS around each position.
  for (const mark of marks) {
    if (mark.open) continue;
    const from = zandPoint(mark.zone[0], mark.across);
    const to = zandPoint(mark.zone[1], mark.across);
    const tint = mark.quarterTone ? "118,189,178" : "222,192,138";
    const alpha = labelled ? (mark.tonic ? 0.45 : 0.32) : 0.16;
    c.fillStyle = `rgba(${tint},${alpha})`;
    c.beginPath();
    c.roundRect(from.x, from.y - 5, Math.max(3, to.x - from.x), 10, 5);
    c.fill();
  }
  return layer;
}
