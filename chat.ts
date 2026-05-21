import { createHash } from "node:crypto";
import { config } from "./src/config.js";

const PORT = config.port || 3002;
const BASE_URL = `http://localhost:${PORT}/api`;
const ACCESS_KEY = config.xiaoiceAccessKey || "test_access_key";
const SECRET_KEY = config.xiaoiceSecretKey || "test_secret_key";

function calculateSignature(bodyString: string, secretKey: string, timestamp: string): string {
  const paramsStr = `bodyString=${bodyString}&secretKey=${secretKey}&timestamp=${timestamp}`;
  return createHash("sha512").update(paramsStr, "utf8").digest("hex").toUpperCase();
}

function getAuthHeaders(body: any): Record<string, string> {
  const bodyString = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = calculateSignature(bodyString, SECRET_KEY, timestamp);

  return {
    "Content-Type": "application/json",
    "X-Key": ACCESS_KEY,
    "X-Timestamp": timestamp,
    "X-Sign": signature
  };
}

// Function to send a streaming message and print it out
async function sendMessage(sessionId: string, text: string, turnNum: number) {
  console.log(`\n💬 [Turn ${turnNum}] User: "${text}"`);
  
  const talkBody = {
    askText: text,
    sessionId,
    traceId: `trace-turn-${turnNum}-${Date.now()}`,
    languageCode: "zh",
    userParams: "main"
  };

  const talkRes = await fetch(`${BASE_URL}/talk`, {
    method: "POST",
    headers: getAuthHeaders(talkBody),
    body: JSON.stringify(talkBody)
  });

  if (!talkRes.ok) {
    throw new Error(`Talk failed: ${talkRes.status} ${talkRes.statusText}`);
  }

  const reader = talkRes.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let botReply = "";

  process.stdout.write("🤖 Bot: ");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const rawJson = trimmed.substring(5).trim();
      try {
        const parsed = JSON.parse(rawJson);
        if (parsed.replyText) {
          process.stdout.write(parsed.replyText);
          botReply += parsed.replyText;
        }
      } catch (err) {}
    }
  }
  console.log(""); // newline
  return botReply;
}

async function runMultiTurnChat() {
  const sessionId = `session-multi-turn-${Date.now()}`;
  console.log("==================================================================");
  console.log("🚀 Starting Sample Multi-Turn Chat Simulation with OpenClaw");
  console.log(`Session ID: ${sessionId}`);
  console.log("==================================================================");

  try {
    // Turn 1: Introduce name
    await sendMessage(sessionId, "你好，我叫小明，是一个AI软件工程师。", 1);

    // Give a short delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Turn 2: Query memory
    await sendMessage(sessionId, "你还记得我的名字吗？我刚才自我介绍过了。", 2);

    // Give a short delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Turn 3: Query capabilities
    await sendMessage(sessionId, "太棒了！你能跳个舞或者给我做一个手势来打个招呼吗？", 3);

  } catch (error: any) {
    console.error("❌ Chat failed:", error.message);
  }
}

runMultiTurnChat();
