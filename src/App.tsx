import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { CentsMeter, NoteName, useLive } from "@naghma/ui";
import { PerformanceStore, coaching } from "./lib/live";
import type {
  Analysis,
  AudioStatus,
  Dataset,
  Device,
  Fingerboard as Board,
  Message,
  Settings,
  Snapshot,
  Target,
  TonicOption,
} from "./lib/types";
import { Resonance } from "./components/Resonance";
import { Fingerboard } from "./components/Fingerboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { CameraPanel } from "./components/CameraPanel";
import "./App.css";

type Page = "live" | "tuner" | "teach" | "explorer" | "camera" | "settings";
const pages: { id: Page; icon: string; en: string; ar: string }[] = [
  { id: "live", icon: "◉", en: "Live Play", ar: "العزف المباشر" },
  { id: "tuner", icon: "≋", en: "Tuner", ar: "الدوزان" },
  { id: "teach", icon: "⌘", en: "Teach Me", ar: "علّمني" },
  { id: "explorer", icon: "◈", en: "Maqam Explorer", ar: "مستكشف المقامات" },
  { id: "camera", icon: "⌑", en: "Camera & position", ar: "الكاميرا والمواضع" },
  { id: "settings", icon: "⚙", en: "Settings", ar: "الإعدادات" },
];
function errorText(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : JSON.stringify(error);
}

export default function App() {
  const store = useMemo(() => new PerformanceStore(), []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [page, setPage] = useState<Page>("live");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [running, setRunning] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [tonicOptions, setTonicOptions] = useState<TonicOption[]>([]);
  const [maqamId, setMaqamId] = useState("");
  const [tonic, setTonic] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const tone = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const ar = settings?.language === "ar";
  const tr = (en: string, arabic: string) => (ar ? arabic : en);
  const frame = useLive(store, (f) => f, Object.is, 12);
  const selected = board?.targets.find((t) => t.id === selectedId) ?? null;
  const fresh = clock - store.receivedAt < 500;
  const note = running && fresh ? frame?.note : null;
  const coach = coaching(
    running ? frame : null,
    selected,
    store.receivedAt,
    clock,
  );
  const maqam = dataset?.maqamat.find((m) => m.id === maqamId);

  useEffect(() => {
    if (!isTauri()) {
      setError(
        "Open Ajnas as a desktop app to use native audio and local settings. Run npm run tauri dev.",
      );
      return;
    }
    let alive = true;
    invoke<Snapshot>("snapshot")
      .then((s) => {
        if (alive) {
          setSettings(s.settings);
          setDataset(s.dataset);
          setError(s.warning);
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
      generation.current++;
      tone.current?.close();
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setClock(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!settings) return;
    document.documentElement.lang = settings.language;
    document.documentElement.dir = ar ? "rtl" : "ltr";
    let alive = true;
    invoke<TonicOption[]>("tonic_options")
      .then((options) => {
        if (alive) setTonicOptions(options);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    invoke<Board>("fingerboard", {
      maqamId: maqamId || null,
      tonic: tonic.trim() || null,
    })
      .then((b) => {
        if (alive) setBoard(b);
      })
      .catch((e) => {
        if (alive) {
          setBoard(null);
          setError(errorText(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [settings, dataset, maqamId, tonic, ar]);
  useEffect(() => {
    if (!running || !settings?.showDiagnostics) return;
    const id = setInterval(
      () =>
        invoke<AudioStatus | null>("audio_status")
          .then(setStatus)
          .catch(() => {}),
      1000,
    );
    return () => clearInterval(id);
  }, [running, settings?.showDiagnostics]);

  async function start() {
    setBusy(true);
    setError(null);
    setAnalysis(null);
    store.reset();
    const token = ++generation.current;
    const channel = new Channel<Message>();
    channel.onmessage = (message) => {
      if (generation.current !== token) return;
      if (message.type === "frame") store.push(message);
      else if (message.type === "analysis")
        setAnalysis({ ...message.analysis, tonicLabels: message.tonicLabels });
      else {
        setError(message.message);
        setBusy(true);
        void invoke("stop_audio")
          .then(() => {
            if (generation.current === token) {
              setRunning(false);
              store.reset();
              setStatus(null);
            }
          })
          .catch((e) => setError(message.message + " · " + errorText(e)))
          .finally(() => setBusy(false));
      }
    };
    try {
      await invoke("start_audio", { simulation, onMessage: channel });
      setRunning(true);
    } catch (e) {
      setError(errorText(e));
      setRunning(false);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    ++generation.current;
    try {
      await invoke("stop_audio");
      setRunning(false);
      store.reset();
      setAnalysis(null);
      setStatus(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(next: Settings) {
    setBusy(true);
    setError(null);
    try {
      const saved = await invoke<Settings>("update_settings", {
        settings: next,
      });
      setSettings(saved);
      store.reset();
      setAnalysis(null);
    } catch (e) {
      setError(errorText(e));
      const [s, a] = await Promise.all([
        invoke<Snapshot>("snapshot").catch(() => null),
        invoke<AudioStatus | null>("audio_status").catch(() => undefined),
      ]);
      if (s) setSettings(s.settings);
      setAnalysis(null);
      if (a !== undefined) {
        setRunning(a !== null);
        if (!a) store.reset();
      }
    } finally {
      setBusy(false);
    }
  }
  const refreshDevices = useCallback(() => {
    invoke<Device[]>("list_input_devices")
      .then(setDevices)
      .catch((e) => setError(errorText(e)));
  }, []);
  async function loadDataset() {
    setBusy(true);
    setError(null);
    try {
      const ds = await invoke<Dataset | null>("import_dataset");
      if (ds) {
        setDataset(ds);
        setMaqamId("");
        setSelectedId(null);
        setAnalysis(null);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function clearDataset() {
    setBusy(true);
    try {
      await invoke("clear_dataset");
      setDataset(null);
      setMaqamId("");
      setSelectedId(null);
      setAnalysis(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function reference(target: Target) {
    try {
      tone.current ??= new AudioContext();
      await tone.current.resume();
      const osc = tone.current.createOscillator(),
        gain = tone.current.createGain(),
        now = tone.current.currentTime;
      osc.type = "sine";
      osc.frequency.value = target.soundingHz;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain).connect(tone.current.destination);
      osc.start();
      osc.stop(now + 0.85);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (e) {
      setError(errorText(e));
    }
  }
  const identity =
    settings?.noteView === "concert"
      ? tr("CONCERT PITCH", "الصوت الحقيقي")
      : tr("PLAYER NOTATION", "أسماء العازف");
  const noteDisplay = (
    <>
      <div className="eyebrow">{identity}</div>
      <div className={`hero-note ${note ? "present" : ""}`}>
        {note && settings ? (
          <NoteName label={note.label} style={settings.accidentalStyle} />
        ) : (
          <span className="idle-note">—</span>
        )}
      </div>
      <p className="muted">
        {note ? (
          <>
            {tr("Player", "العازف")}: {note.playerLabel.text}{" "}
            <span className="divider">/</span> {tr("Sounding", "المسموع")}:{" "}
            {note.soundingLabel.text}
          </>
        ) : running ? (
          tr("Listening for a clear note…", "بانتظار نغمة واضحة…")
        ) : (
          tr("A little space. A single note.", "مساحة هادئة. نغمة واحدة.")
        )}
      </p>
    </>
  );
  const analysisDisplay = (
    <div className="panel analysis-panel">
      <div className="section-heading">
        <h2>{tr("Maqam hypotheses", "احتمالات المقام")}</h2>
        <span className="tag">
          {settings?.maqam.enabled
            ? tr("ENABLED", "مفعّل")
            : tr("OFF", "متوقف")}
        </span>
      </div>
      {!settings?.maqam.enabled ? (
        <div className="empty compact">
          <span className="empty-symbol">◈</span>
          <h3>
            {tr("Listen first. Explore when ready.", "اعزف أولاً، ثم استكشف.")}
          </h3>
          <p>
            {tr(
              "Recognition is optional and uses only the dataset you load.",
              "التحليل اختياري ويستخدم البيانات التي تحمّلها فقط.",
            )}
          </p>
          <button className="button subtle" onClick={() => setPage("explorer")}>
            {tr("Open explorer", "افتح المستكشف")} ↗
          </button>
        </div>
      ) : !dataset ? (
        <p className="muted">
          {tr(
            "Load a sourced dataset in Maqam Explorer to rank candidates.",
            "حمّل بيانات موثّقة في مستكشف المقامات لعرض الاحتمالات.",
          )}
        </p>
      ) : (
        <>
          <DatasetSource dataset={dataset} arabic={!!ar} />
          <p className="fine-print">
            {settings.maqam.pitchSpace === "player"
              ? tr("Analysis in player notation", "التحليل بأسماء العازف")
              : tr("Analysis in sounding pitch", "التحليل بالصوت الحقيقي")}
          </p>
          <p className="status-text">
            {analysis
              ? tr(
                  (
                    {
                      insufficientData: "More melodic material needed",
                      unknown: "No clear match",
                      ambiguous: "Several candidates fit",
                      likely: "Leading candidate",
                    } as const
                  )[analysis.status],
                  (
                    {
                      insufficientData: "نحتاج مادة لحنية أكثر",
                      unknown: "لا تطابق واضح",
                      ambiguous: "عدة احتمالات متقاربة",
                      likely: "الاحتمال الأقوى",
                    } as const
                  )[analysis.status],
                )
              : tr("Waiting for analysis…", "بانتظار التحليل…")}
          </p>
          {analysis?.candidates.map((c, candidateIndex) => (
            <div className="candidate" key={c.maqam + JSON.stringify(c.tonic)}>
              <div>
                <strong>
                  {dataset.maqamat.find((m) => m.id === c.maqam)?.name[
                    ar ? "arabic" : "latin"
                  ] ?? c.maqam}
                </strong>
                <span>
                  {tr("Tonic", "القرار")}:{" "}
                  {analysis.tonicLabels?.[candidateIndex]?.text ?? "—"}
                </span>
                <bdi>
                  {tr("Score", "النتيجة")} {c.score.toFixed(2)}
                </bdi>
              </div>
              <div className="evidence">
                {c.supporting.map((e, i) => (
                  <span key={i}>
                    {e.kind === "scaleFit"
                      ? `${tr("Scale fit", "توافق السلم")} ${((e.share ?? 0) * 100).toFixed(0)}%`
                      : e.kind === "coverage"
                        ? `${tr("Degrees heard", "درجات مسموعة")} ${e.heard}/${e.total}`
                        : e.kind === "jins"
                          ? `${e.jins}: ${((e.completeness ?? 0) * 100).toFixed(0)}%`
                          : e.kind}
                  </span>
                ))}
              </div>
              {c.contradicting.length > 0 && (
                <p className="warning-text">
                  {tr(
                    "Contradiction: foreign notes",
                    "تعارض: نغمات خارج السلم",
                  )}{" "}
                  {((c.contradicting[0].share ?? 0) * 100).toFixed(0)}%
                </p>
              )}
            </div>
          ))}
          {analysis?.possibleModulation && (
            <p className="warning-text">
              {tr(
                "Possible modulation within the analysis window.",
                "احتمال انتقال مقامي داخل نافذة التحليل.",
              )}
            </p>
          )}
          <p className="fine-print">
            {analysis?.notes ?? 0}{" "}
            {tr(
              "completed notes · heuristic scores, not probabilities",
              "نغمات مكتملة · نتائج تقريبية وليست احتمالات إحصائية",
            )}
          </p>
        </>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("live");
          }}
        >
          <span className="brand-mark">أ</span>
          <span>
            Ajnas<small>أجناس</small>
          </span>
        </a>
        <div className="nav-caption">
          {tr("YOUR PRACTICE SPACE", "مساحتك الموسيقية")}
        </div>
        <nav>
          {pages.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${p.id === page ? "active" : ""}`}
              aria-current={p.id === page ? "page" : undefined}
              onClick={() => {
                setPage(p.id);
                if (p.id === "settings") refreshDevices();
              }}
            >
              <span className="nav-icon">{p.icon}</span>
              {ar ? p.ar : p.en}
              {p.id === page && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="privacy-dot" />
          {tr("Made for the way you play.", "صُمّم لطريقتك في العزف.")}
          <p>
            {tr("Local analysis · No recordings", "تحليل محلي · دون تسجيل")}
          </p>
          <span className="version">AJNAS / 0.1</span>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {tr("YOUR OUD COMPANION", "رفيقك مع العود")} <span>/</span>{" "}
            {pages.find((p) => p.id === page)?.[ar ? "ar" : "en"]}
          </div>
          <div className="local-status">
            <span className="privacy-dot" />
            {tr("On this device", "على هذا الجهاز")}
          </div>
        </header>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {tr("A PRACTICE OF LISTENING", "فنّ الإصغاء")}
            </div>
            <h1>
              {page === "live"
                ? tr("Find your resonance.", "اكتشف رنينك.")
                : pages.find((p) => p.id === page)?.[ar ? "ar" : "en"]}
            </h1>
            <p>
              {page === "live"
                ? tr(
                    "Your sound, made visible. One note at a time.",
                    "صوتك كما تراه. نغمةً تلو الأخرى.",
                  )
                : page === "teach"
                  ? tr(
                      "See the possibilities. Let your ear lead the way.",
                      "شاهد المواضع الممكنة، ودع أذنك تقودك.",
                    )
                  : page === "camera"
                    ? tr(
                        "A second perspective on where you play.",
                        "منظور آخر لمواضع عزفك.",
                      )
                    : page === "explorer"
                      ? tr(
                          "Explore definitions, provenance, and melodic evidence.",
                          "استكشف التعريفات ومصادرها والأدلة اللحنية.",
                        )
                      : page === "settings"
                        ? tr(
                            "Tune this space to your instrument.",
                            "اضبط هذه المساحة لتناسب آلتك.",
                          )
                        : tr(
                            "Listen closely. Make small adjustments.",
                            "أصغِ بعناية، واضبط برفق.",
                          )}
            </p>
          </div>
          <div className="session-controls">
            <select
              aria-label={tr("Audio source", "مصدر الصوت")}
              disabled={running || busy || !settings}
              value={simulation ? "simulation" : "microphone"}
              onChange={(e) => setSimulation(e.target.value === "simulation")}
            >
              <option value="microphone">
                {tr("Microphone", "الميكروفون")}
              </option>
              <option value="simulation">
                {tr("Synthetic simulation", "محاكاة اصطناعية")}
              </option>
            </select>
            <button
              className={`button ${running ? "stop" : "primary"}`}
              disabled={busy || !settings}
              onClick={running ? stop : start}
            >
              {busy
                ? tr("Please wait…", "لحظة…")
                : running
                  ? "■ " + tr("End session", "إنهاء الجلسة")
                  : "● " + tr("Start listening", "ابدأ الاستماع")}
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button
              aria-label={tr("Dismiss", "إغلاق")}
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}
        {running && simulation && (
          <div className="simulation-banner">
            {tr(
              "SYNTHETIC SIMULATION — generated test tones, not microphone input",
              "محاكاة اصطناعية — نغمات اختبار وليست صوت الميكروفون",
            )}
          </div>
        )}
        {(page === "live" || page === "tuner") && (
          <>
            <div
              className={`performance-grid ${page === "tuner" ? "tuner-grid" : ""}`}
            >
              {page === "live" && (
                <section className="panel stage">
                  <div className="section-heading">
                    <span className="eyebrow">
                      {tr("THE LISTENING ROOM", "غرفة الإصغاء")}
                    </span>
                    <span className={`session-state ${running ? "on" : ""}`}>
                      <i />
                      {running
                        ? tr("LIVE", "مباشر")
                        : tr("READY WHEN YOU ARE", "جاهز عندما تكون")}
                    </span>
                  </div>
                  {settings?.visuals !== "off" && (
                    <Resonance
                      store={store}
                      quality={settings?.visuals ?? "reduced"}
                    />
                  )}
                  <div className="stage-bottom">
                    <div>
                      <span className="eyebrow">
                        {tr("INPUT LEVEL", "مستوى الدخل")}
                      </span>
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
              )}
              <section className="panel pitch-panel">
                {noteDisplay}
                <CentsMeter
                  read={() =>
                    running && performance.now() - store.receivedAt < 500
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
                    {note
                      ? `${note.cents > 0 ? "+" : ""}${note.cents.toFixed(1)}`
                      : "—"}
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
              </section>
            </div>
            <div className="below-grid">
              <section className="panel">
                <div className="section-heading">
                  <h2>{tr("Your melodic trail", "مسارك اللحني")}</h2>
                  <span className="eyebrow">
                    {tr("THIS SESSION", "هذه الجلسة")}
                  </span>
                </div>
                <div className="note-trail">
                  {store.history.length ? (
                    store.history.slice(-12).map((n, i) => (
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
              {analysisDisplay}
            </div>
          </>
        )}
        {page === "teach" && (
          <>
            <div className="panel teaching-controls">
              <label className="field">
                {tr("Practice material", "مادة التدريب")}
                <select
                  value={maqamId}
                  onChange={(e) => {
                    setMaqamId(e.target.value);
                    setSelectedId(null);
                  }}
                >
                  <option value="">
                    {tr(
                      "All notes · current tuning grid",
                      "جميع النغمات · نظام الدوزان الحالي",
                    )}
                  </option>
                  {dataset?.maqamat.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name[ar ? "arabic" : "latin"]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {tr("Tonic override · e.g. Re3", "قرار مخصص · مثل Re3")}
                <input
                  dir="ltr"
                  placeholder={tr("Dataset default", "القرار الافتراضي")}
                  value={tonic}
                  onChange={(e) => {
                    setTonic(e.target.value);
                    setSelectedId(null);
                  }}
                  disabled={!maqamId}
                />
              </label>
              <span className="muted">
                {tr(
                  "Choose a note on the fingerboard. All positions use player notation.",
                  "اختر نغمة على لوحة الأصابع. جميع المواضع بأسماء العازف.",
                )}
              </span>
            </div>
            {board && settings && (
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    {maqam?.name[ar ? "arabic" : "latin"] ??
                      tr("The fretless fingerboard", "لوحة العود بلا دساتين")}
                  </h2>
                  <span className="tag">
                    {tr("PLAYER NOTATION", "أسماء العازف")}
                  </span>
                </div>
                <Fingerboard
                  board={board}
                  settings={settings}
                  selected={selected}
                  onSelect={(t) => setSelectedId(t.id)}
                  activePitch={note?.playerPitch}
                />
              </section>
            )}
            <div className="below-grid">
              <section className="panel coach">
                <div className="eyebrow">
                  {tr("INTONATION PRACTICE", "تدريب الدقة النغمية")}
                </div>
                <h2>
                  {selected && settings ? (
                    <NoteName
                      label={selected.label}
                      style={settings.accidentalStyle}
                    />
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
                    <p className="muted">
                      {coach
                        ? coach.state === "inTune"
                          ? tr(
                              "Settled within ±10 cents.",
                              "داخل نطاق ±١٠ سنت.",
                            )
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
                      onClick={() => reference(selected)}
                    >
                      ♪ {tr("Play reference tone", "شغّل نغمة مرجعية")}
                    </button>
                  </>
                ) : (
                  <p className="muted">
                    {tr(
                      "Select a target to see every reachable position and hear a reference tone.",
                      "اختر هدفاً لرؤية مواضعه وسماع نغمة مرجعية.",
                    )}
                  </p>
                )}
              </section>
              <section className="panel">
                <h2>
                  {tr("A map, guided by your ear.", "خريطة تقودها أذنك.")}
                </h2>
                <p className="muted">
                  {tr(
                    "The oud has no frets. These positions follow an ideal-string model; action, pressure, and the instrument change real intonation. Loaded maqam targets keep their original cents, including intervals between equal-tempered steps.",
                    "العود بلا دساتين. تعتمد المواضع على نموذج وتر مثالي؛ ويؤثر ضغط الإصبع وارتفاع الأوتار والآلة على النغم الحقيقي. تحتفظ أهداف المقام المحمّلة بمقاديرها الأصلية بالسنت.",
                  )}
                </p>
                {dataset && <DatasetSource dataset={dataset} arabic={!!ar} />}
              </section>
            </div>
          </>
        )}
        {page === "explorer" && (
          <>
            <section className="panel">
              <div className="section-heading">
                <h2>{tr("Your musical library", "مكتبتك الموسيقية")}</h2>
                <div className="inline">
                  <button
                    disabled={busy || !settings}
                    className="button subtle"
                    onClick={loadDataset}
                  >
                    {tr("Import dataset", "استيراد البيانات")} ↗
                  </button>
                  {dataset && (
                    <button
                      className="button subtle"
                      disabled={busy}
                      onClick={clearDataset}
                    >
                      {tr("Remove", "إزالة")}
                    </button>
                  )}
                </div>
              </div>
              {dataset ? (
                <DatasetSource dataset={dataset} arabic={!!ar} />
              ) : (
                <div className="empty">
                  <span className="empty-symbol">◈</span>
                  <h3>
                    {tr(
                      "Bring your musical knowledge.",
                      "أحضر معرفتك الموسيقية.",
                    )}
                  </h3>
                  <p>
                    {tr(
                      "Import a JSON dataset with sourced maqam and jins definitions. No invented definitions are bundled.",
                      "استورد ملف JSON بتعريفات المقامات والأجناس ومصادرها. لا تتضمن الحزمة تعريفات مختلقة.",
                    )}
                  </p>
                </div>
              )}
            </section>
            {settings && (
              <section className="panel">
                <div className="section-heading">
                  <h2>{tr("Listen for a maqam", "استمع لاكتشاف المقام")}</h2>
                  <label className="check">
                    <input
                      type="checkbox"
                      disabled={busy || (!dataset && !settings.maqam.enabled)}
                      checked={settings.maqam.enabled}
                      onChange={(e) =>
                        save({
                          ...settings,
                          maqam: {
                            ...settings.maqam,
                            enabled: e.target.checked,
                          },
                        })
                      }
                    />
                    {tr("Enable analysis", "تفعيل التحليل")}
                  </label>
                </div>
                <div className="fields">
                  <label className="field">
                    {tr("Pitch identity for analysis", "هوية النغمة للتحليل")}
                    <select
                      disabled={busy}
                      value={settings.maqam.pitchSpace}
                      onChange={(e) =>
                        save({
                          ...settings,
                          maqam: {
                            ...settings.maqam,
                            pitchSpace: e.target.value as "player" | "sounding",
                          },
                        })
                      }
                    >
                      <option value="player">
                        {tr("Player notation", "أسماء العازف")}
                      </option>
                      <option value="sounding">
                        {tr("Sounding pitch", "الصوت الحقيقي")}
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    {tr("Tonic", "القرار")}
                    <select
                      disabled={busy}
                      value={
                        settings.maqam.tonic
                          ? JSON.stringify(settings.maqam.tonic)
                          : ""
                      }
                      onChange={(e) =>
                        save({
                          ...settings,
                          maqam: {
                            ...settings.maqam,
                            tonic: e.target.value
                              ? JSON.parse(e.target.value)
                              : null,
                          },
                        })
                      }
                    >
                      <option value="">
                        {tr("Consider likely tonics", "جرّب القرارات المحتملة")}
                      </option>
                      {tonicOptions.map((t) => (
                        <option
                          key={JSON.stringify(t.spelling)}
                          value={JSON.stringify(t.spelling)}
                        >
                          {t.label.text}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="muted">
                  {tr(
                    "A rolling 25-second window, updated every 5 seconds. Evidence includes scale fit, resting tones, ajnas, and characteristic phrases from your dataset. Scores are heuristic, not statistical probabilities.",
                    "نافذة متحركة مدتها ٢٥ ثانية، تُحدّث كل ٥ ثوانٍ. تشمل الأدلة توافق السلم ونغمات الركوز والأجناس والعبارات من بياناتك. النتائج تقريبية وليست احتمالات إحصائية.",
                  )}
                </p>
              </section>
            )}
            <div className="explorer-grid">
              {dataset?.maqamat.map((m) => (
                <section className="panel maqam-card" key={m.id}>
                  <div className="eyebrow">
                    {m.family ?? tr("MAQAM", "مقام")}
                  </div>
                  <h2>{m.name[ar ? "arabic" : "latin"]}</h2>
                  <p className="muted">
                    {m.description ??
                      tr(
                        "Defined in your loaded dataset.",
                        "معرّف في ملف البيانات المحمّل.",
                      )}
                  </p>
                  <div className="intervals" dir="ltr">
                    {m.ascending.map((d, i) => (
                      <span key={i}>
                        {d.cents}
                        <small>¢</small>
                      </span>
                    ))}
                  </div>
                  <p className="muted">
                    {m.ajnas
                      .map(
                        (j) =>
                          dataset.ajnas.find((a) => a.id === j.jins)?.name[
                            ar ? "arabic" : "latin"
                          ] ?? j.jins,
                      )
                      .join(" · ")}
                  </p>
                  <button
                    className="button subtle"
                    onClick={() => {
                      setMaqamId(m.id);
                      setSelectedId(null);
                      setPage("teach");
                    }}
                  >
                    {tr(
                      "Explore on the fingerboard",
                      "استكشف على لوحة الأصابع",
                    )}{" "}
                    →
                  </button>
                </section>
              ))}
            </div>
            {analysisDisplay}
          </>
        )}
        {page === "camera" && board && (
          <CameraPanel
            arabic={!!ar}
            fingerboardLengthMm={board.fingerboardLengthMm}
            courses={board.courses.length}
            audio={
              note && !note.holding
                ? {
                    receivedAt: store.receivedAt,
                    playerPitch: note.playerPitch,
                    confidence: frame?.confidence ?? 0,
                    positions: note.positions,
                  }
                : null
            }
          />
        )}
        {page === "settings" && settings && (
          <SettingsPanel
            settings={settings}
            devices={devices}
            busy={busy}
            onSave={save}
            onRefresh={refreshDevices}
          />
        )}
        {settings?.showDiagnostics && (
          <details className="panel diagnostics">
            <summary>{tr("Developer diagnostics", "تشخيص المطوّر")}</summary>
            <pre dir="ltr">
              {JSON.stringify(
                { frame: running ? frame : null, status },
                null,
                2,
              )}
            </pre>
          </details>
        )}
        <footer>
          <span>
            {tr(
              "Ajnas · An attentive companion for your oud.",
              "أجناس · رفيق يصغي لعودك.",
            )}
          </span>
          <span>
            <bdi>{settings?.tuning === "edo12" ? "12" : "24"}-EDO</bdi> <i>·</i>{" "}
            La4 <bdi>{settings?.referenceHz ?? 440} Hz</bdi> <i>·</i>{" "}
            {tr("Transpose", "نقل")}{" "}
            <bdi>
              {settings?.transposition.amount ?? 0}{" "}
              {settings?.transposition.unit ?? "semitone"}
            </bdi>
          </span>
        </footer>
      </main>
    </div>
  );
}
function DatasetSource({
  dataset,
  arabic,
}: {
  dataset: Dataset;
  arabic: boolean;
}) {
  return (
    <div
      className={`dataset-source ${dataset.provenance.status === "validated" ? "" : "provisional"}`}
    >
      <strong>
        {dataset.provenance.status === "validated"
          ? arabic
            ? "موثّق وفقاً لمصدر الملف"
            : "Marked validated by dataset author"
          : dataset.provenance.status === "syntheticTestData"
            ? arabic
              ? "بيانات اختبار اصطناعية — ليست نظرية موسيقية"
              : "SYNTHETIC TEST DATA — not musical theory"
            : arabic
              ? "بيانات غير موثّقة"
              : "Provisional / unvalidated data"}
      </strong>
      <p>{dataset.provenance.source}</p>
      <small>
        {dataset.maqamat.length} {arabic ? "مقامات" : "maqamat"} ·{" "}
        {dataset.ajnas.length} {arabic ? "أجناس" : "ajnas"} ·{" "}
        {dataset.provenance.version}
      </small>
    </div>
  );
}
