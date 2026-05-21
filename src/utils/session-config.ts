import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store config relative to project root
const CONFIG_FILE_PATH = path.resolve(__dirname, "../../session_config.json");

export interface SessionConfig {
  mode: "fixed" | "dynamic";
  fixedSessionKey: string;
}

const DEFAULT_CONFIG: SessionConfig = {
  mode: "fixed",
  fixedSessionKey: "main"
};

// Memory cache
let cachedConfig: SessionConfig | null = null;

/**
 * Loads session configuration from disk or returns default config
 */
export function getSessionConfig(): SessionConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      
      // Basic validation
      cachedConfig = {
        mode: parsed.mode === "dynamic" ? "dynamic" : "fixed",
        fixedSessionKey: typeof parsed.fixedSessionKey === "string" ? parsed.fixedSessionKey.trim() : "main"
      };
      return cachedConfig;
    }
  } catch (err) {
    console.error("[SessionConfig] Failed to read session_config.json, returning defaults:", err);
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

/**
 * Persists session configuration to disk and updates cache
 */
export function saveSessionConfig(config: Partial<SessionConfig>): SessionConfig {
  const current = getSessionConfig();
  
  const updated: SessionConfig = {
    mode: config.mode === "dynamic" ? "dynamic" : "fixed",
    fixedSessionKey: typeof config.fixedSessionKey === "string" ? config.fixedSessionKey.trim() : current.fixedSessionKey
  };

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(updated, null, 2), "utf8");
    cachedConfig = updated;
    console.log(`[SessionConfig] Successfully updated session configuration: mode=${updated.mode}, fixedSessionKey=${updated.fixedSessionKey}`);
  } catch (err) {
    console.error("[SessionConfig] Failed to save session configuration to disk:", err);
  }

  return updated;
}
