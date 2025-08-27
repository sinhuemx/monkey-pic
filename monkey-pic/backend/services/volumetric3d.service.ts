// Servicio especializado para generación de modelos 3D volumétricos reales
// Completamente independiente del sistema de relieves

interface VolumetricOptions {
  widthMM: number;
  depthMM: number;
  heightMM: number;
  resolutionLevel: number;
  smoothingIterations: number;
  volumeThreshold: number;
}

export class Volumetric3DService {
  
  async generateVolumetricModel(
    imageContent: Uint8Array, 
    options: VolumetricOptions
  ): Promise<{ obj?: string; error?: string; stdout?: string; stderr?: string }> {
    
    const tempImagePath = await Deno.makeTempFile({ prefix: "triposr-input-", suffix: ".png" });
    await Deno.writeFile(tempImagePath, imageContent);

    const tempOutputDir = await Deno.makeTempDir({ prefix: "triposr-output-" });
    const outputObjPath = `${tempOutputDir}/0/mesh.obj`;

    // Parámetros para TripoSR, optimizados para MÁXIMA calidad de impresión 3D
    const args = [
      "scripts/ai3d/triposr/run.py",
      tempImagePath,
      "--output-dir", tempOutputDir,
      "--model-save-format", "obj",
      "--mc-resolution", "512",
      "--extract-threshold", "5.0",
    ];

    console.log(`🚀 Running TripoSR command: scripts/ai3d/.venv/bin/python ${args.join(" ")}`);

    try {
      const command = new Deno.Command("scripts/ai3d/.venv/bin/python", {
        args,
        cwd: Deno.cwd(),
        stdout: "piped",
        stderr: "piped",
      });

      const process = command.spawn();
      const { code, stdout, stderr } = await process.output();
      
      const stdoutText = new TextDecoder().decode(stdout);
      const stderrText = new TextDecoder().decode(stderr);
      
      console.log("🚀 TripoSR script stdout:", stdoutText);
      if (stderrText) {
        console.log("🚀 TripoSR script stderr:", stderrText);
      }

      // Cleanup input image
      try {
        await Deno.remove(tempImagePath);
      } catch (e) {
        console.warn("Failed to cleanup temp image:", e);
      }

      if (code !== 0) {
        return {
          error: `TripoSR generation failed with code ${code}`,
          stdout: stdoutText,
          stderr: stderrText
        };
      }

      // Check if output file exists and read it
      try {
        const objContent = await Deno.readTextFile(outputObjPath);
        
        // Cleanup output directory
        try {
          await Deno.remove(tempOutputDir, { recursive: true });
        } catch (e) {
          console.warn("Failed to cleanup temp output dir:", e);
        }

        return {
          obj: objContent,
          stdout: stdoutText,
          stderr: stderrText
        };
        
      } catch (readError) {
        return {
          error: `Failed to read generated model: ${readError}`,
          stdout: stdoutText,
          stderr: stderrText
        };
      }

    } catch (execError) {
      // Cleanup on error
      try {
        await Deno.remove(tempImagePath);
        await Deno.remove(tempOutputDir, { recursive: true });
      } catch (_e) {
        // Ignore cleanup errors
      }
      
      return {
        error: `Failed to execute TripoSR generation: ${execError}`,
        stdout: "",
        stderr: ""
      };
    }
  }
}
