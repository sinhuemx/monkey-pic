
import { Router, Status } from "../deps.ts";
import { imageToStl, imageToStlBinary } from "../services/stl.service.ts";
import { saveStlData } from "../services/firebase.service.ts";

const stlRouter = new Router();

stlRouter.post("/convert", async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "form-data" }).value.read();
    const file = body.files?.[0];
    // Usar el nombre original del archivo, compatible con distintos parsers
  const originalName = file?.originalName || file?.filename;
    if (!file || !file.filename || !originalName) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { error: "No image file provided or file is invalid" };
      return;
    }
  const contentType = ("contentType" in file ? (file as unknown as { contentType?: string }).contentType : undefined);
    console.log("[stl] Upload received:", { originalName, contentType, tmpPath: file.filename });
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/svg+xml"];
    if (contentType && !allowed.includes(contentType.toLowerCase())) {
      ctx.response.status = Status.UnsupportedMediaType;
      ctx.response.body = { error: `Unsupported image type: ${contentType}. Allowed: ${allowed.join(", ")}.` };
      return;
    }

    // Utilidad para manejar respuestas de error
    const respondError = (status: number, message: string) => {
      ctx.response.status = status;
      ctx.response.body = { error: message };
    };

    let buf: Uint8Array;
    try {
      // Prefer in-memory content if provided by oak (optional)
      const anyFile = file as unknown as { content?: Uint8Array };
      if (anyFile.content && anyFile.content.length) {
        buf = anyFile.content;
      } else {
        buf = await Deno.readFile(file.filename);
      }
    } catch (err) {
      console.error("[stl] Read file failed:", err);
      respondError(Status.InternalServerError, "Could not read uploaded file");
      return;
    }


  let stl: string | Uint8Array;
    // Defaults that can be overridden by form fields
    const defaults = {
      widthMM: 120,
      baseMM: 1.2,
      maxHeightMM: 3.0,
      invert: true,
      sampleMax: undefined as number | undefined,
    };
    // Extract optional fields from form data
    const fields = body.fields ?? {} as Record<string, string>;
    const num = (v: string | undefined, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const bool = (v: string | undefined, fallback: boolean) => {
      if (v === undefined) return fallback;
      const s = String(v).toLowerCase();
      return s === "true" || s === "1" || s === "yes";
    };
  const opts = {
      widthMM: num(fields.widthMM, 10, 600, defaults.widthMM),
      baseMM: num(fields.baseMM, 0, 10, defaults.baseMM),
      maxHeightMM: num(fields.maxHeightMM, 0.2, 50, defaults.maxHeightMM),
      invert: bool(fields.invert, defaults.invert),
      sampleMax: fields.sampleMax ? num(fields.sampleMax, 50, 800, 300) : undefined,
      // Enhanced volume and texture options
      depthMultiplier: num(fields.depthMultiplier, 0.5, 3.0, 1.3),
      edgeSharpening: num(fields.edgeSharpening, 0, 1, 0.3),
      detailPreservation: num(fields.detailPreservation, 0, 1, 0.4),
      surfaceSmoothing: num(fields.surfaceSmoothing, 0, 0.5, 0.15),
      microTexture: bool(fields.microTexture, true),
      organicShaping: bool(fields.organicShaping, true),
    } as const;
  const wantBinary = String((fields as Record<string,string>).format || "").toLowerCase() === "binary";
    try {
      if (contentType?.toLowerCase() === "image/svg+xml") {
        // Backend no rasteriza SVG (lo hace el frontend). Mensaje útil si llega aquí.
        throw new Error("SVG recibido. Por favor rasteriza a PNG en el cliente.");
      }
      if (wantBinary) {
        const res = await imageToStlBinary(buf, { ...opts });
        stl = res.data;
      } else {
        stl = await imageToStl(buf, { ...opts });
      }
    } catch (err) {
      console.error("[stl] Conversion failed:", err);
      respondError(Status.InternalServerError, "Error converting image to STL (use PNG/JPEG)");
      return;
    }


  // Token de autorización (opcional para adjuntar uid)
  const idToken = ctx.request.headers.get("authorization")?.replace("Bearer ", "");
    try {
  const triangles = (typeof stl === "string") ? (stl.match(/\n\s*facet normal/g) || []).length : undefined;
  const sampleMax = opts.sampleMax ?? Number(Deno.env.get("STL_MAX_SAMPLES") ?? 180);
  await saveStlData({
        filename: originalName,
        createdAt: new Date(),
        contentType,
        widthMM: opts.widthMM,
        baseMM: opts.baseMM,
        maxHeightMM: opts.maxHeightMM,
        invert: opts.invert,
        triangles,
        sampleMax,
  }, idToken ?? "");
    } catch (e) {
      console.error("[stl] Firestore save failed:", e);
      // Do not fail the STL generation if metadata save fails
    }

  ctx.response.headers.set("Content-Type", "model/stl");
  const base = (originalName.replace(/\.[^/.]+$/, "") || "monkeypic");
  const encoded = encodeURIComponent(`${base}.stl`);
  // ASCII-safe fallback filename (avoid non-ASCII causing ByteString error)
  let fallback = `${base}.stl`.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!fallback || /[^A-Za-z0-9]/.test(fallback) && fallback.replace(/_/g, "").length === 0) {
    fallback = "model.stl";
  }
  // Use ASCII-safe fallback + RFC 5987 extended filename parameter
  ctx.response.headers.set(
    "Content-Disposition",
    `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
  );
  ctx.response.body = stl;
  } catch (e) {
    console.error("[stl] Unexpected error:", e);
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { error: "Unexpected server error" };
  }
});

export default stlRouter;
