import { Router } from "../deps.ts";
import { StlService } from "../services/stl.service.ts";

const router = new Router();
const stlService = new StlService();

// Ruta específica para generar modelos 3D completos (independiente del relieve)
router.post("/model3d", async (ctx) => {
  try {
    console.log("🎯 3D Model generation endpoint called");
    
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

    // Extraer parámetros detallados específicos para modelos 3D
    const widthMM = parseFloat(formData.fields.widthMM as string) || 80;
    const baseMM = parseFloat(formData.fields.baseMM as string) || 2;
    const maxHeightMM = parseFloat(formData.fields.maxHeightMM as string) || 5;
    const targetFaces = parseInt(formData.fields.targetFaces as string) || 200000;
    const depthMultiplier = parseFloat(formData.fields.depthMultiplier as string) || 2.5;
    const surfaceSmoothing = parseFloat(formData.fields.surfaceSmoothing as string) || 1.0;
    const qualityThreshold = parseFloat(formData.fields.qualityThreshold as string) || 0.75;
    const smoothingKernel = parseInt(formData.fields.smoothingKernel as string) || 3;
    const subdivisionLevel = parseInt(formData.fields.subdivisionLevel as string) || 0;
    const invert = (formData.fields.invert as string) === "true";
    const manifold = (formData.fields.manifold as string) === "true";
    const format = (formData.fields.format as string) || "obj"; // Nuevo: formato solicitado

    console.log("🎯 Detailed 3D Model Parameters:", { 
      widthMM, baseMM, maxHeightMM, targetFaces, depthMultiplier, 
      surfaceSmoothing, qualityThreshold, smoothingKernel, subdivisionLevel, invert, manifold, format 
    });

    // Usar contenido de la imagen directamente del archivo subido
    const imageContent = imageFile.content;

    // Usar la nueva función específica para modelos 3D con parámetros detallados
    const result = await stlService.generate3DModel(imageContent, {
      widthMM,
      baseMM,
      maxHeightMM,
      targetFaces,
      depthMultiplier,
      surfaceSmoothing,
      qualityThreshold,
      smoothingKernel,
      subdivisionLevel,
      invert,
      manifold,
      format: format === 'stl' ? 'ascii' : undefined // Pasar el formato al servicio STL
    });

    if (result.error) {
      ctx.response.status = 500;
      ctx.response.body = { 
        error: result.error,
        stdout: result.stdout,
        stderr: result.stderr
      };
      return;
    }

    // Devolver en el formato solicitado
    if (format === "stl" && result.stl) {
      // Devolver STL como blob para descarga
      ctx.response.headers.set("Content-Type", "application/octet-stream");
      ctx.response.headers.set("Content-Disposition", `attachment; filename="modelo-3d.stl"`);
      ctx.response.body = result.stl;
    } else {
      // Devolver JSON con OBJ (comportamiento por defecto)
      ctx.response.body = {
        obj: result.obj,
        message: "3D model generated successfully",
        debug: {
          stdout: result.stdout,
          stderr: result.stderr
        }
      };
    }
    
  } catch (error) {
    console.error("Error in 3D model generation:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : String(error) };
  }
});

export default router;
