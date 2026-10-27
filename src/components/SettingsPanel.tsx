import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { Device, Settings } from "../lib/types";
export function SettingsPanel({
  settings,
  devices,
  busy,
  onSave,
  onRefresh,
}: {
  settings: Settings;
  devices: Device[];
  busy: boolean;
  onSave: (s: Settings) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const ar = settings.language === "ar";
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="panel">
        <div className="section-heading">
          <h2>{ar ? "الصوت والآلة" : "Sound & instrument"}</h2>
          <span className="eyebrow">01</span>
        </div>
        <div className="fields">
          <label className="field">
            {ar ? "مصدر الصوت" : "Audio input"}
            <select
              value={draft.inputDeviceId ?? ""}
              onChange={(e) => set("inputDeviceId", e.target.value || null)}
            >
              <option value="">
                {ar ? "الجهاز الافتراضي" : "System default"}
              </option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button subtle" onClick={onRefresh}>
            {ar ? "تحديث الأجهزة" : "Refresh devices"}
          </button>
          <label className="field">
            {ar ? "تردد لا٤ المرجعي" : "La4 reference · Hz"}
            <NumberField
              dir="ltr"
              min="380"
              max="480"
              step="0.1"
              value={draft.referenceHz}
              onValueChange={(value) => set("referenceHz", value)}
            />
          </label>
          <label className="field">
            {ar ? "النقل" : "Instrument transposition"}
            <div className="inline">
              <NumberField
                aria-label={ar ? "مقدار النقل" : "Transposition amount"}
                dir="ltr"
                step="0.5"
                value={draft.transposition.amount}
                onValueChange={(value) =>
                  set("transposition", {
                    ...draft.transposition,
                    amount: value,
                  })
                }
              />
              <select
                aria-label={ar ? "وحدة النقل" : "Transposition unit"}
                value={draft.transposition.unit}
                onChange={(e) =>
                  set("transposition", {
                    ...draft.transposition,
                    unit: e.target.value as Settings["transposition"]["unit"],
                  })
                }
              >
                <option value="semitone">
                  {ar ? "نصف نغمة" : "Semitones"}
                </option>
                <option value="wholeTone">{ar ? "نغمة" : "Whole tones"}</option>
                <option value="quarterTone">
                  {ar ? "ربع نغمة" : "Quarter tones"}
                </option>
                <option value="cent">{ar ? "سنت" : "Cents"}</option>
              </select>
            </div>
          </label>
          <label className="field">
            {ar ? "نظام الدوزان" : "Naming grid"}
            <select
              value={draft.tuning}
              onChange={(e) =>
                set("tuning", e.target.value as Settings["tuning"])
              }
            >
              <option value="edo24">
                24-EDO · {ar ? "أرباع النغمات" : "quarter tones"}
              </option>
              <option value="edo12">12-EDO</option>
            </select>
          </label>
          <label className="field">
            {ar ? "بوابة الصمت" : "Silence gate · dBFS"}
            <NumberField
              dir="ltr"
              min="-90"
              max="-20"
              value={draft.silenceThresholdDb}
              onValueChange={(value) => set("silenceThresholdDb", value)}
            />
          </label>
          <label className="field">
            {ar ? "الحد الأدنى للثقة" : "Minimum periodicity confidence"}
            <NumberField
              dir="ltr"
              min="0.5"
              max="0.99"
              step="0.01"
              value={draft.minConfidence}
              onValueChange={(value) => set("minConfidence", value)}
            />
          </label>
          <label className="field">
            {ar ? "طول الوتر المهتز · مم" : "Vibrating string length · mm"}
            <NumberField
              dir="ltr"
              min="400"
              max="800"
              step="0.1"
              value={draft.scaleLengthMm}
              onValueChange={(value) => set("scaleLengthMm", value)}
            />
          </label>
          <label className="field">
            {ar
              ? "طول لوحة الأصابع من العتبة · مم"
              : "Fingerboard nut-to-end length · mm"}
            <NumberField
              dir="ltr"
              min="1"
              max={draft.scaleLengthMm - 1}
              step="0.1"
              value={draft.fingerboardLengthMm}
              onValueChange={(value) => set("fingerboardLengthMm", value)}
            />
          </label>
          <label className="field">
            {ar ? "تصحيح الموضع · مم" : "Stopped-position correction · mm"}
            <NumberField
              dir="ltr"
              min="-20"
              max="20"
              step="0.1"
              value={draft.positionOffsetMm}
              onValueChange={(value) => set("positionOffsetMm", value)}
            />
          </label>
        </div>
        <p className="muted">
          {ar
            ? "الملف التجريبي: دو٢ · فا٢ · لا٢ · ري٣ · صول٣ · دو٤. أبعاد نظرية، وليست معايرة لآلتك."
            : "Example six-course profile: Do2 · Fa2 · La2 · Re3 · Sol3 · Do4. Geometry is theoretical until calibrated to your instrument."}
        </p>
      </div>
      <div className="panel">
        <div className="section-heading">
          <h2>{ar ? "العرض واللغة" : "Display & language"}</h2>
          <span className="eyebrow">02</span>
        </div>
        <div className="fields">
          <label className="field">
            {ar ? "لغة الواجهة" : "Interface language"}
            <select
              value={draft.language}
              onChange={(e) =>
                set("language", e.target.value as Settings["language"])
              }
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <label className="field">
            {ar ? "كتابة النغمات" : "Note script"}
            <select
              value={draft.noteScript}
              onChange={(e) =>
                set("noteScript", e.target.value as Settings["noteScript"])
              }
            >
              <option value="latin">Do Re Mi</option>
              <option value="arabic">دو ري مي</option>
            </select>
          </label>
          <label className="field">
            {ar ? "تمثيل النغمة" : "Pitch identity"}
            <select
              value={draft.noteView}
              onChange={(e) =>
                set("noteView", e.target.value as Settings["noteView"])
              }
            >
              <option value="player">
                {ar ? "أسماء العازف" : "Player notation"}
              </option>
              <option value="concert">
                {ar ? "الصوت الحقيقي" : "Concert pitch"}
              </option>
            </select>
          </label>
          <label className="field">
            {ar ? "علامات التحويل" : "Accidentals"}
            <select
              value={draft.accidentalStyle}
              onChange={(e) =>
                set(
                  "accidentalStyle",
                  e.target.value as Settings["accidentalStyle"],
                )
              }
            >
              <option value="symbol">{ar ? "رموز" : "Symbols"}</option>
              <option value="words">{ar ? "كلمات" : "Words"}</option>
            </select>
          </label>
          <label className="field">
            {ar ? "الحركة" : "Animation"}
            <select
              value={draft.visuals}
              onChange={(e) =>
                set("visuals", e.target.value as Settings["visuals"])
              }
            >
              <option value="full">{ar ? "كاملة" : "Full"}</option>
              <option value="reduced">{ar ? "مخففة" : "Reduced"}</option>
              <option value="off">{ar ? "متوقفة" : "Off"}</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.zand.animated}
              onChange={(e) =>
                set("zand", { ...draft.zand, animated: e.target.checked })
              }
            />
            {ar
              ? "زند العود المتحرك (بدلاً من الخريطة البسيطة)"
              : "Animated oud neck (zand) instead of the plain map"}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.arabicDigits}
              onChange={(e) => set("arabicDigits", e.target.checked)}
            />
            {ar ? "أرقام عربية للأوكتاف" : "Arabic-Indic octave digits"}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.showDiagnostics}
              onChange={(e) => set("showDiagnostics", e.target.checked)}
            />
            {ar ? "إظهار التشخيص" : "Show diagnostics"}
          </label>
        </div>
      </div>
      <div className="save-bar">
        <span className="muted">
          {ar
            ? "حفظ محلي. تعاد جلسة الصوت عند تغيير الإعدادات."
            : "Saved on this device. Applying settings restarts a running audio session."}
        </span>
        <button className="button primary" disabled={busy}>
          {ar ? "حفظ الإعدادات" : "Apply settings"}
        </button>
      </div>
    </form>
  );
}

/** Keep partial input such as a leading minus intact while editing. */
function NumberField({
  value,
  onValueChange,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & { value: number; onValueChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <input
      {...props}
      type="number"
      required
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(e) => {
        focused.current = false;
        if (e.currentTarget.validity.valid) setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
          onValueChange(e.target.valueAsNumber);
      }}
    />
  );
}
