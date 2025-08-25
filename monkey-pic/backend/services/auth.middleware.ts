import { Context } from "../deps.ts";
import { auth } from "../firebase.service.ts";

// Middleware que verifica el ID token de Firebase enviado en Authorization: Bearer <token>
export async function requireAuth(ctx: Context, next: () => Promise<unknown>) {
  try {
    const authHeader = ctx.request.headers.get("authorization") ?? "";
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Falta Authorization: Bearer <token>" };
      return;
    }

    const idToken = match[1];
    const decoded = await auth.verifyIdToken(idToken);
    // Adjunta el uid y claims al contexto
    (ctx.state as any).uid = decoded.uid;
    (ctx.state as any).claims = decoded;
    await next();
  } catch (err) {
    console.error("Auth error:", err);
    ctx.response.status = 401;
    ctx.response.body = { error: "Token inválido o expirado" };
  }
}
