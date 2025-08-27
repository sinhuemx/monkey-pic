import { Router } from "../deps.ts";
import { StlService } from "../services/stl.service.ts";
import type { RouterContext } from "https://deno.land/x/oak@v12.6.0/mod.ts";

const router = new Router();
const stlService = new StlService(); // Instantiate the service

router.post("/hq", async (ctx: RouterContext<"/hq">) => {
  console.log("HQ endpoint hit");
  const body = ctx.request.body();
  if (body.type !== "form-data") {
    ctx.response.status = 400;
    ctx.response.body = { error: "Request must be form-data" };
    return;
  }

  const formData = await body.value.read({ maxSize: 50_000_000 });
  const file = (formData.files?.find((f: Record<string, unknown>) => f.name === "file") ?? formData.files?.[0]) as Record<string, unknown> | undefined;
  
  console.log("Form data received:", {
    hasFile: !!file,
    fileName: file?.filename,
    fileContentType: file?.contentType,
    fields: Object.keys(formData.fields || {}),
    optionsValue: formData.fields.options,
    targetTris: formData.fields.targetTris,
    widthMM: formData.fields.widthMM,
    filesCount: formData.files?.length || 0
  });

  if (!file) {
    ctx.response.status = 400;
    ctx.response.body = { error: "No file uploaded" };
    return;
  }

  // Try to read file content from multiple possible fields provided by oak
  async function readUploadedFile(f: Record<string, unknown>): Promise<Uint8Array | null> {
    const c = f["content"] as Uint8Array | undefined;
    if (c && c.byteLength) return c;
    const candidates = ["filename", "filepath", "tempfile", "path"] as const;
    for (const k of candidates) {
      const p = f[k] as string | undefined;
      if (p) {
        try { return await Deno.readFile(p); } catch { /* ignore */ }
      }
    }
    return null;
  }

  const fileContent = await readUploadedFile(file);
  if (!fileContent) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Could not read file content" };
    return;
  }
  
  // Make options optional with default values
  let options = {};
  try {
    options = JSON.parse(formData.fields.options || "{}");
  } catch (e) {
    console.warn("Invalid options JSON, using defaults:", e);
    options = {};
  }
  
  // Set default values if not provided, también lee parámetros individuales del formulario
  const finalOptions = {
    widthMM: formData.fields.widthMM ? parseFloat(formData.fields.widthMM) : 100,
    baseMM: formData.fields.baseMM ? parseFloat(formData.fields.baseMM) : 1,
    maxHeightMM: formData.fields.maxHeightMM ? parseFloat(formData.fields.maxHeightMM) : 10,
    invert: formData.fields.invert === 'true',
    targetTris: formData.fields.targetTris ? parseInt(formData.fields.targetTris) : 350000,
    ...options // Los valores del JSON tienen prioridad
  };

  console.log("Final options for HQ model generation:", finalOptions);

  // Call the new method with the file content we extracted
  const result = await stlService.generateHqModel(fileContent, finalOptions);
  if (result.error) {
    ctx.response.status = 500;
    ctx.response.body = result;
  } else {
    // Return OBJ content as text, not JSON
    ctx.response.headers.set("Content-Type", "text/plain");
    ctx.response.body = result.obj;
  }
});

export default router;