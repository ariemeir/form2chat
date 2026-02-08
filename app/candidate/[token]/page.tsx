"use client";

import { useParams } from "next/navigation";
import DemoChat from "@/app/demo/page"; 

export default function CandidatePage() {
  const { token } = useParams<{ token: string }>();
  return <DemoChat candidateToken={token} />;
}

