import { NextResponse } from "next/server";
import { recordFileAndAdvance } from "@/lib/engine";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const u = new URL(req.url);
  const formId = u.searchParams.get("formId") ?? "demo";
  const sessionId = u.searchParams.get("sessionId");
  const fieldId = u.searchParams.get("fieldId");

  if (!sessionId || !fieldId) {
    return NextResponse.json({ error: "Missing sessionId or fieldId" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileId = crypto.randomUUID();

  const safeName = (file.name || "upload").replace(/[^\w.\-]+/g, "_");
  const diskPath = path.join(process.cwd(), "uploads", `${fileId}_${safeName}`);

  await fs.mkdir(path.join(process.cwd(), "uploads"), { recursive: true });
  await fs.writeFile(diskPath, bytes);

  const res = recordFileAndAdvance({
    formId,
    sessionId,
    fieldId,
    originalName: file.name || safeName,
    mime: file.type || "application/octet-stream",
    sizeBytes: bytes.length,
    diskPath,
    fileId
  });

  return NextResponse.json(res);
}
