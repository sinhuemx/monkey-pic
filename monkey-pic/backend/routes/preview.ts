import { Router } from "../deps.ts";
import { Status } from "https://deno.land/std@0.177.0/http/http_status.ts";

const router = new Router();

router.post("/generate-preview", async (ctx) => {
  const body = ctx.request.body();
  if (body.type !== "form-data") {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { error: "Request must be form-data" };
    return;
  }

  const formData = await body.value.read({ maxSize: 50_000_000 });
  const file = (formData.files?.find((f) => f.name === "file") ?? formData.files?.[0]) as Record<string, unknown> | undefined;

  if (!file) {
    ctx.response.status = Status.BadRequest;
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

  const content = await readUploadedFile(file);
  if (!content) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { error: "No file data available" };
    return;
  }

  const tempDir = await Deno.makeTempDir({ prefix: "monkey-pic-preview-" });
  const inputPath = `${tempDir}/input.png`;
  await Deno.writeFile(inputPath, content);

  const outputPath = `${tempDir}/output`;
  await Deno.mkdir(outputPath, { recursive: true });

  // Resolve paths relative to this file's location to avoid CWD issues
  const baseDir = new URL("../../", import.meta.url).pathname; // points to repo subfolder 'monkey-pic/'
  const pythonExe = `${baseDir}scripts/ai3d/.venv/bin/python`;
  const runnerScript = `${baseDir}scripts/ai3d/triposr/run.py`;

  const command = new Deno.Command(
    pythonExe,
    {
      args: [
        runnerScript,
        inputPath,
        "--output-dir",
        outputPath,
        "--model-save-format",
        "obj",
      ],
      cwd: baseDir,
    },
  );

  const { code, stdout: _stdout, stderr } = await command.output();

  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { error: "Failed to generate 3D model." };
    await Deno.remove(tempDir, { recursive: true });
    return;
  }

  try {
    // TripoSR saves the output in a subdirectory named '0'
    const modelPath = `${outputPath}/0/mesh.obj`;
    const modelData = await Deno.readFile(modelPath);
    ctx.response.status = Status.OK;
    ctx.response.headers.set("Content-Type", "text/plain"); // OBJ is plain text
    ctx.response.body = modelData;
  } catch (error) {
    console.error(error);
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { error: "Failed to read generated model file." };
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

export default router;
