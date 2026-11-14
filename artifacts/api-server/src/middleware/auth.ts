import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { memoryAuthStore } from "../lib/memoryAuthStore";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    throw new Error("JWT_SECRET environment variable must be set in production.");
  }
  return secret || "fallback_secret_for_hackathon";
}

// Add user to Request object typing
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.cookies.accessToken || req.cookies.vyapaar_session;

    if (!token) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const payload = jwt.verify(token, getJwtSecret()) as any;

    let user: any = memoryAuthStore.findById(payload.userId);
    if (!user && process.env.DATABASE_URL) {
      try {
        user = await db.query.usersTable.findFirst({
          where: eq(usersTable.id, payload.userId),
        });
      } catch {
        // Database unreachable; rely on memoryAuthStore
      }
    }

    if (!user || !user.isActive) {
      res.status(401).json({ message: "Invalid user session" });
      return;
    }

    req.user = user;
    next();
    return;
  } catch {
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }
};
