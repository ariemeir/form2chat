"use client";

import { useParams } from "next/navigation";
import DemoChat from "@/app/demo/page";

export default function ReferencePage() {
  const { token } = useParams<{ token: string }>();
  return <DemoChat referenceToken={token} />;
}
