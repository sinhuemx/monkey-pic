import { Router } from "../deps.ts";
import hqRouter from "./hq.ts";
import model3dRouter from "./model3d.ts";
import { saveStlData } from "../services/firebase.service.ts";

const router = new Router();
router.get("/", (ctx) => {
  ctx.response.body = { app: "Monkey Pic", status: "ok" };
});
router.use("/api", hqRouter.routes(), hqRouter.allowedMethods());
router.use("/api", model3dRouter.routes(), model3dRouter.allowedMethods());

// Ruta POST /api/stl (JSON, no form-data)
router.post("/api/stl", async (ctx) => {
  const body = await ctx.request.body();
  const { originalName } = await body.value;

  const idToken = ctx.request.headers.get("authorization")?.replace("Bearer ", "");
  if (!idToken) {
    ctx.response.status = 401;
    ctx.response.body = { success: false, message: "Authorization token missing" };
    return;
  }
  try {
    await saveStlData({ filename: originalName, createdAt: new Date() }, idToken);
    ctx.response.body = { success: true };
  } catch (e) {
    ctx.response.status = 500;
    ctx.response.body = { success: false, message: "Error saving metadata to Firestore", error: String(e) };
  }
});

export { router };
