import { createHash } from "node:crypto";
import { config } from "./src/config.js";

const PORT = config.port || 3002;
const BASE_URL = `http://localhost:${PORT}/api`;
const ACCESS_KEY = config.xiaoiceAccessKey || "test_access_key";
const SECRET_KEY = config.xiaoiceSecretKey || "test_secret_key";

/**
 * Calculates Xiaoice Signature V2
 */
function calculateSignature(bodyString: string, secretKey: string, timestamp: string): string {
  const paramsStr = `bodyString=${bodyString}&secretKey=${secretKey}&timestamp=${timestamp}`;
  return createHash("sha512").update(paramsStr, "utf8").digest("hex").toUpperCase();
}

/**
 * Helper to prepare authentic headers for requests
 */
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

async function runTests() {
  console.log("==================================================================");
  console.log("🧪 Starting Integration Verification Tests for xiaoice-openclaw-api");
  console.log(`📡 Targeting Service URL: ${BASE_URL}`);
  console.log("==================================================================");

  try {
    // Test 1: Verify /welcome endpoint
    console.log("\n➡️  Test 1: Testing /welcome endpoint...");
    const welcomeBody = {
      sessionId: "test-session-123",
      traceId: "test-trace-welcome",
      languageCode: "zh"
    };

    const welcomeRes = await fetch(`${BASE_URL}/welcome`, {
      method: "POST",
      headers: getAuthHeaders(welcomeBody),
      body: JSON.stringify(welcomeBody)
    });

    if (!welcomeRes.ok) {
      throw new Error(`Welcome endpoint failed: ${welcomeRes.status} ${welcomeRes.statusText}`);
    }

    const welcomeData = await welcomeRes.json();
    console.log("✅ Welcome endpoint returned successfully:");
    console.log(JSON.stringify(welcomeData, null, 2));


    // Test 2: Verify /recquestions endpoint
    console.log("\n➡️  Test 2: Testing /recquestions endpoint...");
    const recBody = {
      traceId: "test-trace-rec",
      languageCode: "zh"
    };

    const recRes = await fetch(`${BASE_URL}/recquestions`, {
      method: "POST",
      headers: getAuthHeaders(recBody),
      body: JSON.stringify(recBody)
    });

    if (!recRes.ok) {
      throw new Error(`Recquestions endpoint failed: ${recRes.status} ${recRes.statusText}`);
    }

    const recData = await recRes.json();
    console.log("✅ Recquestions endpoint returned successfully:");
    console.log(JSON.stringify(recData, null, 2));


    // Test 3: Verify /talk endpoint with streaming SSE responses
    console.log("\n➡️  Test 3: Testing /talk streaming endpoint...");
    const talkBody = {
      askText: "你好",
      sessionId: "test-session-123",
      traceId: "test-trace-talk",
      languageCode: "zh",
      userParams: "main" // Target agent
    };

    const talkRes = await fetch(`${BASE_URL}/talk`, {
      method: "POST",
      headers: getAuthHeaders(talkBody),
      body: JSON.stringify(talkBody)
    });

    if (!talkRes.ok) {
      throw new Error(`Talk streaming failed: ${talkRes.status} ${talkRes.statusText}`);
    }

    console.log("✅ Talk streaming request established! Reading stream chunks...");
    console.log("------------------------------------------------------------------");

    const reader = talkRes.body?.getReader();
    if (!reader) {
      throw new Error("Unable to read streaming body reader.");
    }

    const decoder = new TextDecoder("utf8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      
      // Save the last incomplete line back into buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data:")) {
          const rawJson = trimmed.substring(5).trim();
          try {
            const parsed = JSON.parse(rawJson);
            console.log(`📡 [Chunk Received] (isFinal: ${parsed.isFinal}) => "${parsed.replyText}"`);
            if (parsed.replyPayload) {
              console.log("   👉 Posture Payload found:", parsed.replyPayload);
            }
          } catch (err) {
            console.warn("⚠️ Failed to parse streamed chunk:", trimmed);
          }
        }
      }
    }

    console.log("------------------------------------------------------------------");
    console.log("✅ Talk streaming completed successfully!");

    console.log("\n==================================================================");
    console.log("🎉 All integration tests passed successfully!");
    console.log("==================================================================");

  } catch (error: any) {
    console.error("\n❌ Test Suite Encountered Error:", error.message || error);
    process.exit(1);
  }
}

void runTests();
