"use client";

import { Suspense } from "react";
import { Messages } from "@/components/messages";
import { Spinner } from "@/components/ui";

export default function MessagesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Messages />
    </Suspense>
  );
}
