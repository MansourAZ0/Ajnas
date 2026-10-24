import { memo, useRef } from "react";
import { NoteName, tuningZone, useLive } from "@naghma/ui";
import { coaching, type PerformanceStore } from "../lib/live";
import { useFreshFrame, useNow } from "../lib/liveHooks";
import { recentMaqamat, type MaqamSighting } from "../lib/maqamLog";
import { agoText, signed, transpositionText } from "../lib/format";
import type { Dataset, LiveNote, Settings, Target } from "../lib/types";

export interface CameraHudProps {
  store: PerformanceStore;
  settings: Settings;
  dataset: Dataset | null;
  running: boolean;
  simulation: boolean;
  maqamLog: readonly MaqamSighting[];
  target: Target | null;
}

/**
 * Heads-up display drawn over the live camera image. Each corner subscribes
 * to the performance store itself, so neither App nor CameraPanel re-renders
 * at frame rate. Cards sit along the top edge; the centre and lower part of
 * the frame, where the oud and fretting hand usually are, stay clear.
 */
export const CameraHud = memo(function CameraHud(props: CameraHudProps) {
  const ar = props.settings.language === "ar";
  return (
    <div className="cam-hud" lang={props.settings.language}>
      <div className="hud-corner hud-top-start hud-stack">
        <NoteCard {...props} arabic={ar} />
        {props.target && (
          <TargetCard
            store={props.store}
            settings={props.settings}
            target={props.target}
            arabic={ar}
          />
        )}
      </div>
      <div className="hud-corner hud-top-end hud-stack">
        <TransposeCard {...props} arabic={ar} />
        <MaqamCard {...props} arabic={ar} />
      </div>
    </div>
  );
});

type WithArabic<T> = T & { arabic: boolean };

function NoteCard({
  store,
  settings,
  running,
  arabic,
}: WithArabic<CameraHudProps>) {
  const tr = (en: string, ar: string) => (arabic ? ar : en);
  const { frame, fresh } = useFreshFrame(store, 15);
  const current = running && fresh ? (frame?.note ?? null) : null;
  // Keep the last note on screen, dimmed, between notes.
  const last = useRef<LiveNote | null>(null);
  if (current) last.current = current;
  if (!running) last.current = null;
  const note = current ?? last.current;
  const concert = settings.noteView === "concert";
  const level =
    running && fresh
      ? Math.max(0, Math.min(1, ((frame?.levelDb ?? -90) + 90) / 90))
      : 0;
  return (
    <div
      className={`hud-card hud-note ${current ? "live" : "idle"}`}
      aria-live="off"
    >
      <div className="hud-eyebrow">
        {concert
          ? tr("CONCERT PITCH", "الصوت الحقيقي")
          : tr("PLAYER NOTATION", "أسماء العازف")}
      </div>
      <div className="hud-note-row">
        <span className="hud-note-name">
          {note ? (
            <NoteName label={note.label} style={settings.accidentalStyle} />
          ) : (
            "—"
          )}
        </span>
        {current && (
          <bdi className={`hud-cents ${tuningZone(current.cents)}`}>
            <span dir="ltr">{signed(current.cents, 1)}</span>
            <small>{tr("cents", "سنت")}</small>
          </bdi>
        )}
      </div>
      <div className="hud-sub">
        {note ? (
          concert ? (
            <>
              {tr("Player", "العازف")}{" "}
              <NoteName
                label={note.playerLabel}
                style={settings.accidentalStyle}
              />
            </>
          ) : (
            <>
              {tr("Sounding", "المسموع")}{" "}
              <NoteName
                label={note.soundingLabel}
                style={settings.accidentalStyle}
              />
            </>
          )
        ) : running ? (
          tr("Listening for a clear note…", "بانتظار نغمة واضحة…")
        ) : (
          tr("Not listening", "الاستماع متوقف")
        )}
      </div>
      <div className="hud-level" aria-hidden="true">
        <i style={{ transform: `scaleX(${level})` }} />
      </div>
    </div>
  );
}

function TransposeCard({
  settings,
  running,
  simulation,
  arabic,
}: WithArabic<CameraHudProps>) {
  const tr = (en: string, ar: string) => (arabic ? ar : en);
  const amount = transpositionText(settings.transposition, arabic);
  return (
    <>
      {running && simulation && (
        <div className="hud-chip warn">{tr("SIMULATION", "محاكاة")}</div>
      )}
      <div className="hud-card hud-transpose">
        <div className="hud-eyebrow">{tr("TRANSPOSE", "النقل")}</div>
        <strong>
          {amount ? (
            <bdi>{amount}</bdi>
          ) : (
            tr("None · concert = player", "دون نقل")
          )}
        </strong>
        <span className="hud-sub">
          {tr("La4", "لا٤")} <bdi>{settings.referenceHz} Hz</bdi> ·{" "}
          <bdi>{settings.tuning === "edo12" ? "12" : "24"}-EDO</bdi>
        </span>
      </div>
    </>
  );
}

function MaqamCard({
  settings,
  dataset,
  running,
  maqamLog,
  arabic,
}: WithArabic<CameraHudProps>) {
  const tr = (en: string, ar: string) => (arabic ? ar : en);
  const active = settings.maqam.enabled && !!dataset;
  const now = useNow(1000, active && (running || maqamLog.length > 0));
  const recent = active ? recentMaqamat(maqamLog, now).slice(0, 4) : [];
  const provenance = dataset?.provenance.status;
  return (
    <div className="hud-card hud-maqam">
      <div className="hud-eyebrow">
        {tr("MAQAMAT · LAST 30 S", "المقامات · آخر ٣٠ ث")}
      </div>
      {!settings.maqam.enabled ? (
        <p className="hud-hint">
          {tr(
            "Maqam listening is off. Turn it on in Library.",
            "تحليل المقام متوقف. فعّله من المكتبة.",
          )}
        </p>
      ) : !dataset ? (
        <p className="hud-hint">
          {tr(
            "Load maqamat in Library to detect them.",
            "حمّل المقامات من المكتبة لاكتشافها.",
          )}
        </p>
      ) : recent.length === 0 ? (
        <p className="hud-hint">
          {running
            ? tr(
                `Listening… estimates every ${settings.maqam.intervalS} s.`,
                `نستمع… تقدير كل ${settings.maqam.intervalS} ث.`,
              )
            : tr(
                "Start listening to detect maqamat.",
                "ابدأ الاستماع لاكتشاف المقامات.",
              )}
        </p>
      ) : (
        <ol className="hud-maqam-list">
          {recent.map((r, i) => {
            const maqam = dataset.maqamat.find((m) => m.id === r.maqam);
            return (
              <li
                key={r.maqam}
                className={i === 0 ? "newest" : ""}
                style={{ opacity: 1 - (0.55 * r.ageMs) / 30_000 }}
              >
                <span className="hud-maqam-name">
                  {maqam?.name[arabic ? "arabic" : "latin"] ?? r.maqam}
                  {r.tonic && (
                    <span className="hud-tonic">
                      {tr("on", "على")}{" "}
                      <NoteName
                        label={r.tonic}
                        style={settings.accidentalStyle}
                      />
                    </span>
                  )}
                </span>
                <span className={`hud-role ${r.role}`}>
                  {r.role === "leading"
                    ? tr("leading", "الأقوى")
                    : tr("ambiguous", "متقارب")}
                </span>
                <bdi className="hud-age">{agoText(r.ageMs, arabic)}</bdi>
              </li>
            );
          })}
        </ol>
      )}
      {active && (
        <p className="hud-honesty">
          {tr("Heuristic, not probabilities", "تقديرات وليست احتمالات")}
          {provenance === "syntheticTestData"
            ? tr(" · synthetic test data", " · بيانات اختبار اصطناعية")
            : provenance !== "validated"
              ? tr(" · provisional data", " · بيانات غير موثّقة")
              : ""}
        </p>
      )}
    </div>
  );
}

function TargetCard({
  store,
  settings,
  target,
  arabic,
}: {
  store: PerformanceStore;
  settings: Settings;
  target: Target;
  arabic: boolean;
}) {
  const tr = (en: string, ar: string) => (arabic ? ar : en);
  const coach = useLive(
    store,
    (f) => {
      const c = coaching(f, target, store.receivedAt, performance.now());
      return c ? `${c.state}|${c.cents.toFixed(1)}` : null;
    },
    Object.is,
    15,
  );
  const [state, cents] = coach ? coach.split("|") : [null, null];
  return (
    <div className={`hud-card hud-target ${state ?? "idle"}`}>
      <div className="hud-eyebrow">{tr("TARGET", "الهدف")}</div>
      <div className="hud-note-row">
        <span className="hud-target-name">
          <NoteName label={target.label} style={settings.accidentalStyle} />
        </span>
        <bdi className="hud-cents">
          <span dir="ltr">
            {cents !== null ? signed(Number(cents), 1) : "—"}
          </span>
          <small>{tr("cents", "سنت")}</small>
        </bdi>
      </div>
      <div className="hud-sub">
        {state === "inTune"
          ? tr("Settled within ±10 cents.", "داخل نطاق ±١٠ سنت.")
          : state === "flat"
            ? tr("A little higher.", "ارفع النغمة قليلاً.")
            : state === "sharp"
              ? tr("A little lower.", "اخفض النغمة قليلاً.")
              : tr("Play the selected note.", "اعزف النغمة المختارة.")}
      </div>
    </div>
  );
}
