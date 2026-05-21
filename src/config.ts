import dotenv from "dotenv";
import path from "node:path";

// Load environment variables from .env
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3002),
  xiaoiceAccessKey: process.env.XIAOICE_ACCESS_KEY ?? "test_access_key",
  xiaoiceSecretKey: process.env.XIAOICE_SECRET_KEY ?? "test_secret_key",
  openclawWsUrl: process.env.OPENCLAW_WS_URL ?? "ws://127.0.0.1:18789",
  openclawToken: process.env.OPENCLAW_TOKEN ?? "",
  defaultAgentId: process.env.DEFAULT_AGENT_ID ?? "main"
};
