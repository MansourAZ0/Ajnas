import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { PerformanceStore } from "./lib/live";
import { zandMarks } from "./lib/zand";
import { recordAnalysis, type MaqamSighting } from "./lib/maqamLog";
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
  ScaleInfo,
} from "./lib/types";
import { Resonance } from "./components/Resonance";
import { MaqamControls, MaqamScale } from "./components/MaqamScale";
import { SettingsPanel } from "./components/SettingsPanel";
import { CameraHud } from "./components/CameraHud";
import {
  CameraStage,
  Diagnostics,
  LiveFingerboard,
  LivePitch,
  MelodicTrail,
  PracticeCoach,
} from "./components/LivePanels";
import {
  DatasetSource,
  MaqamHypotheses,
  MaqamLibrary,
} from "./components/MaqamPanels";
import "./App.css";

type Tab = "tuner" | "maqam" | "teach" | "library";
const tabs: { id: Tab; icon: string; en: string; ar: string }[] = [
  { id: "tuner", icon: "≋", en: "Tuner", ar: "الدوزان" },
  { id: "maqam", icon: "◈", en: "Maqam", ar: "المقام" },
  { id: "teach", icon: "⌘", en: "Teach Me", ar: "علّمني" },
  { id: "library", icon: "▤", en: "Library", ar: "المكتبة" },
];
function errorText(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : JSON.stringify(error);
}

/**
 * One camera-centred practice page. App holds session and teaching state
 * only; everything that moves at frame rate subscribes to the store itself
 * (see LivePanels and CameraHud), so App renders on user actions and on the
 * occasional maqam analysis, not on audio frames.
 */
export default function App() {
  const store = useMemo(() => new PerformanceStore(), []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [maqamLog, setMaqamLog] = useState<MaqamSighting[]>([]);
  const [running, setRunning] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [tonicOptions, setTonicOptions] = useState<TonicOption[]>([]);
  const [maqamId, setMaqamId] = useState("");
  const [tonic, setTonic] = useState("");
  const [tonicOctave, setTonicOctave] = useState(3);
  const [variantId, setVariantId] = useState("");
  const [catalogue, setCatalogue] = useState<ScaleInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tuner");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const boardSection = useRef<HTMLElement>(null);
  const tone = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const ar = settings?.language === "ar";
  const tr = useCallback(
    (en: string, arabic: string) => (ar ? arabic : en),
    [ar],
  );
  const selected = useMemo(
    () => board?.targets.find((t) => t.id === selectedId) ?? null,
    [board, selectedId],
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
    invoke<ScaleInfo[]>("maqam_catalogue")
      .then((c) => {
        if (alive) setCatalogue(c);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    invoke<Board>("fingerboard", {
      maqamId: maqamId || null,
      tonic: tonic ? JSON.parse(tonic) : null,
      tonicOctave,
      variantId: variantId || null,
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
  }, [settings, dataset, maqamId, tonic, tonicOctave, variantId, ar]);
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

  /** Forget hypotheses and the 30-second maqam log (new context or stop). */
  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setMaqamLog([]);
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    clearAnalysis();
    store.reset();
    const token = ++generation.current;
    const channel = new Channel<Message>();
    channel.onmessage = (message) => {
      if (generation.current !== token) return;
      if (message.type === "frame") store.push(message);
      else if (message.type === "analysis") {
        const at = performance.now();
        setAnalysis({
          ...message.analysis,
          tonicLabels: message.tonicLabels,
          activeJinsLabels: message.activeJinsLabels,
          performanceTonicLabels: message.performanceTonicLabels,
          foreignJinsLabels: message.foreignJinsLabels,
        });
        setMaqamLog((log) =>
          recordAnalysis(log, message.analysis, message.tonicLabels, at),
        );
      } else {
        setError(message.message);
        setBusy(true);
        void invoke("stop_audio")
          .then(() => {
            if (generation.current === token) {
              setRunning(false);
              store.reset();
              setStatus(null);
              clearAnalysis();
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
      clearAnalysis();
      setStatus(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const save = useCallback(
    async (next: Settings) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await invoke<Settings>("update_settings", {
          settings: next,
        });
        setSettings(saved);
        store.reset();
        clearAnalysis();
      } catch (e) {
        setError(errorText(e));
        const [s, a] = await Promise.all([
          invoke<Snapshot>("snapshot").catch(() => null),
          invoke<AudioStatus | null>("audio_status").catch(() => undefined),
        ]);
        if (s) setSettings(s.settings);
        clearAnalysis();
        if (a !== undefined) {
          setRunning(a !== null);
          if (!a) store.reset();
        }
      } finally {
        setBusy(false);
      }
    },
    [store, clearAnalysis],
  );
  const refreshDevices = useCallback(() => {
    invoke<Device[]>("list_input_devices")
      .then(setDevices)
      .catch((e) => setError(errorText(e)));
  }, []);
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    refreshDevices();
  }, [refreshDevices]);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const loadDataset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ds = await invoke<Dataset | null>("import_dataset");
      if (ds) {
        setDataset(ds);
        setMaqamId("");
        setSelectedId(null);
        clearAnalysis();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [clearAnalysis]);
  const loadReference = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ds = await invoke<Dataset>("load_reference_dataset");
      setDataset(ds);
      setMaqamId("");
      setVariantId("");
      setTonic("");
      setSelectedId(null);
      clearAnalysis();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [clearAnalysis]);
  const clearDataset = useCallback(async () => {
    setBusy(true);
    try {
      await invoke("clear_dataset");
      setDataset(null);
      setMaqamId("");
      setSelectedId(null);
      clearAnalysis();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [clearAnalysis]);
  const reference = useCallback(async (target: Target) => {
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
  }, []);
  const selectTarget = useCallback((t: Target) => {
    setSelectedId(t.id);
    setTab("teach");
  }, []);
  const openLibrary = useCallback(() => setTab("library"), []);
  const explore = useCallback((id: string) => {
    setMaqamId(id);
    setVariantId("");
    setTonic("");
    setTonicOctave(3);
    setSelectedId(null);
    setTab("teach");
    requestAnimationFrame(() =>
      boardSection.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  }, []);

  // Stable element: CameraPanel's own re-renders skip the HUD subtree.
  const hud = useMemo(
    () =>
      settings && (
        <CameraHud
          store={store}
          settings={settings}
          dataset={dataset}
          running={running}
          simulation={simulation}
          maqamLog={maqamLog}
          target={selected}
        />
      ),
    [store, settings, dataset, running, simulation, maqamLog, selected],
  );
  const zandOverlay = useMemo(
    () =>
      board && settings?.zand.overlay
        ? {
            marks: zandMarks(board),
            selectedId,
            accidentalStyle: settings.accidentalStyle,
          }
        : null,
    [board, selectedId, settings?.zand.overlay, settings?.accidentalStyle],
  );
  const fingerboardLengthMm = board?.fingerboardLengthMm;
  const courses = board?.courses.length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <span className="brand-mark">أ</span>
          <span>
            Ajnas<small>أجناس</small>
          </span>
        </a>
        <div className="topbar-caption">
          <span className="eyebrow">
            {tr("YOUR OUD COMPANION", "رفيقك مع العود")}
          </span>
          <span className={`session-state ${running ? "on" : ""}`}>
            <i />
            {running
              ? tr("LIVE", "مباشر")
              : tr("READY WHEN YOU ARE", "جاهز عندما تكون")}
          </span>
        </div>
        <div className="session-controls">
          <select
            aria-label={tr("Audio source", "مصدر الصوت")}
            disabled={running || busy || !settings}
            value={simulation ? "simulation" : "microphone"}
            onChange={(e) => setSimulation(e.target.value === "simulation")}
          >
            <option value="microphone">{tr("Microphone", "الميكروفون")}</option>
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
          <button
            className="button subtle icon-button"
            disabled={!settings}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={openSettings}
          >
            <span aria-hidden="true">⚙</span>
            <span className="label">{tr("Settings", "الإعدادات")}</span>
          </button>
        </div>
      </header>
      {(error || (running && simulation)) && (
        <div className="banners">
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
        </div>
      )}
      <main className="page">
        <div className="hero">
          {fingerboardLengthMm !== undefined && courses !== undefined ? (
            <CameraStage
              store={store}
              arabic={!!ar}
              fingerboardLengthMm={fingerboardLengthMm}
              courses={courses}
              overlay={hud}
              zand={zandOverlay}
            />
          ) : (
            <section className="panel camera-placeholder">
              <span className="empty-symbol">⌑</span>
              <p className="muted">
                {settings
                  ? tr(
                      "Preparing the fingerboard model for the camera…",
                      "نجهّز نموذج لوحة الأصابع للكاميرا…",
                    )
                  : tr(
                      "The camera view opens once local settings load.",
                      "تظهر الكاميرا بعد تحميل الإعدادات المحلية.",
                    )}
              </p>
            </section>
          )}
        </div>
        <aside className="side panel" aria-label={tr("Tools", "الأدوات")}>
          <div
            className="tabs"
            role="tablist"
            aria-label={tr("Practice tools", "أدوات التمرين")}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={t.id === tab}
                aria-controls="side-panel"
                className={`tab ${t.id === tab ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span className="tab-icon" aria-hidden="true">
                  {t.icon}
                </span>
                {ar ? t.ar : t.en}
              </button>
            ))}
          </div>
          <div
            key={tab}
            className="tab-body"
            id="side-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {!settings ? (
              <p className="muted">{tr("Loading…", "جارٍ التحميل…")}</p>
            ) : tab === "tuner" ? (
              <>
                <div className="tuner-stage">
                  {settings.visuals !== "off" && (
                    <Resonance store={store} quality={settings.visuals} />
                  )}
                  <LivePitch
                    store={store}
                    settings={settings}
                    running={running}
                    tr={tr}
                  />
                </div>
                <MelodicTrail store={store} tr={tr} />
              </>
            ) : tab === "maqam" ? (
              <MaqamHypotheses
                settings={settings}
                dataset={dataset}
                analysis={analysis}
                arabic={!!ar}
                tr={tr}
                onOpenLibrary={openLibrary}
              />
            ) : tab === "teach" ? (
              <>
                <MaqamControls
                  dataset={dataset}
                  maqamId={maqamId}
                  variantId={variantId}
                  tonic={tonic}
                  octave={tonicOctave}
                  tonics={tonicOptions}
                  arabic={!!ar}
                  busy={busy}
                  onMaqam={(id) => {
                    setMaqamId(id);
                    setVariantId("");
                    setTonic("");
                    setTonicOctave(3);
                    setSelectedId(null);
                  }}
                  onVariant={(id) => {
                    setVariantId(id);
                    setSelectedId(null);
                  }}
                  onTonic={(id) => {
                    setTonic(id);
                    setSelectedId(null);
                  }}
                  onOctave={(n) => {
                    setTonicOctave(n);
                    setSelectedId(null);
                  }}
                  onRecognition={() => {
                    if (maqam)
                      void save({
                        ...settings,
                        maqam: {
                          ...settings.maqam,
                          tonic: tonic ? JSON.parse(tonic) : maqam.tonic,
                        },
                      });
                  }}
                />
                <PracticeCoach
                  store={store}
                  settings={settings}
                  selected={selected}
                  onReference={reference}
                  tr={tr}
                />
                <section className="map-note">
                  <h2>
                    {tr("A map, guided by your ear.", "خريطة تقودها أذنك.")}
                  </h2>
                  <p className="muted small">
                    {tr(
                      "The oud has no frets. These positions follow an ideal-string model; action, pressure, and the instrument change real intonation. Loaded maqam targets keep their original cents, including intervals between equal-tempered steps.",
                      "العود بلا دساتين. تعتمد المواضع على نموذج وتر مثالي؛ ويؤثر ضغط الإصبع وارتفاع الأوتار والآلة على النغم الحقيقي. تحتفظ أهداف المقام المحمّلة بمقاديرها الأصلية بالسنت.",
                    )}
                  </p>
                  {dataset && <DatasetSource dataset={dataset} arabic={!!ar} />}
                </section>
              </>
            ) : (
              <MaqamLibrary
                settings={settings}
                dataset={dataset}
                catalogue={catalogue}
                tonicOptions={tonicOptions}
                busy={busy}
                arabic={!!ar}
                tr={tr}
                onLoadReference={loadReference}
                onImport={loadDataset}
                onClear={clearDataset}
                onSave={save}
                onExplore={explore}
              />
            )}
          </div>
        </aside>
        <div className="work">
          {board && settings && (
            <section className="panel board-panel" ref={boardSection}>
              <div className="section-heading">
                <h2>
                  {maqam?.name[ar ? "arabic" : "latin"] ??
                    tr("The fretless fingerboard", "لوحة العود بلا دساتين")}
                </h2>
                <div className="inline">
                  {maqam && (
                    <button
                      className="button subtle compact"
                      onClick={() => setTab("teach")}
                    >
                      {tr("Maqam, tonic & route", "المقام والقرار والمسار")}
                    </button>
                  )}
                  <span className="tag">
                    {tr("PLAYER NOTATION", "أسماء العازف")}
                  </span>
                </div>
              </div>
              <LiveFingerboard
                store={store}
                board={board}
                settings={settings}
                selected={selected}
                onSelect={selectTarget}
              />
            </section>
          )}
          {board?.scale && settings && (
            <MaqamScale scale={board.scale} settings={settings} />
          )}
          {settings?.showDiagnostics && (
            <Diagnostics
              store={store}
              running={running}
              status={status}
              tr={tr}
            />
          )}
        </div>
      </main>
      <footer>
        <span>
          <span className="privacy-dot" />
          {tr(
            "Ajnas · An attentive companion for your oud. Local analysis · No recordings.",
            "أجناس · رفيق يصغي لعودك. تحليل محلي · دون تسجيل.",
          )}
        </span>
        <span>
          <bdi>{settings?.tuning === "edo12" ? "12" : "24"}-EDO</bdi> <i>·</i>{" "}
          La4 <bdi>{settings?.referenceHz ?? 440} Hz</bdi> <i>·</i>{" "}
          {tr("Transpose", "نقل")}{" "}
          <bdi>
            {settings?.transposition.amount ?? 0}{" "}
            {settings?.transposition.unit ?? "semitone"}
          </bdi>{" "}
          <i>·</i> AJNAS / 0.2
        </span>
      </footer>
      {settingsOpen && settings && (
        <Drawer
          title={tr("Settings", "الإعدادات")}
          closeLabel={tr("Close", "إغلاق")}
          onClose={closeSettings}
        >
          <p className="muted small drawer-intro">
            {tr(
              "Tune this space to your instrument.",
              "اضبط هذه المساحة لتناسب آلتك.",
            )}
          </p>
          <SettingsPanel
            settings={settings}
            devices={devices}
            busy={busy}
            onSave={save}
            onRefresh={refreshDevices}
          />
        </Drawer>
      )}
    </div>
  );
}

function Drawer({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      opener?.focus();
    };
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <h2>{title}</h2>
          <button
            ref={close}
            className="drawer-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}
