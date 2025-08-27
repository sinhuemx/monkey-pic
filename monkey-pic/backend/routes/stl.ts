import { Router } from "../deps.ts";
import { StlService } from "../services/stl.service.ts";

const router = new Router();
const stlService = new StlService();

router.post("/", async (ctx) => {
  const body = ctx.request.body({ type: "form-data" });
  const formData = await body.value.read();
  const file = formData.files ? formData.files[0] : undefined;
  const options = JSON.parse(formData.fields.options || "{}");

  if (file && file.content) {
    const result = await stlService.generateHqModel(file.content, options);
    if (result.error) {
      ctx.response.status = 500;
      ctx.response.body = result;
    } else {
      ctx.response.body = { stl: result.stl, stdout: result.stdout, stderr: result.stderr };
    }
  } else {
    ctx.response.status = 400;
    ctx.response.body = { error: "No file uploaded" };
  }
});

export default router;