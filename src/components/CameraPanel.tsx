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
import { HandCountPolicy } from "../vision/handCount";
import { HandRoleLearner } from "../vision/handRole";
import { NeckFollower, type NeckUpdate } from "../vision/neckFollower";
import { handBox, type Box } from "../vision/neckTracker";
import { LandmarkSmoother } from "../vision/smoothing";
import { NoteName, type AccidentalStyle } from "@naghma/ui";
import { INTONATION_COLOURS, intonation, type ZandMark } from "../lib/zand";
import {
  imageFromBoard,
  zandOverlayShapes,
  type ZandOverlayShapes,
} from "../vision/zandOverlay";
import type {
  AudioEvidence,
  Landmark,
  PositionCandidate,
  VisionObservation,
  WorkerOptions,
} from "../vision/types";

/** Advanced/testing knobs; the defaults are the measured choices in docs/VISION.md. */
export interface AdvancedVisionOptions {
  /**
   * MediaPipe worker options, applied at the next start. Setting numHands pins
   * it; otherwise it adapts (one hand, two while searching for the fretting hand).
   */
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
  /** Zand note positions drawn on the calibrated neck; null or absent = none. */
  zand?: ZandOverlay | null;
  /**
   * Initial fretting (note-stopping) hand when the user has not chosen one in
   * the panel. "auto" (default) learns it from the risha grip, which also
   * copes with mirrored images and left-handed players.
   */
  frettingHand?: FrettingSetting;
  advanced?: AdvancedVisionOptions;
}

export interface ZandOverlay {
  marks: readonly ZandMark[];
  selectedId: string | null;
  accidentalStyle: AccidentalStyle;
}

/** The fingertip whose position agrees with the heard note. */
interface Highlight {
  landmark: number;
  colour: string;
  label: string;
}

/** A worker result with the single selected fretting hand. */
interface Tracked {
  observation: VisionObservation;
  selection: HandSelection;
  /** Selected hand as drawn (smoothed unless disabled); null when none selected. */
  hand: Landmark[] | null;
}

/** "auto": learn which detected hand frets; otherwise the player's hand. */
export type FrettingSetting = "auto" | HandSide;
// v2: "auto" became the default; earlier stored choices were mostly the old default.
const FRETTING_HAND_KEY = "ajnas.vision.frettingHand.v2";
const FOLLOW_NECK_KEY = "ajnas.vision.followNeck.v1";
/** Followed corners are written back to the saved calibration at most this often. */
const FOLLOW_SAVE_MS = 3000;
/** ...and only after moving this far (normalised to the image width). */
const FOLLOW_SAVE_MOVE = 0.002;
/** Fingertips drawn as the white dots: thumb plus the four fretting fingers. */
const DRAWN_TIPS = [4, ...FRETTING_TIPS];
const MAX_DRAW_AGE_MS = 300;
const RATES = [0, 30, 20, 15, 10, 5, 2];

function savedFollowNeck(): boolean {
  try {
    return localStorage.getItem(FOLLOW_NECK_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Hands are excluded from neck tracking: they move on their own. */
function handBoxes(hands: readonly Landmark[][]): Box[] {
  return hands.map((hand) => handBox(hand)).filter((b): b is Box => !!b);
}

function savedFrettingHand(fallback: FrettingSetting): FrettingSetting {
  try {
    const value = localStorage.getItem(FRETTING_HAND_KEY);
    return value === "auto" || value === "left" || value === "right"
      ? value
      : fallback;
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
  zand = null,
  frettingHand: initialFrettingHand = "auto",
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
  const [frettingHand, setFrettingHand] = useState<FrettingSetting>(() =>
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
  /** Keep the calibration on the neck as the oud or camera moves. */
  const [follow, setFollow] = useState(savedFollowNeck);
  const follower = useRef<NeckFollower | null>(null);
  /** Latest neck-tracking update (worker rate); copied to `neck` at 10 Hz. */
  const neckLatest = useRef<NeckUpdate | null>(null);
  const [neck, setNeck] = useState<NeckUpdate | null>(null);
  const [neckError, setNeckError] = useState("");
  const selector = useRef(new FrettingHandSelector());
  const smoother = useRef(new LandmarkSmoother());
  const handCount = useRef(new HandCountPolicy());
  const roles = useRef(new HandRoleLearner());
  const smoothing = advanced?.smoothing ?? true;
  /** Values the worker callback and draw loop need, without re-subscribing. */
  const live = useRef({
    board: null as Homography | null,
    frettingHand,
    mirrored,
    smoothing,
    corners: [] as readonly Point[],
    calibrated: false,
    version: 0,
    highlight: null as Highlight | null,
    zand: null as ZandOverlayShapes | null,
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
      setNeck(neckLatest.current);
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

  // Neck tracking: start from the saved calibration on the current frame,
  // then carry its corners with the oud. Restarts on a new calibration.
  const following = follow && calibrated && state === "running";
  useEffect(() => {
    const element = video.current;
    if (!following || !calibration || !element) return;
    const current = new NeckFollower(
      element,
      (update) => {
        neckLatest.current = update;
      },
      (message) => setNeckError(message),
    );
    current.setReference(
      calibration.corners,
      handBoxes(latest.current?.observation.hands ?? []),
    );
    current.start();
    follower.current = current;
    setNeckError("");
    return () => {
      current.stop();
      follower.current = null;
      neckLatest.current = null;
      setNeck(null);
    };
  }, [following, calibration]);

  const lost = following && neck?.status === "lost";
  const followed =
    following && neck?.status === "tracking" ? neck.corners : null;
  // Keyed by value: every tracker update is a new array, even when still.
  const cornerKey = JSON.stringify(followed ?? calibration?.corners ?? null);
  const activeCorners = useMemo<Quadrilateral | null>(
    () => JSON.parse(cornerKey),
    [cornerKey],
  );
  // Followed corners may briefly fold into an invalid shape; then none apply.
  const map = useMemo(() => {
    if (!activeCorners) return null;
    try {
      return fingerboardHomography(activeCorners);
    } catch {
      return null;
    }
  }, [activeCorners]);
  /** Calibrated, and the calibration still fits the neck. */
  const usable = calibrated && !lost && !!map;
  const zandShapes = useMemo(
    () =>
      zand && activeCorners && usable
        ? zandOverlayShapes(
            imageFromBoard(activeCorners),
            zand.marks,
            courses,
            zand.selectedId,
          )
        : null,
    [zand, activeCorners, usable, courses],
  );

  // Write followed corners back, so the next session starts where the neck is.
  const lastFollowSave = useRef(0);
  useEffect(() => {
    if (
      !calibration ||
      !following ||
      neck?.status !== "tracking" ||
      !neck.corners ||
      neck.inliers < 20
    )
      return;
    const at = performance.now();
    if (at - lastFollowSave.current < FOLLOW_SAVE_MS) return;
    const shift = Math.max(
      ...neck.corners.map((p, i) =>
        Math.hypot(
          p.x - calibration.corners[i].x,
          p.y - calibration.corners[i].y,
        ),
      ),
    );
    if (shift < FOLLOW_SAVE_MOVE) return;
    lastFollowSave.current = at;
    try {
      localStorage.setItem(
        calibrationKey(calibration.cameraId),
        JSON.stringify({
          ...calibration,
          corners: neck.corners,
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* Following still works for this session. */
    }
  }, [neck, calibration, following]);
  useEffect(() => {
    live.current.zand = zandShapes;
    live.current.version++;
  }, [zandShapes]);

  useEffect(() => {
    const values = live.current;
    values.frettingHand = frettingHand;
    values.mirrored = mirrored;
    values.smoothing = smoothing;
    values.version++;
    selector.current.reset();
  }, [calibrated, frettingHand, mirrored, smoothing]);
  // Following moves the board several times a second: no selector reset.
  useEffect(() => {
    const values = live.current;
    values.board = usable ? map : null;
    values.corners =
      !editing && usable && activeCorners ? activeCorners : corners;
    values.calibrated = usable;
    values.version++;
  }, [map, usable, editing, corners, activeCorners]);

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
      const lit = hand ? values.highlight : null;
      const key = `${values.version}:${hand ? tracked!.observation.frameId : "-"}:${lit ? `${lit.landmark}${lit.colour}${lit.label}` : ""}`;
      if (key === drawn) return;
      drawn = key;
      context.clearRect(0, 0, width, height);
      if (values.zand) drawZand(context, values.zand, width, height);
      const points = values.corners;
      // Once the zand is drawn, its strings already outline the calibration.
      if (points.length && !(values.zand && values.calibrated)) {
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
        // With a playing finger identified, the others step back.
        context.fillStyle = lit ? "rgba(255,255,255,0.6)" : "#ffffff";
        for (const index of DRAWN_TIPS) {
          const point = hand[index];
          if (!point || index === lit?.landmark) continue;
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
        const point = lit && hand[lit.landmark];
        if (lit && point)
          drawPlayingTip(context, point, width, height, radius, lit);
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
    if (!map || !usable || !selectedHand || selection?.index == null) return [];
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
  }, [map, usable, selectedHand, selection, fingerboardLengthMm, courses]);

  const fusion = fusePosition(
    audio,
    state === "running" && observation
      ? {
          capturedAt: observation.capturedAt,
          receivedAt: observation.receivedAt,
          calibrated: usable,
          // Only the selected fretting hand is evidence; none selected = no hand.
          handCount: selectedHand ? 1 : 0,
          candidates,
        }
      : null,
    now,
  );

  // The playing fingertip, for the draw loop: only when vision and audio agree.
  const highlight: Highlight | null =
    fusion.state === "consistent" && fusion.candidate && audio
      ? {
          landmark: fusion.candidate.landmarkIndex,
          colour: INTONATION_COLOURS[intonation(audio.cents ?? 0)],
          label: audio.label ?? "",
        }
      : null;
  useEffect(() => {
    live.current.highlight = highlight;
  });

  const clearTracking = () => {
    latest.current = null;
    setSnapshot(null);
    selector.current.reset();
    smoother.current.reset();
    roles.current.reset();
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
    const adaptive = advanced?.worker?.numHands === undefined;
    let requested = advanced?.worker?.numHands ?? 1;
    handCount.current.reset();
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
        const aspect = result.width / result.height;
        const auto = values.frettingHand === "auto";
        if (auto)
          roles.current.observe(result.hands, result.handedness, aspect);
        const selection = selector.current.select(
          result.hands,
          result.handedness,
          result.capturedAt,
          auto
            ? {
                // The learned label of the fretting hand, expressed as "left
                // hand, possibly mirrored"; the mirror checkbox is the prior.
                frettingHand: "left",
                mirrored:
                  roles.current.frettingLabel(
                    values.mirrored ? "Right" : "Left",
                  ) === "Right",
                board: values.board,
                aspect,
              }
            : {
                frettingHand: values.frettingHand as HandSide,
                mirrored: values.mirrored,
                board: values.board,
                aspect,
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
        follower.current?.setExclude(handBoxes(result.hands));
        if (adaptive) {
          const numHands = handCount.current.update(
            selection,
            result.hands.length,
            result.capturedAt,
            // Learning needs both hands in view; calibration selects by itself.
            auto && !values.board && !roles.current.confident,
          );
          if (numHands !== requested) {
            requested = numHands;
            current.setNumHands(numHands);
          }
        }
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
    current.setWorkerOptions({ ...advanced?.worker, numHands: requested });
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
              const value: FrettingSetting =
                e.target.value === "right"
                  ? "right"
                  : e.target.value === "left"
                    ? "left"
                    : "auto";
              setFrettingHand(value);
              try {
                localStorage.setItem(FRETTING_HAND_KEY, value);
              } catch {
                /* The choice still applies for this session. */
              }
            }}
          >
            <option value="auto">
              {text(
                "Automatic (from the risha grip)",
                "تلقائي (من طريقة مسك الريشة)",
              )}
            </option>
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
        {zandShapes && zand && state === "running" && (
          <div className="zand-camera-labels" aria-hidden="true">
            {zandShapes.labels.map(({ point, mark }) => (
              <span
                key={mark.key}
                className={`zand-label ${mark.tonic ? "tonic" : ""} ${mark.targetId === zand.selectedId ? "chosen" : ""}`}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              >
                <NoteName label={mark.label} style={zand.accidentalStyle} />
              </span>
            ))}
          </div>
        )}
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
              ? follow
                ? text(
                    "Calibration saved. It follows the neck; recalibrate if the virtual strings drift off the real ones.",
                    "المعايرة محفوظة وتتابع الزند؛ أعدها إذا ابتعدت الأوتار الافتراضية عن الحقيقية.",
                  )
                : text(
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
          {calibrated && (
            <p role="status">
              {!follow
                ? text(
                    "Not following the neck: the calibration is fixed to the image.",
                    "لا يُتابَع الزند: المعايرة ثابتة على الصورة.",
                  )
                : lost
                  ? text(
                      "Lost the oud's neck. Bring it back into view where it was, or recalibrate. Positions are paused.",
                      "فُقد زند العود. أعده إلى مكانه في الصورة أو أعد المعايرة. المواضع متوقفة مؤقتاً.",
                    )
                  : neck
                    ? text(
                        "Following the neck as the oud moves.",
                        "يتابع الزند مع حركة العود.",
                      )
                    : text("Finding the neck…", "جارٍ إيجاد الزند…")}
            </p>
          )}
          {neckError && <p role="alert">{neckError}</p>}
          <label className="field">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
                try {
                  localStorage.setItem(
                    FOLLOW_NECK_KEY,
                    e.target.checked ? "on" : "off",
                  );
                } catch {
                  /* The choice still applies for this session. */
                }
              }}
            />
            {text(
              "Follow the oud when it or the camera moves (keeps the calibration on the neck)",
              "تابع العود عند تحريكه أو تحريك الكاميرا (تبقى المعايرة على الزند)",
            )}
          </label>
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
              {observation.inputWidth}×{observation.inputHeight},{" "}
              {observation.numHands === 1
                ? text("1-hand model", "نموذج يد واحدة")
                : text("2-hand model", "نموذج يدين")}
              ) · {rate.toFixed(0)} {text("fps", "إطار/ث")} ·{" "}
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
              {neck && (
                <>
                  {" "}
                  · {text("neck", "الزند")}:{" "}
                  {neck.status === "lost" && text("lost", "مفقود") + " "}
                  {neck.inliers}/{neck.points} ({neck.ms.toFixed(1)} ms,{" "}
                  {text("moved", "تحرّك")} {(neck.moved * 100).toFixed(1)}%)
                </>
              )}
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

/** Virtual strings, ±10-cent zones and the target ring on the real neck. */
function drawZand(
  context: CanvasRenderingContext2D,
  shapes: ZandOverlayShapes,
  width: number,
  height: number,
) {
  const px = (p: Point) => [p.x * width, p.y * height] as const;
  const line = Math.max(1, width / 900);
  context.save();
  context.strokeStyle = "rgba(243,232,204,0.35)";
  context.lineWidth = line;
  for (const [from, to] of shapes.strings) {
    context.beginPath();
    context.moveTo(...px(from));
    context.lineTo(...px(to));
    context.stroke();
  }
  // Zones are a few pixels long on a distant neck: a dark outline and an
  // outline in their own colour keep them visible on wood and strings.
  context.lineJoin = "round";
  for (const zone of shapes.zones) {
    context.beginPath();
    zone.points.forEach((p, i) =>
      i ? context.lineTo(...px(p)) : context.moveTo(...px(p)),
    );
    context.closePath();
    context.globalAlpha = zone.alpha * 0.6;
    context.strokeStyle = "#000000";
    context.lineWidth = line * 3.5;
    context.stroke();
    context.globalAlpha = zone.alpha;
    context.strokeStyle = zone.colour;
    context.lineWidth = line * 1.5;
    context.stroke();
    context.fillStyle = zone.colour;
    context.fill();
  }
  context.globalAlpha = 1;
  context.strokeStyle = "#dec08a";
  context.lineWidth = line * 2.5;
  for (const { centre, edge } of shapes.rings) {
    const [x, y] = px(centre);
    const [ex, ey] = px(edge);
    context.beginPath();
    context.arc(x, y, Math.max(6, Math.hypot(ex - x, ey - y)), 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

/** A glowing, intonation-coloured fingertip with the heard note's name. */
function drawPlayingTip(
  context: CanvasRenderingContext2D,
  point: Point,
  width: number,
  height: number,
  radius: number,
  lit: Highlight,
) {
  const x = point.x * width;
  const y = point.y * height;
  context.save();
  context.shadowColor = lit.colour;
  context.shadowBlur = radius * 4;
  context.fillStyle = lit.colour;
  context.beginPath();
  context.arc(x, y, radius * 1.6, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1.5, radius / 3);
  context.beginPath();
  context.arc(x, y, radius * 2.4, 0, Math.PI * 2);
  context.stroke();
  if (!lit.label) return;
  const size = Math.max(14, Math.round(width / 55));
  context.font = `600 ${size}px sans-serif`;
  context.textAlign = "center";
  context.lineWidth = Math.max(3, size / 5);
  context.strokeStyle = "rgba(0,0,0,0.7)";
  context.strokeText(lit.label, x, y - radius * 3.2);
  context.fillStyle = lit.colour;
  context.fillText(lit.label, x, y - radius * 3.2);
  context.textAlign = "start";
}

export default CameraPanel;
