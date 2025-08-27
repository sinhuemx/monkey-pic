import { Router } from "../deps.ts";
import { Volumetric3DService } from "../services/volumetric3d.service.ts";

const router = new Router();
const volumetric3DService = new Volumetric3DService();

// Ruta específica SOLO para modelos 3D volumétricos (completamente independiente del relieve)
router.post("/volumetric3d", async (ctx) => {
  try {
    console.log("🧊 Volumetric 3D Model generation endpoint called");
    
    const body = ctx.request.body();
    if (body.type !== "form-data") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request must be form-data" };
      return;
    }

    const formData = await body.value.read({ maxSize: 50_000_000 });
    const imageFile = formData.files?.[0];
    
    if (!imageFile || !imageFile.content) {
      ctx.response.status = 400;
      ctx.response.body = { error: "No image file provided" };
      return;
    }

    // Parámetros específicos para VOLUMETRIC 3D (no heightfield)
    const widthMM = parseFloat(formData.fields.widthMM as string) || 80;
    const depthMM = parseFloat(formData.fields.depthMM as string) || 60; // Profundidad real del objeto
    const heightMM = parseFloat(formData.fields.heightMM as string) || 50; // Altura real del objeto
    const resolutionLevel = parseInt(formData.fields.resolutionLevel as string) || 64; // Resolución voxel
    const smoothingIterations = parseInt(formData.fields.smoothingIterations as string) || 5;
    const volumeThreshold = parseFloat(formData.fields.volumeThreshold as string) || 0.3;
    
    console.log("🧊 Volumetric 3D Parameters:", { 
      widthMM, depthMM, heightMM, resolutionLevel, smoothingIterations, volumeThreshold
    });

    // Usar el nuevo servicio volumétrico
    const result = await volumetric3DService.generateVolumetricModel(imageFile.content, {
      widthMM,
      depthMM,
      heightMM,
      resolutionLevel,
      smoothingIterations,
      volumeThreshold
    });

    if (result.error) {
      console.error("🧊 Volumetric 3D generation failed:", result.error);
      ctx.response.status = 500;
      ctx.response.body = { 
        error: result.error,
        stdout: result.stdout,
        stderr: result.stderr
      };
      return;
    }

    if (result.obj) {
      ctx.response.headers.set("Content-Type", "model/obj");
      ctx.response.body = result.obj;
      console.log("🧊 Volumetric 3D model generated successfully");
    } else {
      ctx.response.status = 500;
      ctx.response.body = { error: "No 3D model generated" };
    }

  } catch (error) {
    console.error("🧊 Volumetric 3D endpoint error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: String(error) };
  }
});

export default router;
