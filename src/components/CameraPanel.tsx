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
  type CameraInfo,
  type CameraState,
} from "../vision/camera";
import { fusePosition } from "../vision/fusion";
import {
  fingerboardHomography,
  projectFingertip,
  validateQuadrilateral,
  type Point,
  type Quadrilateral,
} from "../vision/geometry";
import type {
  AudioEvidence,
  PositionCandidate,
  VisionObservation,
} from "../vision/types";

export interface CameraPanelProps {
  arabic?: boolean;
  audio?: AudioEvidence | null;
  /** Physical nut-to-end distance of the region whose four corners are marked. */
  fingerboardLengthMm: number;
  courses: number;
  /** Rendered over the live video, above the landmark canvas; non-interactive. */
  overlay?: ReactNode;
}

export function CameraPanel({
  arabic = false,
  audio = null,
  fingerboardLengthMm,
  courses,
  overlay,
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
  const [observation, setObservation] = useState<VisionObservation | null>(
    null,
  );
  const [fps, setFps] = useState(12);
  const [now, setNow] = useState(0);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [editing, setEditing] = useState(false);
  const [orientationConfirmed, setOrientationConfirmed] = useState(false);
  const [calibrationError, setCalibrationError] = useState("");

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
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 100);
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
  const candidates = useMemo(() => {
    if (!map || !calibrated || !observation) return [];
    const positions: PositionCandidate[] = [];
    observation.hands.forEach((hand, handIndex) => {
      // Thumb is drawn, but excluded from fretting-course evidence.
      for (const landmarkIndex of [8, 12, 16, 20]) {
        const tip = hand[landmarkIndex];
        const position =
          tip && projectFingertip(map, tip, fingerboardLengthMm, courses);
        if (position) positions.push({ ...position, handIndex, landmarkIndex });
      }
    });
    return positions;
  }, [map, calibrated, observation, fingerboardLengthMm, courses]);

  const fusion = fusePosition(
    audio,
    state === "running" && observation
      ? {
          capturedAt: observation.capturedAt,
          receivedAt: observation.receivedAt,
          calibrated,
          handCount: observation.hands.length,
          candidates,
        }
      : null,
    now,
  );

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const width = info?.width ?? 960;
    const height = info?.height ?? 540;
    element.width = width;
    element.height = height;
    context.clearRect(0, 0, width, height);
    if (state !== "running") return;
    if (corners.length) {
      context.strokeStyle = calibrated ? "#53d6b2" : "#ffcc77";
      context.fillStyle = "rgba(83,214,178,0.08)";
      context.lineWidth = 3;
      context.beginPath();
      corners.forEach((point, i) =>
        i === 0
          ? context.moveTo(point.x * width, point.y * height)
          : context.lineTo(point.x * width, point.y * height),
      );
      if (corners.length === 4) {
        context.closePath();
        context.fill();
      }
      context.stroke();
      corners.forEach((point, i) => {
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
    if (
      observation &&
      now >= observation.capturedAt &&
      now - observation.capturedAt <= 300
    ) {
      context.fillStyle = "#ffffff";
      observation.hands.forEach((hand) =>
        [4, 8, 12, 16, 20].forEach((index) => {
          const point = hand[index];
          if (!point) return;
          context.beginPath();
          context.arc(point.x * width, point.y * height, 5, 0, Math.PI * 2);
          context.fill();
        }),
      );
    }
  }, [info, state, observation, now, corners, calibrated]);

  const stop = () => {
    uiGeneration.current++;
    session.current?.stop();
    setState("off");
    setObservation(null);
    setInfo(null);
  };

  const start = async () => {
    if (!video.current) return;
    const generation = ++uiGeneration.current;
    setError("");
    setObservation(null);
    setInfo(null);
    const current = new CameraSession(
      video.current,
      (next, message) => {
        if (!mounted.current || generation !== uiGeneration.current) return;
        setState(next);
        if (message) setError(message);
        if (next === "off" || next === "error") setObservation(null);
      },
      (result) => {
        if (!mounted.current || generation !== uiGeneration.current) return;
        setObservation(result);
        setNow(result.receivedAt);
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
    try {
      const camera = await current.start(selected);
      if (!mounted.current || generation !== uiGeneration.current) return;
      setInfo(camera);
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
          <button className="button" onClick={() => void start()}>
            {text("Start camera", "تشغيل الكاميرا")}
          </button>
        )}
        <label className="field">
          {text("Inference rate", "معدل التتبّع")} · {fps}{" "}
          {text("fps", "إطار/ث")}
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          />
        </label>
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
              {text("Last worker inference", "آخر معالجة في الخلفية")}:{" "}
              {observation.inferenceMs.toFixed(1)} ms ·{" "}
              {text("frame age", "عمر الإطار")}:{" "}
              {Math.max(0, Math.round(now - observation.capturedAt))} ms ·{" "}
              {text("hands", "الأيدي")}:{" "}
              {now - observation.capturedAt <= 300
                ? observation.hands.length
                : "—"}
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
