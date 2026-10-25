import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  calibrationKey,
  loadCalibration,
  type Calibration,
} from "../vision/calibration";
import {
  CameraSession,
  DEFAULT_MAX_INPUT_SIZE,
  type CameraInfo,
  type CameraState,
} from "../vision/camera";
import { fusePosition } from "../vision/fusion";
import {
  fingerboardHomography,
  projectFingertip,
  validateQuadrilateral,
  type Homography,
  type Point,
  type Quadrilateral,
} from "../vision/geometry";
import {
  FRETTING_TIPS,
  FrettingHandSelector,
  type HandSelection,
  type HandSide,
} from "../vision/handSelection";
import { LandmarkSmoother } from "../vision/smoothing";
import type {
  AudioEvidence,
  Landmark,
  PositionCandidate,
  VisionObservation,
  WorkerOptions,
} from "../vision/types";

/** Advanced/testing knobs; the defaults are the measured choices in docs/VISION.md. */
export interface AdvancedVisionOptions {
  /** MediaPipe worker options, applied at the next start. */
  worker?: WorkerOptions;
  /** Longest side of the model input in pixels; 0 = full camera resolution. */
  maxInputSize?: number;
  /** One-Euro smoothing of the drawn landmarks (default on). Fusion always uses raw landmarks. */
  smoothing?: boolean;
}

export interface CameraPanelProps {
  arabic?: boolean;
  audio?: AudioEvidence | null;
  /** Physical nut-to-end distance of the region whose four corners are marked. */
  fingerboardLengthMm: number;
  courses: number;
  /** Rendered over the live video, above the landmark canvas; non-interactive. */
  overlay?: ReactNode;
  /**
   * Initial fretting (note-stopping) hand when the user has not chosen one in
   * the panel: "left" for a right-handed player (default).
   */
  frettingHand?: HandSide;
  advanced?: AdvancedVisionOptions;
}

/** A worker result with the single selected fretting hand. */
interface Tracked {
  observation: VisionObservation;
  selection: HandSelection;
  /** Selected hand as drawn (smoothed unless disabled); null when none selected. */
  hand: Landmark[] | null;
}

const FRETTING_HAND_KEY = "ajnas.vision.frettingHand";
/** Fingertips drawn as the white dots: thumb plus the four fretting fingers. */
const DRAWN_TIPS = [4, ...FRETTING_TIPS];
const MAX_DRAW_AGE_MS = 300;
const RATES = [0, 30, 20, 15, 10, 5, 2];

function savedFrettingHand(fallback: HandSide): HandSide {
  try {
    const value = localStorage.getItem(FRETTING_HAND_KEY);
    return value === "left" || value === "right" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function CameraPanel({
  arabic = false,
  audio = null,
  fingerboardLengthMm,
  courses,
  overlay,
  frettingHand: initialFrettingHand = "left",
  advanced,
}: CameraPanelProps) {
  const text = (en: string, ar: string) => (arabic ? ar : en);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<CameraSession | null>(null);
  const mounted = useRef(false);
  const uiGeneration = useRef(0);
  const [state, setState] = useState<CameraState>("off");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [info, setInfo] = useState<CameraInfo | null>(null);
  /** Non-null while the pipeline runs on a local test video instead of the camera. */
  const [testFile, setTestFile] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(false);
  const [frettingHand, setFrettingHand] = useState<HandSide>(() =>
    savedFrettingHand(initialFrettingHand),
  );
  /** 0 = as fast as the model returns results. */
  const [fps, setFps] = useState(0);
  /** Latest result, read by the draw loop every animation frame (no React render). */
  const latest = useRef<Tracked | null>(null);
  /** Copy of `latest` for text/fusion, refreshed at 10 Hz rather than per frame. */
  const [snapshot, setSnapshot] = useState<Tracked | null>(null);
  const [rate, setRate] = useState(0);
  const [now, setNow] = useState(0);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [editing, setEditing] = useState(false);
  const [orientationConfirmed, setOrientationConfirmed] = useState(false);
  const [calibrationError, setCalibrationError] = useState("");
  const selector = useRef(new FrettingHandSelector());
  const smoother = useRef(new LandmarkSmoother());
  const smoothing = advanced?.smoothing ?? true;
  /** Values the worker callback and draw loop need, without re-subscribing. */
  const live = useRef({
    board: null as Homography | null,
    frettingHand,
    mirrored,
    smoothing,
    corners: [] as Point[],
    calibrated: false,
    version: 0,
  });

  useEffect(() => {
    mounted.current = true;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        if (mounted.current)
          setDevices((list ?? []).filter((d) => d.kind === "videoinput"));
      } catch {
        /* Camera start reports permission failures with actionable detail. */
      }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      mounted.current = false;
      uiGeneration.current++;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      session.current?.stop(false);
      session.current = null;
    };
  }, []);

  useEffect(() => {
    session.current?.setFps(fps);
  }, [fps]);

  useEffect(() => {
    if (state !== "running") return;
    // Text, fusion and diagnostics refresh at 10 Hz; the overlay draws per frame.
    let count = 0;
    let since = performance.now();
    let lastFrame = -1;
    const tick = () => {
      const at = performance.now();
      const current = latest.current;
      if (current && current.observation.frameId !== lastFrame) {
        count += current.observation.frameId - Math.max(0, lastFrame);
        lastFrame = current.observation.frameId;
      }
      if (at - since >= 1000) {
        setRate((count * 1000) / (at - since));
        count = 0;
        since = at;
      }
      setNow(at);
      setSnapshot(current);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    const saved = info
      ? loadCalibration(
          info.cameraId,
          info.width / info.height,
          fingerboardLengthMm,
          courses,
        )
      : null;
    setCalibration(saved);
    setCorners(saved ? [...saved.corners] : []);
    setEditing(false);
    setOrientationConfirmed(false);
    setCalibrationError("");
  }, [info, fingerboardLengthMm, courses]);

  const calibrated = !!(
    calibration &&
    info &&
    calibration.cameraId === info.cameraId &&
    Math.abs(calibration.aspectRatio / (info.width / info.height) - 1) <=
      0.005 &&
    calibration.fingerboardLengthMm === fingerboardLengthMm &&
    calibration.courses === courses &&
    !editing
  );
  const map = useMemo(
    () => (calibration ? fingerboardHomography(calibration.corners) : null),
    [calibration],
  );

  useEffect(() => {
    const values = live.current;
    values.board = calibrated ? map : null;
    values.frettingHand = frettingHand;
    values.mirrored = mirrored;
    values.smoothing = smoothing;
    values.corners = corners;
    values.calibrated = calibrated;
    values.version++;
    selector.current.reset();
  }, [map, calibrated, frettingHand, mirrored, smoothing, corners]);

  // Overlay: drawn on animation frames, only when its content changed. The
  // canvas backing store is resized only when the video size changes.
  useEffect(() => {
    if (state !== "running") return;
    let frame = 0;
    let drawn = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      const source = video.current;
      const context = element?.getContext("2d");
      if (!element || !source || !context) return;
      const width = source.videoWidth || 960;
      const height = source.videoHeight || 540;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
        drawn = "";
      }
      const values = live.current;
      const tracked = latest.current;
      const at = performance.now();
      const hand =
        tracked?.hand &&
        at >= tracked.observation.capturedAt &&
        at - tracked.observation.capturedAt <= MAX_DRAW_AGE_MS
          ? tracked.hand
          : null;
      const key = `${values.version}:${hand ? tracked!.observation.frameId : "-"}`;
      if (key === drawn) return;
      drawn = key;
      context.clearRect(0, 0, width, height);
      const points = values.corners;
      if (points.length) {
        context.strokeStyle = values.calibrated ? "#53d6b2" : "#ffcc77";
        context.fillStyle = "rgba(83,214,178,0.08)";
        context.lineWidth = 3;
        context.beginPath();
        points.forEach((point, i) =>
          i === 0
            ? context.moveTo(point.x * width, point.y * height)
            : context.lineTo(point.x * width, point.y * height),
        );
        if (points.length === 4) {
          context.closePath();
          context.fill();
        }
        context.stroke();
        points.forEach((point, i) => {
          context.fillStyle = "#ffcc77";
          context.beginPath();
          context.arc(point.x * width, point.y * height, 6, 0, Math.PI * 2);
          context.fill();
          context.font = "20px sans-serif";
          context.fillText(
            String(i + 1),
            point.x * width + 10,
            point.y * height - 8,
          );
        });
      }
      if (hand) {
        const radius = Math.max(4, Math.round(width / 190));
        context.fillStyle = "#ffffff";
        for (const index of DRAWN_TIPS) {
          const point = hand[index];
          if (!point) continue;
          context.beginPath();
          context.arc(
            point.x * width,
            point.y * height,
            radius,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      const element = canvas.current;
      element?.getContext("2d")?.clearRect(0, 0, element.width, element.height);
    };
  }, [state]);

  const observation = snapshot?.observation ?? null;
  const selection = snapshot?.selection ?? null;
  const selectedHand =
    observation && selection?.index != null
      ? observation.hands[selection.index]
      : null;
  const candidates = useMemo(() => {
    if (!map || !calibrated || !selectedHand || selection?.index == null)
      return [];
    const positions: PositionCandidate[] = [];
    // Raw (unsmoothed) landmarks: evidence keeps its capture timestamp.
    // Thumb is drawn, but excluded from fretting-course evidence.
    for (const landmarkIndex of FRETTING_TIPS) {
      const tip = selectedHand[landmarkIndex];
      const position =
        tip && projectFingertip(map, tip, fingerboardLengthMm, courses);
      if (position)
        positions.push({
          ...position,
          handIndex: selection.index,
          landmarkIndex,
        });
    }
    return positions;
  }, [map, calibrated, selectedHand, selection, fingerboardLengthMm, courses]);

  const fusion = fusePosition(
    audio,
    state === "running" && observation
      ? {
          capturedAt: observation.capturedAt,
          receivedAt: observation.receivedAt,
          calibrated,
          // Only the selected fretting hand is evidence; none selected = no hand.
          handCount: selectedHand ? 1 : 0,
          candidates,
        }
      : null,
    now,
  );

  const clearTracking = () => {
    latest.current = null;
    setSnapshot(null);
    selector.current.reset();
    smoother.current.reset();
  };

  const stop = () => {
    uiGeneration.current++;
    session.current?.stop();
    setState("off");
    clearTracking();
    setInfo(null);
  };

  const start = async (file?: File) => {
    if (!video.current) return;
    const generation = ++uiGeneration.current;
    setError("");
    setTestFile(file ? file.name : null);
    if (!file) setMirrored(false); // The live preview is never mirrored.
    clearTracking();
    setInfo(null);
    const current = new CameraSession(
      video.current,
      (next, message) => {
        if (!mounted.current || generation !== uiGeneration.current) return;
        setState(next);
        if (message) setError(message);
        if (next === "off" || next === "error") clearTracking();
      },
      (result) => {
        if (!mounted.current || generation !== uiGeneration.current) return;
        // Per-result work stays outside React: select, smooth, publish to a ref.
        const values = live.current;
        const selection = selector.current.select(
          result.hands,
          result.handedness,
          result.capturedAt,
          {
            frettingHand: values.frettingHand,
            mirrored: values.mirrored,
            board: values.board,
            aspect: result.width / result.height,
          },
        );
        const previous = latest.current?.selection;
        let hand: Landmark[] | null = null;
        if (selection.index === null) smoother.current.reset();
        else {
          // Never smooth across a switch to a different hand.
          if (!selection.continued || previous?.index == null)
            smoother.current.reset();
          const raw = result.hands[selection.index];
          hand = values.smoothing
            ? smoother.current.smooth(raw, result.capturedAt)
            : raw;
        }
        latest.current = { observation: result, selection, hand };
        setInfo((previous) =>
          previous &&
          (previous.width !== result.width || previous.height !== result.height)
            ? { ...previous, width: result.width, height: result.height }
            : previous,
        );
      },
    );
    session.current?.stop(false);
    session.current = current;
    current.setFps(fps);
    current.setMaxInputSize(advanced?.maxInputSize ?? DEFAULT_MAX_INPUT_SIZE);
    if (advanced?.worker) current.setWorkerOptions(advanced.worker);
    try {
      const camera = await current.start(
        file ? { kind: "file", file, name: file.name } : selected,
      );
      if (!mounted.current || generation !== uiGeneration.current) return;
      setInfo(camera);
      if (file) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current && generation === uiGeneration.current)
        setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch {
      /* Session reports errors; stale starts and unmounts are deliberately silent. */
    }
  };

  const calibrate = () => {
    setCalibration(null);
    setCorners([]);
    setEditing(true);
    setOrientationConfirmed(false);
    setCalibrationError("");
    if (info?.cameraId) {
      try {
        localStorage.removeItem(calibrationKey(info.cameraId));
      } catch {
        setCalibrationError(
          text(
            "Storage is unavailable; calibration will last for this session.",
            "التخزين غير متاح؛ ستبقى المعايرة لهذه الجلسة فقط.",
          ),
        );
      }
    }
  };
  const mark = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!editing || corners.length === 4 || state !== "running") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setCorners((previous) =>
      [
        ...previous,
        {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        },
      ].slice(0, 4),
    );
    setCalibrationError("");
  };
  const save = () => {
    const invalid = validateQuadrilateral(corners);
    if (invalid) {
      setCalibrationError(invalid);
      return;
    }
    if (!info?.cameraId) {
      setCalibrationError(
        text(
          "Camera identity unavailable; calibration cannot be saved safely.",
          "هوية الكاميرا غير متاحة؛ لا يمكن حفظ المعايرة بأمان.",
        ),
      );
      return;
    }
    if (
      !orientationConfirmed ||
      !Number.isFinite(fingerboardLengthMm) ||
      fingerboardLengthMm <= 0 ||
      !Number.isInteger(courses) ||
      courses < 2
    )
      return;
    const value: Calibration = {
      version: 1,
      cameraId: info.cameraId,
      aspectRatio: info.width / info.height,
      fingerboardLengthMm,
      courses,
      corners: corners as unknown as Quadrilateral,
      savedAt: Date.now(),
    };
    setCalibration(value);
    setEditing(false);
    setCalibrationError("");
    try {
      localStorage.setItem(
        calibrationKey(info.cameraId),
        JSON.stringify(value),
      );
    } catch {
      setCalibrationError(
        text(
          "Calibration is active, but storage failed. It will not survive restart.",
          "المعايرة نشطة، لكن تعذر حفظها بعد إعادة التشغيل.",
        ),
      );
    }
  };

  const cornerNames = [
    text("Nut · lowest course", "الأنف · الوتر الأغلظ"),
    text("Nut · highest course", "الأنف · الوتر الأرفع"),
    text("End · highest course", "النهاية · الوتر الأرفع"),
    text("End · lowest course", "النهاية · الوتر الأغلظ"),
  ];
  const status =
    fusion.state === "consistent"
      ? text(
          "Position agrees with audio; contact is unverified.",
          "الموضع متوافق مع الصوت؛ ملامسة الوتر غير مؤكدة.",
        )
      : fusion.state === "conflict"
        ? text(
            "Position disagrees. Acoustic note retained.",
            "الموضع غير متوافق. تبقى النغمة الصوتية كما هي.",
          )
        : text("Position unknown / uncertain", "الموضع غير معروف / غير مؤكد");

  return (
    <section
      className="panel camera-panel"
      aria-label={text(
        "Camera and fingerboard calibration",
        "الكاميرا ومعايرة لوحة الأصابع",
      )}
    >
      <h2>{text("Camera & fingerboard", "الكاميرا ولوحة الأصابع")}</h2>
      <p>
        {text(
          "Optional, local hand tracking. Audio remains the source of the note. No video is recorded or uploaded.",
          "تتبّع اختياري ومحلي لليد. يبقى الصوت مصدر النغمة. لا يُسجّل الفيديو ولا يُرفع.",
        )}
      </p>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          alignItems: "end",
        }}
      >
        <label className="field">
          {text("Camera", "الكاميرا")}
          <select
            value={selected}
            disabled={state === "running" || state === "starting"}
            onChange={(e) => {
              setSelected(e.target.value);
              setInfo(null);
            }}
          >
            <option value="">{text("System default", "الافتراضية")}</option>
            {devices.map(
              (device, i) =>
                device.deviceId && (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `${text("Camera", "كاميرا")} ${i + 1}`}
                  </option>
                ),
            )}
          </select>
        </label>
        {state === "running" || state === "starting" ? (
          <button className="button" onClick={stop}>
            {text("Stop camera", "إيقاف الكاميرا")}
          </button>
        ) : (
          <>
            <button className="button" onClick={() => void start()}>
              {text("Start camera", "تشغيل الكاميرا")}
            </button>
            <label className="field">
              {text(
                "Test with a video file (instead of the camera)",
                "اختبار بملف فيديو (بدلاً من الكاميرا)",
              )}
              <input
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void start(file);
                }}
              />
            </label>
          </>
        )}
        <label className="field">
          {text("Tracking rate", "معدل التتبّع")}
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {RATES.map((value) => (
              <option key={value} value={value}>
                {value === 0
                  ? text("As fast as possible", "بأقصى سرعة ممكنة")
                  : `${value} ${text("fps", "إطار/ث")}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {text("Fretting hand", "يد العفق")}
          <select
            value={frettingHand}
            onChange={(e) => {
              const value = e.target.value === "right" ? "right" : "left";
              setFrettingHand(value);
              try {
                localStorage.setItem(FRETTING_HAND_KEY, value);
              } catch {
                /* The choice still applies for this session. */
              }
            }}
          >
            <option value="left">
              {text("Left (right-handed player)", "اليسرى (عازف أيمن)")}
            </option>
            <option value="right">
              {text("Right (left-handed player)", "اليمنى (عازف أعسر)")}
            </option>
          </select>
        </label>
        {testFile && (
          <label className="field">
            <input
              type="checkbox"
              checked={mirrored}
              onChange={(e) => setMirrored(e.target.checked)}
            />
            {text(
              "Video is mirrored (selfie recording)",
              "الفيديو معكوس (تصوير ذاتي)",
            )}
          </label>
        )}
      </div>
      <p role="status">
        {state === "starting"
          ? text(
              "Starting camera and local model…",
              "جارٍ تشغيل الكاميرا والنموذج المحلي…",
            )
          : state === "running"
            ? status
            : text("Camera off", "الكاميرا متوقفة")}
      </p>
      {error && <p role="alert">{error}</p>}
      {testFile && (state === "running" || state === "starting") && (
        <p className="simulation-banner">
          {text(
            "VIDEO FILE TEST — tracking a local video, not the live camera",
            "اختبار بملف فيديو — تتبّع فيديو محلي، لا الكاميرا المباشرة",
          )}
          : {testFile}
        </p>
      )}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 960,
          background: "#10151b",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <video
          ref={video}
          muted
          playsInline
          aria-label={text("Live camera preview", "معاينة الكاميرا المباشرة")}
          style={{
            display: "block",
            width: "100%",
            minHeight: state === "running" ? undefined : 180,
          }}
        />
        <canvas
          ref={canvas}
          onClick={mark}
          aria-label={text(
            "Mark fingerboard corners in the requested order",
            "حدّد زوايا لوحة الأصابع بالترتيب",
          )}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: editing ? "crosshair" : "default",
          }}
        />
        {overlay && (
          <div
            className="camera-overlay"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {overlay}
          </div>
        )}
      </div>
      {state === "running" && (
        <>
          <p>
            {calibrated
              ? text(
                  "Calibration saved. Recalibrate whenever the camera or oud moves.",
                  "المعايرة محفوظة. أعدها عند تحريك الكاميرا أو العود.",
                )
              : text(
                  "Uncalibrated. Mark the outermost course centerlines at the nut and fingerboard end.",
                  "لم تُعاير بعد. حدّد خطّي الوترين الخارجيين عند الأنف ونهاية لوحة الأصابع.",
                )}
          </p>
          <p>
            {text(
              "Marked nut-to-end length",
              "المسافة المحددة من الأنف إلى النهاية",
            )}
            : {fingerboardLengthMm} mm · {courses}{" "}
            {text("courses", "أوتار مزدوجة")}
          </p>
          <button className="button" onClick={calibrate}>
            {text(
              "Recalibrate / mark four corners",
              "إعادة المعايرة / تحديد أربع زوايا",
            )}
          </button>
          {editing && (
            <div>
              <ol>
                {cornerNames.map((name, i) => (
                  <li key={name}>
                    {name} {corners[i] ? "✓" : i === corners.length ? "←" : ""}
                  </li>
                ))}
              </ol>
              <p>
                {text(
                  "Click these four points on the image. Low/high means pitch, regardless of screen direction. The preview is not mirrored.",
                  "انقر هذه النقاط الأربع على الصورة. الأغلظ والأرفع حسب طبقة الصوت، لا اتجاه الشاشة. الصورة غير معكوسة.",
                )}
              </p>
              <button
                className="button"
                disabled={!corners.length}
                onClick={() => {
                  setCorners((previous) => previous.slice(0, -1));
                  setOrientationConfirmed(false);
                }}
              >
                {text("Undo last point", "تراجع عن آخر نقطة")}
              </button>
              <label className="field">
                <input
                  type="checkbox"
                  checked={orientationConfirmed}
                  onChange={(e) => setOrientationConfirmed(e.target.checked)}
                />
                {text(
                  "I confirm the nut/end and low/high course orientation and the marked length.",
                  "أؤكد اتجاه الأنف والنهاية وترتيب الأوتار والمسافة المحددة.",
                )}
              </label>
              <button
                className="button"
                disabled={corners.length !== 4 || !orientationConfirmed}
                onClick={save}
              >
                {text("Save calibration", "حفظ المعايرة")}
              </button>
            </div>
          )}
          {calibrationError && <p role="alert">{calibrationError}</p>}
          {observation && (
            <p>
              {text("Inference", "المعالجة")}:{" "}
              {observation.inferenceMs.toFixed(1)} ms ({observation.delegate},{" "}
              {observation.inputWidth}×{observation.inputHeight}) ·{" "}
              {rate.toFixed(0)} {text("fps", "إطار/ث")} ·{" "}
              {text("frame age", "عمر الإطار")}:{" "}
              {Math.max(0, Math.round(now - observation.capturedAt))} ms ·{" "}
              {text("hands seen", "الأيدي المرئية")}:{" "}
              {now - observation.capturedAt <= MAX_DRAW_AGE_MS
                ? observation.hands.length
                : "—"}{" "}
              · {text("fretting hand", "يد العفق")}:{" "}
              {selection?.index == null
                ? text("not found", "غير موجودة")
                : selection.reason === "fingerboard"
                  ? text("on the fingerboard", "على لوحة الأصابع")
                  : selection.reason === "handedness"
                    ? text("by handedness", "حسب اليد")
                    : text("tracked", "متتبَّعة")}
            </p>
          )}
          {fusion.candidate && (
            <p>
              {text("Candidate course", "الوتر المحتمل")}:{" "}
              {fusion.candidate.course! + 1} ·{" "}
              {fusion.candidate.distanceMm.toFixed(0)} mm{" "}
              {text("from nut", "من الأنف")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default CameraPanel;
