import { Router, Request, Response } from "express";
import { requireXiaoiceAuth } from "../utils/auth.js";
import { OpenClawClient } from "../gateway/OpenClawClient.js";
import { config } from "../config.js";

export const dialogueRouter = Router();

// Create a persistent, globally shared OpenClawClient instance
const openClaw = new OpenClawClient();



/**
 * Parses and extracts gestures/postures inside text brackets e.g. [huishou] -> posture list
 */
function extractPostures(text: string): { cleanedText: string; postures: string[] } {
  const postures: string[] = [];
  const bracketRegex = /\[([a-zA-Z0-9_-]+)\]/g;
  let match;
  
  // Find all matches
  while ((match = bracketRegex.exec(text)) !== null) {
    if (match[1]) {
      postures.push(match[1]);
    }
  }

  // Remove bracket posture tags from the text
  const cleanedText = text.replace(bracketRegex, "").trim();
  return { cleanedText, postures };
}

// Ensure OpenClaw is connected in background as early as possible
openClaw.connect().catch((err) => {
  console.error("[dialogueRouter] Pre-connection to OpenClaw failed:", err.message);
});

/**
 * POST /api/talk
 * Streams responses back via Server-Sent Events (SSE)
 */
dialogueRouter.post("/talk", requireXiaoiceAuth, async (req: Request, res: Response) => {
  const { askText, sessionId, traceId, userParams, extra } = req.body;

  if (!askText || !sessionId || !traceId) {
    res.status(400).json({
      error: "Bad Request",
      message: "Missing required parameters: askText, sessionId, traceId"
    });
    return;
  }

  // Set headers for SSE streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Prevent Nginx buffering

  // Resolve which OpenClaw agent to talk to
  const agentId = userParams || config.defaultAgentId;
  const sessionKey = `agent:${agentId}:main`;

  console.log(`[talk] Session: ${sessionId}, Trace: ${traceId}, Agent ID: ${agentId}, sessionKey: ${sessionKey}`);

  let chunkCount = 0;
  let fullBotReply = "";

  try {
    // Connect to OpenClaw (resolves instantly if already connected)
    await openClaw.connect();

    // Fire chat stream
    await openClaw.sendChat(sessionKey, askText, (chunkPayload) => {
      let rawText = "";

      if (typeof chunkPayload.deltaText === "string") {
        rawText = chunkPayload.deltaText;
      } else if (typeof chunkPayload.delta === "string") {
        rawText = chunkPayload.delta;
      } else if (typeof chunkPayload.message?.text === "string") {
        rawText = chunkPayload.message.text;
      }

      if (!rawText) return;

      // Extract postures if any (e.g. [huishou] -> digital human gesture waving)
      const { cleanedText, postures } = extractPostures(rawText);
      fullBotReply += cleanedText;

      chunkCount++;
      const chunk = {
        askText,
        extra: extra || {},
        id: `${traceId}_${chunkCount}`,
        replyPayload: postures.length > 0 ? {
          postureList: JSON.stringify(postures),
          loopPosture: "true"
        } : null,
        replyText: cleanedText,
        replyType: "Llm",
        sessionId,
        timestamp: Date.now(),
        traceId,
        isFinal: false
      };

      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });

    // Send final completion packet
    chunkCount++;
    const finalChunk = {
      askText,
      extra: extra || {},
      id: `${traceId}_${chunkCount}`,
      replyPayload: null,
      replyText: "",
      replyType: "Llm",
      sessionId,
      timestamp: Date.now(),
      traceId,
      isFinal: true
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.end();

    // Print gorgeous CHAT LOG to terminal/Docker stdout
    console.log(`\n💬 [CHAT LOG]`);
    console.log(`👤 User: "${askText}"`);
    console.log(`🤖 Bot : "${fullBotReply}"`);
    console.log(`-------------------------------------------\n`);

  } catch (err: any) {
    console.error("[talk] Error during streaming:", err);
    
    // Attempt to push final error frame to SSE stream
    const errorChunk = {
      askText,
      extra: extra || {},
      id: traceId,
      replyPayload: null,
      replyText: `Error: ${err.message || "Failed to generate response"}`,
      replyType: "Error",
      sessionId,
      timestamp: Date.now(),
      traceId,
      isFinal: true
    };
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.end();
  }
});

/**
 * POST /api/welcome
 * Returns the localized welcome message
 */
dialogueRouter.post("/welcome", requireXiaoiceAuth, (req: Request, res: Response) => {
  const { sessionId, traceId, languageCode } = req.body;
  const isEn = languageCode?.toLowerCase().startsWith("en");

  const replyText = isEn 
    ? "Hello! I am HKIIT Assistant. How can I help you today?" 
    : "你好！我是智能助手。很高兴为你服务！[huishou]";

  const { cleanedText, postures } = extractPostures(replyText);

  // Print WELCOME LOG to console
  console.log(`\n👋 [WELCOME LOG]`);
  console.log(`Session: ${sessionId || "welcome_session"}`);
  console.log(`🤖 Bot : "${cleanedText}"`);
  console.log(`-------------------------------------------\n`);

  res.json({
    askText: "",
    extra: {},
    id: traceId || `welcome_${Date.now()}`,
    replyPayload: postures.length > 0 ? {
      postureList: JSON.stringify(postures),
      loopPosture: "true"
    } : null,
    replyText: cleanedText,
    replyType: "Llm",
    sessionId: sessionId || "welcome_session",
    timestamp: Date.now(),
    traceId: traceId || `welcome_trace`,
    isFinal: true
  });
});

/**
 * POST /api/goodbye
 * Returns conclusion phrase
 */
dialogueRouter.post("/goodbye", requireXiaoiceAuth, (req: Request, res: Response) => {
  const { sessionId, traceId, languageCode } = req.body;
  const isEn = languageCode?.toLowerCase().startsWith("en");

  const replyText = isEn 
    ? "Goodbye! Have a great day!" 
    : "再见！期待下次与你相遇！[huishou]";

  const { cleanedText, postures } = extractPostures(replyText);

  // Print GOODBYE LOG to console
  console.log(`\n👋 [GOODBYE LOG]`);
  console.log(`Session: ${sessionId || "goodbye_session"}`);
  console.log(`🤖 Bot : "${cleanedText}"`);
  console.log(`-------------------------------------------\n`);

  res.json({
    askText: "",
    extra: {},
    id: traceId || `goodbye_${Date.now()}`,
    replyPayload: postures.length > 0 ? {
      postureList: JSON.stringify(postures),
      loopPosture: "true"
    } : null,
    replyText: cleanedText,
    replyType: "Llm",
    sessionId: sessionId || "goodbye_session",
    timestamp: Date.now(),
    traceId: traceId || `goodbye_trace`,
    isFinal: true
  });
});

/**
 * POST /api/recquestions
 * Returns dynamic recommended questions list
 */
dialogueRouter.post("/recquestions", requireXiaoiceAuth, (req: Request, res: Response) => {
  const { traceId, languageCode } = req.body;
  const isEn = languageCode?.toLowerCase().startsWith("en");

  const prompts = isEn
    ? ["What can you do?", "Introduce yourself", "Tell me a joke"]
    : ["你能做什么？", "介绍一下自己", "跳个舞吧"];

  res.json({
    data: prompts,
    traceId: traceId || `recquestions_trace`
  });
});
