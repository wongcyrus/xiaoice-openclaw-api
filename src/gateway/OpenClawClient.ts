import WebSocket from "ws";
import { createHash, randomUUID } from "node:crypto";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { config } from "../config.js";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: Uint8Array;
};

const GATEWAY_ROLE = "operator";
const GATEWAY_SCOPES = [
  "operator.read",
  "operator.admin",
  "operator.approvals",
  "operator.pairing"
];
const GATEWAY_CLIENT_ID = "gateway-client";

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function fingerprintPublicKey(publicKey: Uint8Array): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce?: string | null;
  version?: "v1" | "v2";
}): string {
  const version = params.version ?? (params.nonce ? "v2" : "v1");
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === "v2") {
    base.push(params.nonce ?? "");
  }
  return base.join("|");
}

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private connectPromise: Promise<void> | null = null;
  private isConnected = false;
  private deviceIdentity: DeviceIdentity | null = null;
  private connectNonce: string | null = null;
  private connectRequestIds = new Set<string>();

  // Map of active runId to their chunk streaming callbacks
  private activeStreams = new Map<string, (chunkPayload: any) => void>();

  constructor() {}

  /**
   * Initializes the client, generates cryptographic keys, and opens the WS connection.
   */
  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      // 1. Generate Ed25519 identity keys
      const privateKey = utils.randomSecretKey();
      const publicKey = await getPublicKeyAsync(privateKey);
      this.deviceIdentity = {
        deviceId: fingerprintPublicKey(publicKey),
        publicKey: base64UrlEncode(publicKey),
        privateKey,
      };

      console.log(`[OpenClawClient] Initializing Ed25519 device ID: ${this.deviceIdentity.deviceId}`);

      const wsUrl = config.openclawWsUrl;
      console.log(`[OpenClawClient] Connecting to OpenClaw at: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      // 3. Setup event listeners immediately (avoids race condition for early challenge frames)
      ws.on("message", (raw: WebSocket.RawData) => {
        this.handleMessage(raw.toString("utf8"));
      });

      ws.on("close", () => {
        console.warn("[OpenClawClient] WebSocket connection closed.");
        this.isConnected = false;
        this.connectPromise = null;
        this.rejectAllPending(new Error("WebSocket connection closed."));
      });

      ws.on("error", (err) => {
        console.error("[OpenClawClient] WebSocket error:", err);
      });

      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("error", onError);
          resolve();
        };

        const onError = (err: any) => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("error", onError);
          reject(err);
        };

        ws.addEventListener("open", onOpen);
        ws.addEventListener("error", onError);
      });

      // 4. Wait for the handshake challenge, and then resolve after authorized
      await new Promise<void>((resolve, reject) => {
        const checkConnection = setInterval(() => {
          if (this.isConnected) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);

        // Timeout handshake if it takes too long
        setTimeout(() => {
          clearInterval(checkConnection);
          if (!this.isConnected) {
            reject(new Error("OpenClaw handshake timed out."));
          }
        }, 10000);
      });
    })();

    return this.connectPromise;
  }

  /**
   * Send a JSON-RPC request to the gateway.
   */
  async request<T = any>(method: string, params: any): Promise<T> {
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw connection is not active.");
    }

    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      const frame = { type: "req", id, method, params };
      this.ws?.send(JSON.stringify(frame));

      // Setup 15 seconds request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} (id: ${id}) timed out.`));
        }
      }, 15000);
    });
  }

  /**
   * Sends a prompt message to the OpenClaw agent and streams responses asynchronously.
   */
  async sendChat(
    sessionKey: string,
    messageText: string,
    onChunk: (chunk: any) => void
  ): Promise<any> {
    const idempotencyKey = randomUUID();

    try {
      const response = await this.request("chat.send", {
        sessionKey,
        message: messageText,
        deliver: false,
        idempotencyKey
      });

      const actualRunId = response?.runId || idempotencyKey;
      console.log(`[OpenClawClient] chat.send response received. Gateway assigned runId: ${actualRunId}`);

      // Register active stream callback using the actual runId returned from the gateway
      this.activeStreams.set(actualRunId, onChunk);

      // Wait until the run completes via async stream events or immediately completes
      if (response && response.status !== "started") {
        // Run completed immediately without async streaming expected
        this.activeStreams.delete(actualRunId);
        return response;
      }

      // Return a promise that resolves when the streaming is finished
      return new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.activeStreams.has(actualRunId)) {
            clearInterval(checkInterval);
            resolve();
          }
          if (!this.isConnected) {
            clearInterval(checkInterval);
            reject(new Error("Lost connection to gateway during streaming."));
          }
        }, 200);
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Close the WebSocket connection.
   */
  close() {
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
    this.connectPromise = null;
    this.rejectAllPending(new Error("Client closed manually."));
  }

  private async handleMessage(raw: string) {
    try {
      const frame = JSON.parse(raw);
      if (!frame) return;

      console.log(`[OpenClawClient] Received frame type: ${frame.type}, event: ${frame.event || "<none>"}, id: ${frame.id || "<none>"}, ok: ${frame.ok}`);

      // 1. Handle event frames (e.g., connect.challenge or stream chat chunks)
      if (frame.type === "event") {
        if (frame.event === "connect.challenge") {
          const nonce = frame.payload?.nonce?.trim();
          if (nonce) {
            this.connectNonce = nonce;
            await this.sendConnectHandshake();
          }
        } else if (frame.event === "chat") {
          const payload = frame.payload;
          console.log("[OpenClawClient] Received chat event payload:", JSON.stringify(payload, null, 2));
          const runId = payload?.runId;
          if (runId && this.activeStreams.has(runId)) {
            const onChunk = this.activeStreams.get(runId);
            if (onChunk) {
              onChunk(payload);
            }

            // Check if stream is complete
            if (["final", "error", "aborted"].includes(payload.state)) {
              console.log(`[OpenClawClient] Run completed/terminated: ${runId}`);
              this.activeStreams.delete(runId);
            }
          } else {
            console.log(`[OpenClawClient] Received unhandled chat event (runId mismatch or inactive): ${runId}. Active stream runIds:`, [...this.activeStreams.keys()]);
          }
        }
        return;
      }

      // 2. Handle handshake connect responses
      if (this.connectRequestIds.has(frame.id)) {
        this.connectRequestIds.delete(frame.id);
        if (frame.ok) {
          console.log("[OpenClawClient] Handshake handshake authorized successfully!");
          this.isConnected = true;
        } else {
          console.error("[OpenClawClient] Handshake rejected by gateway:", frame.error);
          this.ws?.close();
        }
        return;
      }

      // 3. Handle standard pending request resolutions
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        this.pendingRequests.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error?.message || "Gateway request failed."));
        }
      }
    } catch (err) {
      console.error("[OpenClawClient] Error parsing incoming WS packet:", err);
    }
  }

  private async sendConnectHandshake() {
    if (!this.ws || !this.deviceIdentity) return;

    const signedAtMs = Date.now();
    const payload = buildDeviceAuthPayload({
      deviceId: this.deviceIdentity.deviceId,
      clientId: GATEWAY_CLIENT_ID,
      clientMode: "backend",
      role: GATEWAY_ROLE,
      scopes: GATEWAY_SCOPES,
      signedAtMs,
      token: config.openclawToken,
      nonce: this.connectNonce
    });

    const signature = await signAsync(new TextEncoder().encode(payload), this.deviceIdentity.privateKey);
    const id = randomUUID();
    this.connectRequestIds.add(id);

    const handshakeFrame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: GATEWAY_CLIENT_ID,
          version: "dev",
          platform: process.platform,
          mode: "backend",
        },
        role: GATEWAY_ROLE,
        scopes: GATEWAY_SCOPES,
        caps: [],
        device: {
          id: this.deviceIdentity.deviceId,
          publicKey: this.deviceIdentity.publicKey,
          signature: base64UrlEncode(signature),
          signedAt: signedAtMs,
          ...(this.connectNonce ? { nonce: this.connectNonce } : {})
        },
        ...(config.openclawToken ? { auth: { token: config.openclawToken } } : {})
      }
    };

    console.log(`[OpenClawClient] Submitting authentication signature frame...`);
    this.ws.send(JSON.stringify(handshakeFrame));
  }

  private rejectAllPending(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.activeStreams.clear();
  }
}
