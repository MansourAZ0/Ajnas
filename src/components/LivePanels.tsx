/**
 * Small components that subscribe to the PerformanceStore themselves, so the
 * page around them stays quiet while ~90 frames per second arrive.
 */
import { memo, type ReactNode } from "react";
import { CentsMeter, NoteName, useLive } from "@naghma/ui";
import { coaching, type PerformanceStore } from "../lib/live";
import { octaveHint } from "../lib/format";
import { FRESH_MS, useFreshFrame } from "../lib/liveHooks";
import type {
  AudioStatus,
  Fingerboard as Board,
  LiveFrame,
  Settings,
  Target,
} from "../lib/types";
import type { AudioEvidence } from "../vision/types";
import { AnimatedZand } from "./AnimatedZand";
import { CameraPanel } from "./CameraPanel";
import { Fingerboard } from "./Fingerboard";

type Tr = (en: string, ar: string) => string;

export const LivePitch = memo(function LivePitch({
  store,
  settings,
  running,
  tr,
}: {
  store: PerformanceStore;
  settings: Settings;
  running: boolean;
  tr: Tr;
}) {
  const { frame, fresh } = useFreshFrame(store, 12);
  const note = running && fresh ? frame?.note : null;
  return (
    <section className="live-pitch">
      <div className="eyebrow">
        {settings.noteView === "concert"
          ? tr("CONCERT PITCH", "الصوت الحقيقي")
          : tr("PLAYER NOTATION", "أسماء العازف")}
      </div>
      <div className={`hero-note ${note ? "present" : ""}`}>
        {note ? (
          <NoteName label={note.label} style={settings.accidentalStyle} />
        ) : (
          <span className="idle-note">—</span>
        )}
      </div>
      <p className="muted pitch-names">
        {note ? (
          <>
            {tr("Player", "العازف")}:{" "}
            <NoteName
              label={note.playerLabel}
              style={settings.accidentalStyle}
            />{" "}
            <span className="divider">/</span> {tr("Sounding", "المسموع")}:{" "}
            <NoteName
              label={note.soundingLabel}
              style={settings.accidentalStyle}
            />
          </>
        ) : running ? (
          tr("Listening for a clear note…", "بانتظار نغمة واضحة…")
        ) : (
          tr("A little space. A single note.", "مساحة هادئة. نغمة واحدة.")
        )}
      </p>
      <CentsMeter
        read={() =>
          running && performance.now() - store.receivedAt < FRESH_MS
            ? (store.frame?.note?.cents ?? null)
            : null
        }
        flatLabel={tr("Flat", "منخفض")}
        sharpLabel={tr("Sharp", "مرتفع")}
      />
      <div
        className={`cents-readout ${note && Math.abs(note.cents) < 10 ? "in-tune" : ""}`}
      >
        <bdi>
          {note ? `${note.cents > 0 ? "+" : ""}${note.cents.toFixed(1)}` : "—"}
        </bdi>
        <span>{tr("cents", "سنت")}</span>
      </div>
      <div className="pitch-facts">
        <div>
          <small>{tr("FREQUENCY", "التردد")}</small>
          <bdi>
            {note ? note.hz.toFixed(2) : "—"} <em>Hz</em>
          </bdi>
        </div>
        <div>
          <small>{tr("PERIODICITY", "الدورية")}</small>
          <bdi>
            {note ? ((frame?.confidence ?? 0) * 100).toFixed(0) : "—"}{" "}
            <em>%</em>
          </bdi>
        </div>
      </div>
      <div className="stage-bottom">
        <div>
          <span className="eyebrow">{tr("INPUT LEVEL", "مستوى الدخل")}</span>
          <div className="level-track">
            <i
              style={{
                width: `${running && fresh ? Math.max(0, Math.min(100, (((frame?.levelDb ?? -90) + 90) / 90) * 100)) : 0}%`,
              }}
            />
          </div>
        </div>
        <span className="muted">
          {running && fresh ? (
            <bdi>{frame?.levelDb.toFixed(0)} dBFS</bdi>
          ) : (
            tr("The room is quiet.", "المكان هادئ.")
          )}
        </span>
      </div>
    </section>
  );
});

export const MelodicTrail = memo(function MelodicTrail({
  store,
  tr,
}: {
  store: PerformanceStore;
  tr: Tr;
}) {
  // Re-render only when a new note joins the history.
  useLive(store, () => store.history.at(-1)?.eventId ?? -1, Object.is, 10);
  const history = store.history.slice(-12);
  return (
    <section className="trail">
      <div className="section-heading">
        <h2>{tr("Your melodic trail", "مسارك اللحني")}</h2>
        <span className="eyebrow">{tr("THIS SESSION", "هذه الجلسة")}</span>
      </div>
      <div className="note-trail">
        {history.length ? (
          history.map((n, i) => (
            <span key={n.eventId}>
              <small>{String(i + 1).padStart(2, "0")}</small>
              {n.text}
            </span>
          ))
        ) : (
          <p className="muted">
            {tr(
              "Confirmed notes will leave a trail here.",
              "ستظهر النغمات المؤكدة هنا.",
            )}
          </p>
        )}
      </div>
    </section>
  );
});

/** CameraPanel fed with audio evidence at most 10 times per second. */
export const CameraStage = memo(function CameraStage({
  store,
  arabic,
  fingerboardLengthMm,
  courses,
  overlay,
}: {
  store: PerformanceStore;
  arabic: boolean;
  fingerboardLengthMm: number;
  courses: number;
  overlay: ReactNode;
}) {
  const audio = useLive<LiveFrame, AudioEvidence | null>(
    store,
    (f) =>
      f?.note && !f.note.holding
        ? {
            receivedAt: store.receivedAt,
            playerPitch: f.note.playerPitch,
            confidence: f.confidence,
            positions: f.note.positions,
          }
        : null,
    (a, b) => a === b || (!!a && !!b && a.receivedAt === b.receivedAt),
    10,
  );
  return (
    <CameraPanel
      arabic={arabic}
      audio={audio}
      fingerboardLengthMm={fingerboardLengthMm}
      courses={courses}
      overlay={overlay}
    />
  );
});

interface FingerboardProps {
  store: PerformanceStore;
  board: Board;
  settings: Settings;
  selected: Target | null;
  onSelect: (target: Target) => void;
}

/** The animated zand, or the plain map when the user turned it off. */
export const LiveFingerboard = memo(function LiveFingerboard(
  props: FingerboardProps,
) {
  return props.settings.zand.animated ? (
    <AnimatedZand {...props} />
  ) : (
    <PlainFingerboard {...props} />
  );
});

/** Fingerboard whose acoustic highlight changes only when the note does. */
function PlainFingerboard({
  store,
  board,
  settings,
  selected,
  onSelect,
}: FingerboardProps) {
  const activePitch = useLive(
    store,
    (f) => {
      const pitch = f?.note?.playerPitch;
      if (pitch === undefined) return undefined;
      return board.targets.find((t) => Math.abs(t.playerPitch - pitch) < 0.15)
        ?.playerPitch;
    },
    Object.is,
    15,
  );
  return (
    <Fingerboard
      board={board}
      settings={settings}
      selected={selected}
      onSelect={onSelect}
      activePitch={activePitch}
    />
  );
}

export const PracticeCoach = memo(function PracticeCoach({
  store,
  settings,
  selected,
  onReference,
  tr,
}: {
  store: PerformanceStore;
  settings: Settings;
  selected: Target | null;
  onReference: (target: Target) => void;
  tr: Tr;
}) {
  const coach = useLive(
    store,
    (f) => coaching(f, selected, store.receivedAt, performance.now()),
    (a, b) =>
      a === b ||
      (!!a &&
        !!b &&
        a.state === b.state &&
        a.octaves === b.octaves &&
        a.cents.toFixed(1) === b.cents.toFixed(1)),
    15,
  );
  return (
    <section className="coach">
      <div className="eyebrow">
        {tr("INTONATION PRACTICE", "تدريب الدقة النغمية")}
      </div>
      <h2>
        {selected ? (
          <NoteName label={selected.label} style={settings.accidentalStyle} />
        ) : (
          tr("Choose your next note.", "اختر نغمتك التالية.")
        )}
      </h2>
      {selected ? (
        <>
          <p className="coach-offset">
            <bdi>
              {coach
                ? `${coach.cents > 0 ? "+" : ""}${coach.cents.toFixed(1)}`
                : "—"}
            </bdi>{" "}
            <span>{tr("cents from target", "سنت عن الهدف")}</span>
          </p>
          {coach && coach.octaves !== 0 && (
            <p className="fine-print">{octaveHint(coach.octaves, tr)}</p>
          )}
          <p className="muted">
            {coach
              ? coach.state === "inTune"
                ? tr("Settled within ±10 cents.", "داخل نطاق ±١٠ سنت.")
                : coach.state === "flat"
                  ? tr("A little higher.", "ارفع النغمة قليلاً.")
                  : tr("A little lower.", "اخفض النغمة قليلاً.")
              : tr(
                  "Play the selected note for a live comparison.",
                  "اعزف النغمة المختارة للمقارنة المباشرة.",
                )}
          </p>
          <button
            className="button subtle"
            onClick={() => onReference(selected)}
          >
            ♪ {tr("Play reference tone", "شغّل نغمة مرجعية")}
          </button>
        </>
      ) : (
        <p className="muted">
          {tr(
            "Select a target on the fingerboard to see every reachable position and hear a reference tone.",
            "اختر هدفاً على لوحة الأصابع لرؤية مواضعه وسماع نغمة مرجعية.",
          )}
        </p>
      )}
    </section>
  );
});

export const Diagnostics = memo(function Diagnostics({
  store,
  running,
  status,
  tr,
}: {
  store: PerformanceStore;
  running: boolean;
  status: AudioStatus | null;
  tr: Tr;
}) {
  const frame = useLive(store, (f) => f, Object.is, 4);
  return (
    <details className="panel diagnostics">
      <summary>{tr("Developer diagnostics", "تشخيص المطوّر")}</summary>
      <pre dir="ltr">
        {JSON.stringify({ frame: running ? frame : null, status }, null, 2)}
      </pre>
    </details>
  );
});
