import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { dialogueRouter } from "./routes/dialogue.js";

const app = express();
const port = config.port;

// 1. Enable Cross-Origin Resource Sharing (CORS)
app.use(cors());

// 2. Configure JSON body parser and capture rawBody string for signature validation
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

// 3. Register dialogue API endpoints under /api prefix
app.use("/api", dialogueRouter);

// 4. Default health check route
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: Date.now() });
});

// 5. Global error handler middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[ServerError]", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message || "An unexpected error occurred"
  });
});

// 6. Start listening
app.listen(port, "0.0.0.0", () => {
  console.log("==================================================================");
  console.log(`🚀 Xiaoice-to-OpenClaw API Bridge is listening on http://0.0.0.0:${port}`);
  console.log(`🔑 Configured Access Key: ${config.xiaoiceAccessKey}`);
  console.log(`🌐 Target OpenClaw WS: ${config.openclawWsUrl}`);
  console.log(`🎭 Fallback Target Agent: ${config.defaultAgentId}`);
  console.log("==================================================================");
});
