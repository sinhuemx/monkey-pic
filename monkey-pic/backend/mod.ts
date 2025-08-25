import { Application, loadEnv, Status } from "./deps.ts";
import { router } from "./routes/index.ts";

// Load environment variables from backend/.env regardless of CWD
const envPath = new URL("./.env", import.meta.url).pathname;
await loadEnv({ export: true, envPath });

const app = new Application();

// CORS middleware for Angular dev server
const allowedOrigin = Deno.env.get("CORS_ORIGIN") ?? "http://localhost:4200";
app.use(async (ctx, next) => {
	const origin = ctx.request.headers.get("origin") ?? allowedOrigin;
	ctx.response.headers.set("Vary", "Origin");
	ctx.response.headers.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
	ctx.response.headers.set(
		"Access-Control-Allow-Headers",
		"Origin, X-Requested-With, Content-Type, Accept, Authorization",
	);
	ctx.response.headers.set(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS",
	);
	if (ctx.request.method === "OPTIONS") {
		ctx.response.status = Status.NoContent;
		return;
	}
	await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = Number(Deno.env.get("PORT") ?? "8000");
console.log(`Listening on http://localhost:${PORT}`);
await app.listen({ port: PORT });
