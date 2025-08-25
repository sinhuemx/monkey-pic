import { Router, Status } from "../deps.ts";
import { imageToStl } from "../services/stl.service.ts";

const hqRouter = new Router();

// POST /api/convert-hq: High-quality 3D conversion via Python pipeline (MiDaS/Open3D)
hqRouter.post("/convert-hq", async (ctx) => {
  try {
    const body = await ctx.request.body({ type: "form-data" }).value.read();
    const file = body.files?.[0];
    const originalName = file?.originalName || file?.filename;
    if (!file || !file.filename || !originalName) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { error: "No image file provided or file is invalid" };
      return;
    }

    const contentType = ("contentType" in file ? (file as unknown as { contentType?: string }).contentType : undefined);
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/gif"]; // MiDaS pipeline expects raster
    if (contentType && !allowed.includes(contentType.toLowerCase())) {
      ctx.response.status = Status.UnsupportedMediaType;
      ctx.response.body = { error: `Unsupported image type: ${contentType}. Allowed: ${allowed.join(", ")}.` };
      return;
    }

    // Options
    const fields = body.fields ?? {} as Record<string, string>;
    const num = (v: string | undefined, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const widthMM = num(fields.widthMM, 10, 600, 120);
    const baseMM = num(fields.baseMM, 0, 10, 1.0);
    const maxHeightMM = num(fields.maxHeightMM, 0.2, 50, 5.0);
    const format = (fields.format || "stl").toLowerCase(); // "stl" | "glb" | "obj"

    // Python configuration
    const PYTHON_HQ_ENABLED = (Deno.env.get("PYTHON_HQ_ENABLED") || "").toLowerCase() === "true";
    const PYTHON_CMD = Deno.env.get("PYTHON_CMD") || "python3";
    const SCRIPT_PATH = Deno.env.get("PYTHON_HQ_SCRIPT") || new URL("../../scripts/ai3d/estimate_and_mesh.py", import.meta.url).pathname;

    if (!PYTHON_HQ_ENABLED) {
      // Fallback: use enhanced STL generator so HQ always succeeds with STL
      try {
        const anyFile = file as unknown as { content?: Uint8Array };
        const buf = anyFile.content && anyFile.content.length ? anyFile.content : await Deno.readFile(file.filename);
        const stl = await imageToStl(buf, { widthMM, baseMM, maxHeightMM, invert: false });
        const base = (originalName.replace(/\.[^/.]+$/, "") || "model");
        const encoded = encodeURIComponent(`${base}.stl`);
        let fallback = `${base}.stl`.replace(/[^A-Za-z0-9._-]/g, "_");
        if (!fallback) fallback = "model.stl";
        ctx.response.headers.set("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
        ctx.response.headers.set("Content-Type", "model/stl");
        ctx.response.headers.set("X-HQ-Fallback", "enhanced-stl");
        ctx.response.body = stl;
        return;
      } catch (e) {
        console.error("[hq] fallback failed", e);
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { error: "HQ fallback failed" };
        return;
      }
    }

    // Prepare temp paths
    const tmpDir = await Deno.makeTempDir({ prefix: "hq3d-" });
    const inPath = `${tmpDir}/input` + (contentType?.includes("png") ? ".png" : ".jpg");
    const outPath = `${tmpDir}/output.${format === "glb" ? "glb" : format === "obj" ? "obj" : "stl"}`;
    try {
      // Read file contents
      const anyFile = file as unknown as { content?: Uint8Array };
      const buf = anyFile.content && anyFile.content.length ? anyFile.content : await Deno.readFile(file.filename);
      await Deno.writeFile(inPath, buf);
    } catch (e) {
      console.error("[hq] write temp failed", e);
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { error: "Could not stage uploaded file for HQ pipeline" };
      return;
    }

    // Call Python script
    const p = new Deno.Command(PYTHON_CMD, {
      args: [SCRIPT_PATH, "--input", inPath, "--output", outPath, "--widthMM", String(widthMM), "--baseMM", String(baseMM), "--maxHeightMM", String(maxHeightMM), "--format", format],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await p.output();
    const outTxt = new TextDecoder().decode(stdout);
    const errTxt = new TextDecoder().decode(stderr);
    if (code !== 0) {
      console.error("[hq] python failed:", { code, out: outTxt, err: errTxt });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { error: "HQ conversion failed in Python stage", details: errTxt.slice(0, 500) };
      return;
    }

    // Respond with file
    try {
      const out = await Deno.readFile(outPath);
      const base = (originalName.replace(/\.[^/.]+$/, "") || "model");
      const encoded = encodeURIComponent(`${base}.${format}`);
      let fallback = `${base}.${format}`.replace(/[^A-Za-z0-9._-]/g, "_");
      if (!fallback) fallback = `model.${format}`;
      ctx.response.headers.set("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      if (format === "glb") ctx.response.headers.set("Content-Type", "model/gltf-binary");
      else if (format === "obj") ctx.response.headers.set("Content-Type", "model/obj");
      else ctx.response.headers.set("Content-Type", "model/stl");
      ctx.response.body = out;
    } catch (e) {
      console.error("[hq] read output failed", e);
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { error: "HQ pipeline produced no output file" };
    } finally {
      try { await Deno.remove(tmpDir, { recursive: true }); } catch { /* ignore cleanup error */ }
    }
  } catch (e) {
    console.error("[hq] Unexpected error:", e);
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { error: "Unexpected server error" };
  }
});

export default hqRouter;
