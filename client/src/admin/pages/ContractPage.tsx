import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Download, Printer, Share2 } from "lucide-react";
import type { Contract, ContractBlock } from "../types";
import { Button, ErrorNote, Loading, useApi } from "../ui";

/**
 * The contract document uses its own plain hex colours (see CONTRACT_CSS), not Tailwind colour
 * utilities: the PDF renderer (html2canvas) cannot parse the modern colour functions Tailwind 4 emits.
 */
const CONTRACT_CSS = `
.jc { color: #1d2422; background: #ffffff; font-family: "IBM Plex Sans Arabic", sans-serif; font-size: 13px; line-height: 1.9; }
.jc h1 { font-family: "El Messiri", serif; color: #183b32; font-size: 22px; font-weight: 600; text-align: center; margin: 0 0 16px; }
.jc h2 { font-family: "El Messiri", serif; color: #183b32; font-size: 16px; font-weight: 600; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #c4a46b; }
.jc p { margin: 6px 0; }
.jc .list { margin: 6px 0; }
.jc .li { display: flex; gap: 8px; margin: 3px 0; }
.jc .n { flex: none; min-width: 18px; color: #183b32; font-weight: 500; }
.jc table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
.jc th, .jc td { border: 1px solid #c9d1ce; padding: 6px 10px; text-align: start; vertical-align: top; }
.jc th { background: #f5f0e6; font-weight: 500; }
.jc .kv th { width: 33%; }
.jc .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #c9d1ce; text-align: center; font-size: 11px; color: #6b736f; }
`;

function Block({ block }: { block: ContractBlock }) {
  switch (block.type) {
    case "title":
      return <h1>{block.text}</h1>;
    case "heading":
      return <h2>{block.text}</h2>;
    case "paragraph":
      return <p>{block.text}</p>;
    // Markers are written as text: html2canvas places native list markers on the wrong side in RTL.
    case "ordered":
      return (
        <div className="list" role="list">
          {block.items.map((t, i) => (
            <div key={i} className="li" role="listitem"><span className="n">{block.start + i}.</span><span>{t}</span></div>
          ))}
        </div>
      );
    case "bullets":
      return (
        <div className="list" role="list">
          {block.items.map((t, i) => (
            <div key={i} className="li" role="listitem"><span className="n">•</span><span>{t}</span></div>
          ))}
        </div>
      );
    case "table":
      return (
        <table className="kv">
          <tbody>
            {block.rows.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      );
    case "prices":
      return (
        <table>
          <thead><tr><th>اليوم</th><th>البند</th><th>السعر</th></tr></thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i}><td>{r.date}</td><td>{r.item}</td><td>{r.price}</td></tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/** The filled contract as a printable A4 page, with PDF download and (on phones) sharing to WhatsApp. */
export default function ContractPage() {
  const { id } = useParams();
  const { data: c, error, loading } = useApi<Contract>(`/api/admin/bookings/${id}/contract`);
  const pageRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"pdf" | "share" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function makePdf(): Promise<Blob> {
    // Rendered by the browser, so Arabic letters join and lines run right-to-left correctly.
    const { default: html2pdf } = await import("html2pdf.js");
    const worker = html2pdf();
    type Options = Parameters<typeof worker.set>[0] & { pagebreak?: { mode?: string[]; avoid?: string[] } };
    const options: Options = {
      margin: [12, 12, 14, 12],
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      // Supported at runtime (keeps table rows and list items from splitting across pages); missing from the bundled types.
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".li", "h2"] },
    };
    return worker
      .set(options)
      .from(pageRef.current!)
      .outputPdf("blob");
  }

  const fileName = c ? `Jood-contract-${c.reference}.pdf` : "Jood-contract.pdf";

  async function download() {
    setBusy("pdf");
    setPdfError(null);
    try {
      const blob = await makePdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("[pdf]", err);
      setPdfError("تعذر إنشاء ملف PDF. استخدم «طباعة» ثم «حفظ كـ PDF».");
    } finally {
      setBusy(null);
    }
  }

  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  async function share() {
    setBusy("share");
    setPdfError(null);
    try {
      const file = new File([await makePdf()], fileName, { type: "application/pdf" });
      if (!navigator.canShare?.({ files: [file] })) throw new Error("unsupported");
      await navigator.share({ files: [file], title: fileName });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setPdfError("المشاركة غير مدعومة في هذا المتصفح. نزّل الملف وأرسله يدويًا.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !c) return <Loading />;
  if (!c) return <div className="p-6"><ErrorNote>{error ?? "تعذر تحميل العقد"}</ErrorNote></div>;

  return (
    <div className="min-h-dvh bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link to={`/admin/bookings/${id}`} className="inline-flex items-center gap-1 text-sm text-jood-green">
          <ArrowRight aria-hidden className="size-4" /> العودة إلى الحجز
        </Link>
        <div className="flex flex-wrap gap-2">
          {canShareFiles && (
            <Button busy={busy === "share"} onClick={share}>
              <Share2 aria-hidden className="size-4" /> مشاركة (واتساب)
            </Button>
          )}
          <Button variant={canShareFiles ? "secondary" : "primary"} busy={busy === "pdf"} onClick={download}>
            <Download aria-hidden className="size-4" /> تنزيل PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" /> طباعة
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-[210mm] space-y-2 px-4 print:hidden">
        {c.warnings.map((w) => (
          <p key={w} className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">تنبيه: {w}</p>
        ))}
        <ErrorNote>{pdfError}</ErrorNote>
      </div>

      <div className="mx-auto mt-4 max-w-[210mm] bg-white shadow-lg print:mt-0 print:shadow-none">
        <style>{CONTRACT_CSS}</style>
        <div ref={pageRef} dir="rtl" lang="ar" className="jc" style={{ padding: "12mm 14mm" }}>
          {c.blocks.map((b, i) => <Block key={i} block={b} />)}
          <p className="foot">استراحة الجود — العزيزية، الخبر · رقم الحجز {c.reference}</p>
        </div>
      </div>
    </div>
  );
}
