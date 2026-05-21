import { createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Calculates the Xiaoice Signature V2.
 * 
 * Sorts keys: bodyString -> secretKey -> timestamp
 * Format: bodyString=<bodyString>&secretKey=<secretKey>&timestamp=<timestamp>
 * SHA-512 and UPPERCASE
 */
export function calculateSignature(bodyString: string, secretKey: string, timestamp: string): string {
  const paramsStr = `bodyString=${bodyString}&secretKey=${secretKey}&timestamp=${timestamp}`;
  return createHash("sha512").update(paramsStr, "utf8").digest("hex").toUpperCase();
}

/**
 * Express middleware to validate Xiaoice Signature V2
 */
export function requireXiaoiceAuth(req: Request, res: Response, next: NextFunction): void {
  const xKey = req.header("X-Key") || req.header("key");
  const xTimestamp = req.header("X-Timestamp") || req.header("timestamp");
  const xSign = req.header("X-Sign") || req.header("signature");

  // 1. Ensure all headers are present
  if (!xKey || !xTimestamp || !xSign) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing authentication headers (X-Key, X-Timestamp, X-Sign)"
    });
    return;
  }

  // 2. Validate X-Key matches access key
  if (xKey !== config.xiaoiceAccessKey) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid X-Key"
    });
    return;
  }

  // 3. Validate timestamp within 5 minutes window
  const timestampMs = parseInt(xTimestamp, 10);
  if (isNaN(timestampMs)) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid X-Timestamp value"
    });
    return;
  }

  const now = Date.now();
  const DRIFT_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
  if (Math.abs(now - timestampMs) > DRIFT_LIMIT_MS) {
    res.status(401).json({
      error: "Unauthorized",
      message: `Request expired (time drift exceeds 5 minutes). Server: ${now}, Client: ${timestampMs}`
    });
    return;
  }

  // 4. Compute and compare signature
  // Retrieve the raw body attached by our custom body parser verify option
  const bodyString = (req as any).rawBody || "";
  const calculated = calculateSignature(bodyString, config.xiaoiceSecretKey, xTimestamp);

  if (calculated !== xSign.toUpperCase()) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Signature verification failed"
    });
    return;
  }

  // Authentication succeeded, proceed
  next();
}
