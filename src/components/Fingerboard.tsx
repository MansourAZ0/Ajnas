import { NoteName } from "@naghma/ui";
import type { Fingerboard as Board, Settings, Target } from "../lib/types";

export function Fingerboard({
  board,
  settings,
  selected,
  onSelect,
  activePitch,
}: {
  board: Board;
  settings: Settings;
  selected: Target | null;
  onSelect: (target: Target) => void;
  activePitch?: number;
}) {
  const width = 960,
    height = 282,
    left = 100,
    right = 920,
    top = 38,
    gap = 40;
  const x = (distance: number) =>
    left + (distance / board.fingerboardLengthMm) * (right - left);
  return (
    <div className="fingerboard-wrap" dir="ltr">
      <svg
        className="fingerboard"
        viewBox={`0 0 ${width} ${height}`}
        aria-label={
          settings.language === "ar"
            ? "مواضع النغمات على العود"
            : "Interactive oud fingerboard"
        }
      >
        <defs>
          <linearGradient id="wood" x2="0" y2="1">
            <stop stopColor="#41372b" />
            <stop offset="1" stopColor="#241f1b" />
          </linearGradient>
        </defs>
        <rect
          x={left - 15}
          y={top - 20}
          width={right - left + 30}
          height={gap * 5 + 40}
          rx="12"
          fill="url(#wood)"
        />
        {[0, 50, 100, 150, 200, 250, 300]
          .filter((mm) => mm <= board.fingerboardLengthMm)
          .map((mm) => (
            <g key={mm}>
              <line
                x1={x(mm)}
                x2={x(mm)}
                y1={top - 20}
                y2={top + 5 * gap + 20}
                stroke="#ffffff0b"
              />
              <text
                x={x(mm)}
                y={height - 5}
                textAnchor="middle"
                fill="#94a5a1"
                fontSize="11"
              >
                {mm} mm
              </text>
            </g>
          ))}
        {board.courses.map((course, i) => (
          <g key={i}>
            <text
              x={left - 30}
              y={top + i * gap + 5}
              textAnchor="end"
              fill="#ccd6d0"
              fontSize="13"
            >
              {course.text}
            </text>
            {[0, 3].map((pair) => (
              <line
                key={pair}
                x1={left}
                x2={right}
                y1={top + i * gap + pair - 1.5}
                y2={top + i * gap + pair - 1.5}
                stroke={i === 0 ? "#bda87b" : "#d6c9ac"}
                strokeWidth={i === 0 ? 1.5 : 0.7}
                opacity=".65"
              />
            ))}
          </g>
        ))}
        <line
          x1={left}
          x2={left}
          y1={top - 18}
          y2={top + gap * 5 + 18}
          stroke="#eee1bf"
          strokeWidth="4"
        />
        {board.targets.flatMap((target) =>
          target.positions.map((pos) => {
            const chosen = target.id === selected?.id;
            const active =
              activePitch !== undefined &&
              Math.abs(target.playerPitch - activePitch) < 0.15;
            const key = target.id + "-" + pos.course;
            return (
              <g
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`${target.label.text}, ${settings.language === "ar" ? "وتر" : "course"} ${pos.course + 1}, ${pos.distanceMm.toFixed(1)} mm`}
                onClick={() => onSelect(target)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(target);
                  }
                }}
                className="finger-target"
              >
                <title>
                  {target.label.text} · {pos.distanceMm.toFixed(1)} mm
                </title>
                <circle
                  cx={x(pos.distanceMm)}
                  cy={top + pos.course * gap}
                  r={chosen ? 11 : active ? 9 : 5}
                  fill={
                    chosen
                      ? "#e2c48c"
                      : active
                        ? "#73c9b7"
                        : target.label.accidentalQuarterTones % 2
                          ? "#5a8c8a"
                          : "#a69a7b"
                  }
                  stroke={chosen ? "#fff0cd" : "#1a2525"}
                  strokeWidth={chosen ? 2 : 1}
                />
                {chosen && (
                  <text
                    x={x(pos.distanceMm)}
                    y={top + pos.course * gap + 4}
                    textAnchor="middle"
                    fill="#192424"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {pos.course + 1}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
      <div className="board-key">
        <span>
          <i className="dot gold" />{" "}
          {settings.language === "ar" ? "النغمة المختارة" : "Selected target"}
        </span>
        <span>
          <i className="dot teal" />{" "}
          {settings.language === "ar" ? "الصوت المسموع" : "Acoustic match"}
        </span>
        <span>
          {settings.language === "ar"
            ? "المواضع النظرية من العتبة"
            : "Theoretical distance from the nut"}
        </span>
      </div>
      {selected && (
        <div className="selected-note">
          <NoteName label={selected.label} style={settings.accidentalStyle} />
          <span>
            <bdi>{selected.soundingHz.toFixed(2)} Hz</bdi> ·{" "}
            {selected.positions.length}{" "}
            {settings.language === "ar" ? "مواضع ممكنة" : "possible positions"}
          </span>
        </div>
      )}
    </div>
  );
}
