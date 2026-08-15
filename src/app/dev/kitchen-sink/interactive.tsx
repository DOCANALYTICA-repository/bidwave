"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Money,
  MoneyDelta,
  Countdown,
  FileDrop,
  ReconnectBanner,
  type ConnectionStatus,
} from "@/components/bidwave";

export function MoneyDemo() {
  const [purse, setPurse] = useState(8_500_000);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Money value={purse} animateChange className="text-3xl font-bold" />
      <Button
        size="sm"
        variant="outline"
        onClick={() => setPurse((p) => p - 250_000)}
      >
        Simulate sale (−₹2.5L)
      </Button>
      <MoneyDelta value={-250_000} />
      <MoneyDelta value={250_000} />
    </div>
  );
}

export function CountdownDemo() {
  const [target] = useState(() => new Date(Date.now() + 65_000).toISOString());
  const [serverNow] = useState(() => new Date().toISOString());
  return (
    <Countdown
      target={target}
      serverNowAtMount={serverNow}
      className="text-2xl font-bold text-gold"
      onExpire={() => console.log("expired")}
    />
  );
}

export function FileDropDemo() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <FileDrop
      value={files}
      onChange={setFiles}
      accept=".pdf,.pptx,.docx,.xlsx,.mp4,.mov,.webm,.m4v,.mkv"
      maxSizeBytes={100 * 1024 * 1024}
    />
  );
}

export function ReconnectBannerDemo() {
  const [status, setStatus] = useState<ConnectionStatus>("online");
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">
        The banner docks to the real viewport top (it&apos;s `fixed`) — toggle a
        state below and look up.
      </p>
      <div className="flex gap-2">
        {(["online", "reconnecting", "offline"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {s}
          </Button>
        ))}
      </div>
      <ReconnectBanner status={status} />
    </div>
  );
}
