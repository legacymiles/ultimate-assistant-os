import { NextResponse } from "next/server";
import { fail } from "@/lib/stdsafe/api";
import { resolveCaller } from "@/lib/stdsafe/session";
import { StdSafeError } from "@/lib/stdsafe/store";
import { emptyDraft, parseReport, type ParsedDraft } from "@/lib/stdsafe/parse";
import { aiKey, mergeDrafts, textDraft, visionDraft } from "@/lib/stdsafe/ai";
import { MAX_REPORT_BYTES, extensionFor, isImage, isPdf, saveReport } from "@/lib/stdsafe/reports";

// Upload a report -> get a DRAFT back. Nothing is saved to the record here;
// the user confirms every field on the review screen first. The file itself IS
// stored, because a record claiming "lab document" has to have one behind it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function readPdf(file: File): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return normalize((await parser.getText()).text ?? "");
  } finally {
    await parser.destroy?.();
  }
}

export async function POST(req: Request) {
  try {
    const caller = await resolveCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new StdSafeError("No file was uploaded.", 400);
    if (file.size > MAX_REPORT_BYTES) {
      throw new StdSafeError("That file is over 20MB. Export the report as a PDF and try again.", 413);
    }
    if (!extensionFor(file.name, file.type)) {
      throw new StdSafeError("Upload a PDF, or a photo or screenshot of the report.", 415);
    }

    let draft: ParsedDraft = emptyDraft("manual");
    // Explains itself to the user rather than leaving a thin draft unexplained.
    let note = "";

    if (isPdf(file.name, file.type)) {
      const text = await readPdf(file);
      draft = parseReport(text, "pdf");
      // A PDF with no text layer is a scan. Nothing to read, so say so.
      if (!text.trim()) {
        note = "That PDF has no text in it — it is a scan. Fill the results in below.";
      } else if (draft.results.length < 2 && aiKey()) {
        // Thin read on a report that clearly had text: worth one model call.
        draft = mergeDrafts(draft, await textDraft(text));
      } else if (draft.results.length === 0) {
        note = "The layout of this report was not recognised. Fill the results in below.";
      }
    } else if (isImage(file.name, file.type)) {
      const fromVision = await visionDraft(file);
      if (fromVision) {
        draft = fromVision;
      } else {
        note = aiKey()
          ? "The image could not be read. Fill the results in below."
          : "Reading a photo needs an AI key (AI_GATEWAY_API_KEY), and none is set. " +
            "The image is saved as your document — fill the results in below.";
      }
    }

    // Saved regardless of how well it parsed: the file is the evidence behind
    // the "lab document" tier, and a failed parse does not weaken it.
    const fileId = await saveReport(caller.userId, file);

    return NextResponse.json({
      ok: true,
      draft,
      note,
      fileId,
      fileName: file.name,
      // A file we could not store must not become a "lab document" record.
      verification: fileId ? "document" : "self",
      storageWarning: fileId ? "" : "The report file could not be saved on this host.",
    });
  } catch (err) {
    return fail(err);
  }
}
