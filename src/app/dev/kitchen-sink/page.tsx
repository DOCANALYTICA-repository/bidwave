import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Trophy } from "lucide-react";

import {
  BrandMark,
  StatusPill,
  StatTile,
  DataTable,
  type StatusKey,
} from "@/components/bidwave";
import {
  MoneyDemo,
  CountdownDemo,
  FileDropDemo,
  ReconnectBannerDemo,
} from "@/app/dev/kitchen-sink/interactive";

const SWATCH_GROUPS: { title: string; swatches: { name: string; className: string }[] }[] = [
  {
    title: "Gold (brand)",
    swatches: [
      { name: "gold-bright", className: "bg-gold-bright" },
      { name: "gold", className: "bg-gold" },
      { name: "gold-deep", className: "bg-gold-deep" },
    ],
  },
  {
    title: "Surfaces",
    swatches: [
      { name: "surface-0", className: "bg-surface-0 border border-border" },
      { name: "surface-1", className: "bg-surface-1" },
      { name: "surface-2", className: "bg-surface-2" },
      { name: "surface-3", className: "bg-surface-3" },
      { name: "surface-4", className: "bg-surface-4" },
    ],
  },
  {
    title: "Semantic",
    swatches: [
      { name: "sold", className: "bg-sold" },
      { name: "unsold", className: "bg-unsold" },
      { name: "live", className: "bg-live" },
      { name: "analytics", className: "bg-analytics" },
      { name: "turf", className: "bg-turf" },
    ],
  },
];

const ALL_STATUSES: StatusKey[] = [
  "upcoming",
  "open-eligible",
  "open-view-only",
  "submitted",
  "closed",
  "scored",
  "qualified",
  "eliminated",
  "available",
  "active",
  "sold",
  "unsold",
  "recalled",
  "locked",
  "requested",
  "purchased",
  "rejected",
];

type PlayerRow = { name: string; role: string; base: string; status: StatusKey };
const SAMPLE_PLAYERS: PlayerRow[] = [
  { name: "R. Sharma", role: "Batter", base: "₹2 Cr", status: "sold" },
  { name: "J. Bumrah", role: "Bowler", base: "₹2 Cr", status: "active" },
  { name: "H. Pandya", role: "All-rounder", base: "₹1.5 Cr", status: "unsold" },
];

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-16 px-6 py-16">
      <header className="space-y-2">
        <p className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          /dev/kitchen-sink
        </p>
        <h1 className="font-display text-4xl">Bidwave Design System</h1>
        <p className="max-w-2xl text-ink-2">
          Every token and component in one place. Not part of the shipped
          product — see{" "}
          <code className="text-gold">docs/DESIGN_SYSTEM.md</code> for the
          full rationale.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Brand marks</h2>
        <div className="flex flex-wrap items-center gap-8 rounded-xl border border-border bg-card p-6">
          <BrandMark name="bidwave" height={56} />
          <BrandMark name="christ-university" height={40} />
          <BrandMark name="doc-commerce" height={40} />
          <BrandMark name="doc-analytica" height={64} />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Card</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Round 5 — The Grand Auction</CardTitle>
              <CardDescription>
                Build wisely. Bid boldly. Day 2 &amp; 3, 18–19 August.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StatusPill status="active" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Colour</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {SWATCH_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                {group.title}
              </p>
              <div className="space-y-1.5">
                {group.swatches.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <div className={`size-8 rounded-md ${s.className}`} />
                    <span className="font-mono text-xs text-ink-2">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Typography</h2>
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <p className="font-display text-4xl">Display — Anton</p>
          <p className="font-heading text-2xl font-bold">Heading — League Spartan</p>
          <p className="font-serif text-xl italic">Serif — Arapey, for editorial copy</p>
          <p className="font-sans text-base">Sans — Inter, for UI and body text</p>
          <p className="font-mono text-lg tabular-nums">Mono — JetBrains Mono 0123456789</p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Status pills</h2>
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-6">
          {ALL_STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Stat tiles</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Current rank" value="#4" tone="gold" hint="of 24 teams" />
          <StatTile label="Remaining purse" value="₹85,00,000" tone="success" />
          <StatTile label="Squad size" value="14 / 18" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Money &amp; deltas</h2>
        <div className="rounded-xl border border-border bg-card p-6">
          <MoneyDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Countdown</h2>
        <div className="rounded-xl border border-border bg-card p-6">
          <CountdownDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">File drop</h2>
        <div className="rounded-xl border border-border bg-card p-6">
          <FileDropDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Reconnect banner</h2>
        <div className="rounded-xl border border-border bg-card p-6">
          <ReconnectBannerDemo />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">Data table</h2>
        <DataTable
          rows={SAMPLE_PLAYERS}
          rowKey={(r) => r.name}
          columns={[
            { key: "name", header: "Player", render: (r) => r.name },
            { key: "role", header: "Role", render: (r) => r.role },
            { key: "base", header: "Base price", render: (r) => r.base },
            {
              key: "status",
              header: "Status",
              render: (r) => <StatusPill status={r.status} />,
            },
          ]}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold">shadcn primitives</h2>
        <div className="grid gap-6 rounded-xl border border-border bg-card p-6 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <Progress value={62} />
            <div className="space-y-2">
              <Label htmlFor="ks-input">Team name</Label>
              <Input id="ks-input" placeholder="Royal Commerce Challengers" />
            </div>
            <Textarea placeholder="Rubric feedback…" />
            <Select>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a pool" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marquee">Marquee</SelectItem>
                <SelectItem value="batters">Batters</SelectItem>
                <SelectItem value="bowlers">Bowlers</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>RC</AvatarFallback>
              </Avatar>
              <Tooltip>
                <TooltipTrigger render={<Button size="sm" variant="outline" />}>
                  Hover me
                </TooltipTrigger>
                <TooltipContent>Tooltip content</TooltipContent>
              </Tooltip>
            </div>
            <Skeleton className="h-8 w-full" />
          </div>

          <div className="space-y-3">
            <Alert>
              <Trophy className="size-4" />
              <AlertTitle>Sale recorded</AlertTitle>
              <AlertDescription>
                R. Sharma sold to Royal Commerce Challengers for ₹2.4 Cr.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Sale blocked</AlertTitle>
              <AlertDescription>
                Squad size limit reached (18/18). No partial changes were made.
              </AlertDescription>
            </Alert>

            <Tabs defaultValue="rules">
              <TabsList>
                <TabsTrigger value="rules">Rules</TabsTrigger>
                <TabsTrigger value="rubric">Rubric</TabsTrigger>
              </TabsList>
              <TabsContent value="rules" className="text-sm text-ink-2">
                One continuous attempt. Full-screen required.
              </TabsContent>
              <TabsContent value="rubric" className="text-sm text-ink-2">
                Creativity 40 · Strategy 40 · Delivery 20.
              </TabsContent>
            </Tabs>

            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                Open dialog
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reverse this sale?</DialogTitle>
                  <DialogDescription>
                    Purse, roster and player status will be restored
                    automatically for every team affected.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </section>

      <Separator />
      <footer className="pb-8 text-center text-xs text-ink-3">
        Bidwave — Department of Commerce, CHRIST University · Built by DOC
        Analytica
      </footer>
    </main>
  );
}
