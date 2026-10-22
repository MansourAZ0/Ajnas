import { NoteName } from "@naghma/ui";
import type { Dataset, ScaleInfo, Settings, TonicOption } from "../lib/types";

export function MaqamControls({
  dataset,
  maqamId,
  variantId,
  tonic,
  octave,
  tonics,
  arabic,
  busy,
  onMaqam,
  onVariant,
  onTonic,
  onOctave,
  onRecognition,
}: {
  dataset: Dataset | null;
  maqamId: string;
  variantId: string;
  tonic: string;
  octave: number;
  tonics: TonicOption[];
  arabic: boolean;
  busy: boolean;
  onMaqam: (id: string) => void;
  onVariant: (id: string) => void;
  onTonic: (id: string) => void;
  onOctave: (octave: number) => void;
  onRecognition: () => void;
}) {
  const tr = (en: string, ar: string) => (arabic ? ar : en);
  const m = dataset?.maqamat.find((m) => m.id === maqamId);
  return (
    <div className="panel teaching-controls">
      <label className="field">
        {tr("Maqam", "المقام")}
        <select value={maqamId} onChange={(e) => onMaqam(e.target.value)}>
          <option value="">
            {tr(
              "All notes · current tuning grid",
              "جميع النغمات · نظام الدوزان الحالي",
            )}
          </option>
          {dataset?.maqamat.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name[arabic ? "arabic" : "latin"]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {tr(
          "Tonic · same pattern, another starting note",
          "القرار · نفس الأبعاد من نغمة أخرى",
        )}
        <select
          value={tonic}
          disabled={!m}
          onChange={(e) => onTonic(e.target.value)}
        >
          <option value="">
            {tr("Source reference tonic", "القرار المرجعي في المصدر")}
          </option>
          {tonics.map((t) => (
            <option
              key={JSON.stringify(t.spelling)}
              value={JSON.stringify(t.spelling)}
            >
              {t.label.text}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {tr("Upper-jins route", "مسار الجنس العلوي")}
        <select
          disabled={!m}
          value={variantId}
          onChange={(e) => onVariant(e.target.value)}
        >
          <option value="">
            {tr("Primary source illustration", "الصورة الأساسية في المصدر")}
          </option>
          {m?.variants?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name[arabic ? "arabic" : "latin"]}
            </option>
          ))}
        </select>
      </label>
      <label className="field octave-field">
        {tr("Tonic octave", "أوكتاف القرار")}
        <select
          disabled={!m}
          value={octave}
          onChange={(e) => onOctave(Number(e.target.value))}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button subtle"
        disabled={!m || busy}
        onClick={onRecognition}
      >
        {tr("Use this tonic for recognition", "استخدم هذا القرار للتحليل")}
      </button>
    </div>
  );
}

export function MaqamScale({
  scale,
  settings,
}: {
  scale: ScaleInfo;
  settings: Settings;
}) {
  const ar = settings.language === "ar",
    tr = (en: string, arabic: string) => (ar ? arabic : en);
  return (
    <section className="panel scale-panel">
      <div className="section-heading">
        <h2>
          {tr("The scale on your selected tonic", "السلم على القرار المختار")}
        </h2>
        <span className="scale-tonic">
          <NoteName label={scale.tonic} style={settings.accidentalStyle} />
        </span>
      </div>
      <div className="scale-notes">
        {scale.notes.map((n) => (
          <div className="scale-degree" key={n.step}>
            <small>{n.step + 1}</small>
            <NoteName label={n.label} style={settings.accidentalStyle} />
            <bdi>{n.cents} ¢</bdi>
          </div>
        ))}
      </div>
      <p className="fine-print">
        {tr(
          "Written-note approximation in 24-EDO. Cents are relative to the tonic, not a measurement of performance intonation.",
          "تقريب للنوتة المكتوبة بنظام ٢٤ قسماً. السنتات محسوبة من القرار وليست قياساً لتنغيم الأداء.",
        )}
      </p>
      {!scale.octaveRepeating && (
        <p className="warning-text">
          {tr(
            "Register-specific illustration: only the documented notes above this tonic octave are shown. Change the tonic octave to move the passage; this pattern is not automatically repeated.",
            "صورة خاصة بالسجل الصوتي: تُعرض النغمات الموثقة فوق أوكتاف القرار المختار فقط. غيّر الأوكتاف لنقل المقطع؛ ولا يُكرر هذا النمط تلقائياً.",
          )}
        </p>
      )}
      <div className="jins-grid">
        {scale.ajnas.map((j, i) => (
          <div key={i}>
            <strong>{j.name[ar ? "arabic" : "latin"]}</strong>
            <small>
              {tr("Placement at degree", "يبدأ من الدرجة")} {j.onStep + 1} ·{" "}
              {tr("Tonal centre at degree", "مركزه النغمي في الدرجة")}{" "}
              {j.tonicStep + 1}
            </small>
            <div className="jins-notes">
              {j.notes.map((n, k) => (
                <NoteName key={k} label={n} style={settings.accidentalStyle} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {scale.sources.length > 0 && (
        <p className="source-links">
          {tr("Source notation and explanation", "النوتة والشرح في المصدر")}:{" "}
          {scale.sources.map((url) => (
            <SourceLink key={url} value={url} />
          ))}
        </p>
      )}
    </section>
  );
}

function SourceLink({ value }: { value: string }) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:")
      return (
        <a href={url.href} target="_blank" rel="noreferrer">
          {url.hostname.replace("www.", "")} ↗
        </a>
      );
  } catch {
    /* Imported bibliographic text can be a citation rather than a URL. */
  }
  return <span>{value}</span>;
}
