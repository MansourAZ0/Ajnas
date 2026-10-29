import { memo } from "react";
import type {
  Analysis,
  Dataset,
  JinsRole,
  ScaleInfo,
  Settings,
  TonicOption,
} from "../lib/types";

type Tr = (en: string, ar: string) => string;

function jinsRoleText(role: JinsRole, tr: Tr): string {
  if (role === "lower")
    return tr("First jins · jins al-asl", "الجنس الأول · جنس الأصل");
  if (role === "upper")
    return tr("Second jins · jins al-far'", "الجنس الثاني · جنس الفرع");
  return role.other;
}

/**
 * Where the latest passage sits inside the leading maqam: its first or
 * second jins, or a jins outside it (a possible modulation).
 */
function JinsReading({
  analysis,
  dataset,
  arabic,
  tr,
}: {
  analysis: Analysis;
  dataset: Dataset;
  arabic: boolean;
  tr: Tr;
}) {
  const leader = analysis.candidates[0];
  const active = analysis.activeJins;
  const foreign = analysis.foreignJins;
  if (!leader || (!active && !foreign)) return null;
  const lang = arabic ? "arabic" : "latin";
  const jinsName = (id: string) =>
    dataset.ajnas.find((j) => j.id === id)?.name[lang] ?? id;
  const maqamName =
    dataset.maqamat.find((m) => m.id === leader.maqam)?.name[lang] ??
    leader.maqam;
  const activeLabels = analysis.activeJinsLabels;
  const foreignLabels = analysis.foreignJinsLabels;
  return (
    <div className="jins-reading" aria-live="polite">
      <p className="eyebrow">{tr("NOW PLAYING IN", "يجري العزف الآن في")}</p>
      {active && (
        <>
          <div className="jins-reading-name">
            <strong>
              {jinsName(active.jins)} {tr("on", "على")}{" "}
              {activeLabels?.root.text ?? "—"}
            </strong>
            <span className="tag">{jinsRoleText(active.role, tr)}</span>
          </div>
          <p className="fine-print">
            {tr("of", "من")} {maqamName} {tr("on", "على")}{" "}
            {analysis.tonicLabels?.[0]?.text ?? "—"}
            {activeLabels &&
              activeLabels.centre.text !== activeLabels.root.text &&
              ` · ${tr("tonal centre", "مركز الجنس")} ${activeLabels.centre.text}`}
          </p>
        </>
      )}
      {foreign && (
        <p className="warning-text">
          {tr("Possible modulation:", "تحويل محتمل:")} {jinsName(foreign.jins)}{" "}
          {tr("on", "على")} {foreignLabels?.root.text ?? "—"}
        </p>
      )}
    </div>
  );
}

export function DatasetSource({
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
      <p title={dataset.provenance.source}>{dataset.provenance.source}</p>
      <small>
        {dataset.maqamat.length} {arabic ? "مقامات" : "maqamat"} ·{" "}
        {dataset.ajnas.length} {arabic ? "أجناس" : "ajnas"} ·{" "}
        {dataset.provenance.version}
      </small>
    </div>
  );
}

export const MaqamHypotheses = memo(function MaqamHypotheses({
  settings,
  dataset,
  analysis,
  arabic,
  tr,
  onOpenLibrary,
}: {
  settings: Settings;
  dataset: Dataset | null;
  analysis: Analysis | null;
  arabic: boolean;
  tr: Tr;
  onOpenLibrary: () => void;
}) {
  return (
    <section className="analysis-panel">
      <div className="section-heading">
        <h2>{tr("Maqam hypotheses", "احتمالات المقام")}</h2>
        <span className="tag">
          {settings.maqam.enabled ? tr("ENABLED", "مفعّل") : tr("OFF", "متوقف")}
        </span>
      </div>
      {!settings.maqam.enabled ? (
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
          <button className="button subtle" onClick={onOpenLibrary}>
            {tr("Open library", "افتح المكتبة")} ↗
          </button>
        </div>
      ) : !dataset ? (
        <p className="muted">
          {tr(
            "Load a sourced dataset in Library to rank candidates.",
            "حمّل بيانات موثّقة من المكتبة لعرض الاحتمالات.",
          )}
        </p>
      ) : (
        <>
          <DatasetSource dataset={dataset} arabic={arabic} />
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
          {analysis && (
            <JinsReading
              analysis={analysis}
              dataset={dataset}
              arabic={arabic}
              tr={tr}
            />
          )}
          {analysis?.candidates.map((c, candidateIndex) => {
            const maqam = dataset.maqamat.find((m) => m.id === c.maqam);
            return (
              <div
                className="candidate"
                key={c.maqam + JSON.stringify(c.tonic)}
              >
                <div>
                  <strong>
                    {maqam?.name[arabic ? "arabic" : "latin"] ?? c.maqam}
                  </strong>
                  <span>
                    {tr("Tonic", "القرار")}:{" "}
                    {analysis.tonicLabels?.[candidateIndex]?.text ?? "—"}
                  </span>
                  <bdi>
                    {tr("Score", "النتيجة")} {c.score.toFixed(2)}
                  </bdi>
                </div>
                <p className="fine-print">
                  {c.variant
                    ? maqam?.variants?.find((v) => v.id === c.variant)?.name[
                        arabic ? "arabic" : "latin"
                      ]
                    : tr(
                        "Primary source illustration",
                        "الصورة الأساسية في المصدر",
                      )}
                </p>
                <div className="evidence">
                  {c.supporting.map((e, i) => (
                    <span key={i}>
                      {e.kind === "scaleFit"
                        ? `${tr("Scale fit", "توافق السلم")} ${((e.share ?? 0) * 100).toFixed(0)}%`
                        : e.kind === "coverage"
                          ? `${tr("Degrees heard", "درجات مسموعة")} ${e.heard}/${e.total}`
                          : e.kind === "jins"
                            ? `${e.jins}: ${((e.completeness ?? 0) * 100).toFixed(0)}%`
                            : e.kind === "cadence"
                              ? `${tr("Phrase endings on tonic", "قفلات على القرار")} ${((e.share ?? 0) * 100).toFixed(0)}%`
                              : e.kind === "register"
                                ? `${tr("Tonic register", "منطقة القرار")} ${((e.share ?? 0) * 100).toFixed(0)}%`
                                : e.kind}
                    </span>
                  ))}
                </div>
                {c.contradicting.length > 0 && (
                  <p className="warning-text">
                    {tr(
                      "Outside the selected illustration",
                      "خارج الصورة النغمية المختارة",
                    )}{" "}
                    {((c.contradicting[0].share ?? 0) * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            );
          })}
          <p className="fine-print">
            {analysis?.notes ?? 0}{" "}
            {tr(
              "completed notes · heuristic scores, not probabilities",
              "نغمات مكتملة · نتائج تقريبية وليست احتمالات إحصائية",
            )}
          </p>
        </>
      )}
    </section>
  );
});

export const MaqamLibrary = memo(function MaqamLibrary({
  settings,
  dataset,
  catalogue,
  tonicOptions,
  busy,
  arabic,
  tr,
  onLoadReference,
  onImport,
  onClear,
  onSave,
  onExplore,
}: {
  settings: Settings;
  dataset: Dataset | null;
  catalogue: ScaleInfo[];
  tonicOptions: TonicOption[];
  busy: boolean;
  arabic: boolean;
  tr: Tr;
  onLoadReference: () => void;
  onImport: () => void;
  onClear: () => void;
  onSave: (next: Settings) => void;
  onExplore: (maqamId: string) => void;
}) {
  return (
    <div className="library">
      <section>
        <div className="section-heading">
          <h2>{tr("Your musical library", "مكتبتك الموسيقية")}</h2>
        </div>
        <div className="library-actions">
          <button
            disabled={busy}
            className="button primary"
            onClick={onLoadReference}
          >
            {tr(
              "Load researched eight",
              "تحميل المقامات الثمانية الموثّقة المصادر",
            )}
          </button>
          <button disabled={busy} className="button subtle" onClick={onImport}>
            {tr("Import dataset", "استيراد البيانات")} ↗
          </button>
          {dataset && (
            <button className="button subtle" disabled={busy} onClick={onClear}>
              {tr("Remove", "إزالة")}
            </button>
          )}
        </div>
        {dataset ? (
          <DatasetSource dataset={dataset} arabic={arabic} />
        ) : (
          <div className="empty compact">
            <span className="empty-symbol">◈</span>
            <h3>
              {tr("Bring your musical knowledge.", "أحضر معرفتك الموسيقية.")}
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
      <section>
        <div className="section-heading">
          <h2>{tr("Listen for a maqam", "استمع لاكتشاف المقام")}</h2>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy || (!dataset && !settings.maqam.enabled)}
              checked={settings.maqam.enabled}
              onChange={(e) =>
                onSave({
                  ...settings,
                  maqam: { ...settings.maqam, enabled: e.target.checked },
                })
              }
            />
            {tr("Enable analysis", "تفعيل التحليل")}
          </label>
        </div>
        <div className="fields stacked">
          <label className="field">
            {tr("Pitch identity for analysis", "هوية النغمة للتحليل")}
            <select
              disabled={busy}
              value={settings.maqam.pitchSpace}
              onChange={(e) =>
                onSave({
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
                settings.maqam.tonic ? JSON.stringify(settings.maqam.tonic) : ""
              }
              onChange={(e) =>
                onSave({
                  ...settings,
                  maqam: {
                    ...settings.maqam,
                    tonic: e.target.value ? JSON.parse(e.target.value) : null,
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
          <label className="field">
            {tr("Accepted intonation error", "هامش الخطأ المقبول في الضبط")}
            <select
              disabled={busy}
              value={settings.maqam.toleranceCents}
              onChange={(e) =>
                onSave({
                  ...settings,
                  maqam: {
                    ...settings.maqam,
                    toleranceCents: Number(e.target.value),
                  },
                })
              }
            >
              {[15, 20, 25, 30, 35, 40, 45].map((c) => (
                <option key={c} value={c}>
                  ±{c} {tr("cents", "سنت")} (±{c}%{" "}
                  {tr("of a semitone", "من نصف التون")})
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={settings.maqam.tuningOffsetCents === null}
              onChange={(e) =>
                onSave({
                  ...settings,
                  maqam: {
                    ...settings.maqam,
                    tuningOffsetCents: e.target.checked ? null : 0,
                  },
                })
              }
            />
            {tr(
              "Correct for the instrument's overall tuning",
              "تعويض ضبط الآلة العام",
            )}
          </label>
        </div>
        <p className="muted small">
          {tr(
            `A rolling ${settings.maqam.windowS}-second window, updated every ${settings.maqam.intervalS} seconds. Evidence includes scale fit, resting tones, ajnas, and characteristic phrases from your dataset. Fingers and strings are never exact: a note within the accepted error of a scale degree counts as that degree (cents are hundredths of a semitone, so ±30 cents is ±30% of a semitone), and the instrument's overall tuning offset is estimated and removed. Scores are heuristic, not statistical probabilities.`,
            `نافذة متحركة مدتها ${settings.maqam.windowS} ثانية، تُحدّث كل ${settings.maqam.intervalS} ثوانٍ. تشمل الأدلة توافق السلم ونغمات الركوز والأجناس والعبارات من بياناتك. الأصابع والأوتار ليست دقيقة تمامًا: النغمة القريبة من درجة السلم ضمن هامش الخطأ المقبول تُحسب لتلك الدرجة (السنت جزء من مئة من نصف التون، فـ ±٣٠ سنتًا تعني ±٣٠٪ من نصف التون)، ويُقدَّر انحراف ضبط الآلة العام ويُزال. النتائج تقريبية وليست احتمالات إحصائية.`,
          )}
        </p>
      </section>
      {dataset && dataset.maqamat.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>{tr("Maqam explorer", "مستكشف المقامات")}</h2>
            <span className="eyebrow">
              {dataset.maqamat.length} {tr("MAQAMAT", "مقامات")}
            </span>
          </div>
          <div className="explorer-list">
            {dataset.maqamat.map((m) => {
              const scale = catalogue.find((s) => s.maqamId === m.id);
              return (
                <article className="maqam-card" key={m.id}>
                  <div className="eyebrow">
                    {m.family ?? tr("MAQAM", "مقام")}
                  </div>
                  <h3>{m.name[arabic ? "arabic" : "latin"]}</h3>
                  <p className="muted">
                    {m.description ??
                      tr(
                        "Defined in your loaded dataset.",
                        "معرّف في ملف البيانات المحمّل.",
                      )}
                  </p>
                  <div className="reference-notes">
                    {scale?.notes.map((n) => (
                      <span key={n.step}>{n.label.text}</span>
                    ))}
                  </div>
                  <p className="fine-print">
                    {tr("Reference tonic", "القرار المرجعي")}:{" "}
                    {scale?.tonic.text} · {(m.variants?.length ?? 0) + 1}{" "}
                    {tr("illustrated routes", "مسارات موضحة")}
                  </p>
                  <div className="intervals" dir="ltr">
                    {m.ascending.map((d, i) => (
                      <span key={i}>
                        {d.cents}
                        <small>¢</small>
                      </span>
                    ))}
                  </div>
                  <p className="muted small">
                    {m.ajnas
                      .map(
                        (j) =>
                          dataset.ajnas.find((a) => a.id === j.jins)?.name[
                            arabic ? "arabic" : "latin"
                          ] ?? j.jins,
                      )
                      .join(" · ")}
                  </p>
                  <button
                    className="button subtle"
                    onClick={() => onExplore(m.id)}
                  >
                    {tr(
                      "Explore on the fingerboard",
                      "استكشف على لوحة الأصابع",
                    )}{" "}
                    {arabic ? "←" : "→"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
});
