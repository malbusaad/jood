import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Star, Trash2 } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, useApi, useMutation } from "../ui";

interface Photo { id: string; url: string; alt: string | null; isHero: boolean; sizeBytes: number }

/** Shrinks a photo on the device before upload (long side ≤ 1920 px, JPEG), so uploads are fast and small. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 1_400_000) {
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    }
  }
  throw new Error("الصورة كبيرة جدًا");
}

export default function MediaPage() {
  const { data, loading, reload } = useApi<{ items: Photo[] }>("/api/admin/media");
  const { data: settings, reload: reloadSettings } = useApi<{ introVideo: { url: string | null } }>("/api/admin/settings");
  const m = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function upload(files: FileList) {
    setErrors([]);
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      setProgress(`جاري رفع ${i + 1} من ${list.length}…`);
      try {
        const dataUrl = await shrink(list[i]!);
        if (!(await m.run("/api/admin/media", "POST", { data: dataUrl, alt: null }))) setErrors((e) => [...e, `${list[i]!.name}: لم تُرفع`]);
      } catch {
        setErrors((e) => [...e, `${list[i]!.name}: تعذر قراءة الصورة`]);
      }
    }
    setProgress(null);
    reload();
  }

  async function move(i: number, d: -1 | 1) {
    const ids = data!.items.map((p) => p.id);
    const j = i + d;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    if (await m.run("/api/admin/media/order", "PUT", { ids })) reload();
  }

  return (
    <>
      <PageTitle title="الصور والفيديو">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" aria-label="ملفات الصور" onChange={(e) => { const f = e.target.files; if (f?.length) void upload(f); e.target.value = ""; }} />
        <Button busy={Boolean(progress)} onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /> إضافة صور</Button>
      </PageTitle>
      <p className="mb-4 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7">
        اختر صورًا من جوالك أو جهازك، ويمكنك اختيار عدة صور مرة واحدة. تُصغَّر تلقائيًا قبل الرفع لتكون سريعة في الموقع.
        ★ تحدد الصورة الرئيسية التي تظهر أعلى الصفحة الرئيسية، والأسهم تغيّر ترتيبها في المعرض. اكتب وصفًا قصيرًا لكل صورة (مثل «المجلس»).
      </p>
      {progress && <p className="mb-3 text-sm text-jood-green">{progress}</p>}
      <ErrorNote>{m.error}</ErrorNote>
      {errors.length > 0 && <ul className="mb-3 text-sm text-red-800">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      <Card title="الصور">
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty>لا توجد صور بعد.</Empty> : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((p, i) => (
              <li key={p.id} className="overflow-hidden rounded-2xl border border-jood-green/10 bg-white">
                <div className="relative">
                  <img src={p.url} alt={p.alt ?? ""} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  {p.isHero && <span className="absolute start-2 top-2 rounded-full bg-jood-gold px-2 py-0.5 text-xs text-jood-green-950">الرئيسية</span>}
                </div>
                <div className="space-y-2 p-3">
                  <input
                    aria-label={`وصف الصورة ${i + 1}`}
                    defaultValue={p.alt ?? ""}
                    placeholder="وصف قصير، مثل: المجلس"
                    onBlur={async (e) => { const v = e.target.value.trim() || null; if (v !== p.alt) { if (await m.run(`/api/admin/media/${p.id}`, "PATCH", { alt: v })) reload(); } }}
                    className={inputClass}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex">
                      <Button variant="ghost" aria-label={`نقل الصورة ${i + 1} للأمام`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                      <Button variant="ghost" aria-label={`نقل الصورة ${i + 1} للخلف`} disabled={i === data.items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                    </div>
                    <div className="flex">
                      <Button variant="ghost" aria-label={`جعل الصورة ${i + 1} الرئيسية`} disabled={p.isHero} onClick={async () => { if (await m.run(`/api/admin/media/${p.id}`, "PATCH", { isHero: true })) reload(); }}><Star className="size-4" /></Button>
                      <Button variant="ghost" aria-label={`حذف الصورة ${i + 1}`} onClick={async () => { if (confirm("حذف الصورة؟") && (await m.run(`/api/admin/media/${p.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {settings && <VideoCard initial={settings.introVideo?.url ?? null} onSaved={reloadSettings} />}
    </>
  );
}

/** Sends the video file as is, with upload progress (fetch has no progress events). */
function uploadVideo(file: File, onProgress: (pct: number) => void) {
  return new Promise<{ url: string; warning: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api/admin/media/video");
    xhr.setRequestHeader("Content-Type", file.type.startsWith("video/") ? file.type : "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: { error?: string; url?: string; warning?: string | null } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ url: body.url!, warning: body.warning ?? null });
      else reject(new Error(body.error ?? (xhr.status === 413 ? "حجم الفيديو أكبر من 80 ميجابايت" : "تعذر رفع الفيديو")));
    };
    xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع"));
    xhr.send(file);
  });
}

function VideoCard({ initial, onSaved }: { initial: string | null; onSaved: () => void }) {
  const [url, setUrl] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  const { data: current, reload } = useApi<{ video: { url: string; sizeBytes: number } | null }>("/api/admin/media/video");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function pick(file: File) {
    setNote(null);
    if (file.size > 80 * 1024 * 1024) return setNote({ ok: false, text: "حجم الفيديو أكبر من 80 ميجابايت. صدّره بدقة 720p أو 1080p ليصغر حجمه." });
    setPct(0);
    try {
      const r = await uploadVideo(file, setPct);
      setNote(r.warning ? { ok: false, text: `تم الرفع. تنبيه: ${r.warning}` } : { ok: true, text: "تم رفع الفيديو، ويظهر الآن في الموقع." });
      reload();
      onSaved();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "تعذر رفع الفيديو" });
    } finally {
      setPct(null);
    }
  }

  return (
    <Card title="الفيديو التعريفي" className="mt-5">
      <h3 className="font-medium">رفع ملف فيديو مباشرة (بدون YouTube)</h3>
      <p className="mt-1 text-sm leading-7 text-jood-ink/70">
        ملف MP4 حتى 80 ميجابايت (دقيقة إلى دقيقتين بدقة 1080p عادةً). يُعرض داخل الموقع نفسه. الأفضل صيغة MP4 ‏(H.264) ليعمل على كل الأجهزة.
      </p>
      {current?.video && (
        <video className="mt-3 aspect-video w-full max-w-md rounded-xl bg-black" src={current.video.url} controls preload="metadata" playsInline aria-label="الفيديو الحالي" />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" className="hidden" aria-label="ملف الفيديو" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
        <Button variant="secondary" busy={pct !== null} onClick={() => fileRef.current?.click()}>{current?.video ? "استبدال الفيديو" : "رفع فيديو"}</Button>
        {current?.video && (
          <Button variant="ghost" onClick={async () => { if (confirm("حذف الفيديو المرفوع؟") && (await m.run("/api/admin/media/video", "DELETE"))) { reload(); onSaved(); } }}><Trash2 className="size-4" /> حذف</Button>
        )}
      </div>
      {pct !== null && (
        <div className="mt-3" role="progressbar" aria-label="تقدم رفع الفيديو" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 overflow-hidden rounded-full bg-jood-green/10"><div className="h-full bg-jood-green transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-jood-ink/60">جاري الرفع… {pct}% — لا تغلق الصفحة</p>
        </div>
      )}
      {note && <p className={`mt-3 text-sm ${note.ok ? "text-emerald-700" : "text-amber-800"}`}>{note.text}</p>}

      <h3 className="mt-6 border-t border-jood-green/10 pt-4 font-medium">أو رابط YouTube / Vimeo</h3>
      <p className="mt-1 text-sm leading-7 text-jood-ink/70">يُستخدم الرابط فقط إذا لم يُرفع ملف فيديو.</p>
      <Field label="رابط الفيديو" className="mt-2">
        <input dir="ltr" value={url} placeholder="https://youtu.be/…" onChange={(e) => setUrl(e.target.value)} className={`${inputClass} text-end`} />
      </Field>
      <div className="mt-3 flex items-center gap-3">
        <Button busy={m.busy} onClick={async () => { if (await m.run("/api/admin/settings/introVideo", "PUT", { url: url.trim() || null })) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved(); } }}>حفظ الرابط</Button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ</span>}
      </div>
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}
