"use client";

import { useState } from "react";
import type { Source } from "@/lib/audit";

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function niceDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
// Full weekday ("Sunday, Dec 6"), used only by the return-deadline tag; niceDate stays short everywhere else.
export function longDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
export function daysFromNow(iso: string) {
  return Math.ceil((new Date(iso + "T12:00:00").getTime() - Date.now()) / 86_400_000);
}

export function Button({
  children,
  onClick,
  href,
  kind = "primary",
  disabled,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  kind?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const style = {
    primary: "bg-primary text-on-primary hover:bg-primary-hover",
    secondary: "border border-primary bg-surface text-primary hover:bg-primary-container-low",
    ghost: "text-primary underline underline-offset-4 hover:bg-primary-container-low",
  }[kind];
  const cls = `inline-flex min-h-12 items-center justify-center rounded-md px-6 text-[18px] font-bold transition disabled:opacity-45 ${style} ${className}`;
  if (href)
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-outline-variant bg-surface p-[24px] ${className}`}>{children}</div>;
}

type Tone = "neutral" | "brand" | "urgent" | "good" | "caution";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-container-high text-on-surface",
  brand: "bg-primary-container text-on-primary-container",
  urgent: "bg-error-container text-error",
  good: "bg-success-container text-success",
  caution: "bg-tertiary-container text-on-tertiary-container",
};
export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-[12px] py-[4px] text-[16px] font-bold ${TONE[tone]}`}>{children}</span>;
}

export function KinAvatar({ size = 40 }: { size?: number }) {
  // Kin mark: two figures leaning into each other (a parent and a family member), in a soft rounded tile.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" aria-hidden>
      <rect width="48" height="48" rx="8" fill="#0b6e75" />
      <circle cx="18.5" cy="17" r="5.5" fill="#ffffff" />
      <path d="M8 38c0-7.2 4.7-11.5 10.5-11.5S29 30.8 29 38z" fill="#ffffff" />
      <circle cx="30.5" cy="20" r="4.6" fill="#fbe3cf" />
      <path d="M21.5 38c0-6.2 4-9.8 9-9.8s9 3.6 9 9.8z" fill="#fbe3cf" />
    </svg>
  );
}

export function PersonAvatar({ name, size = 40, tone = "bg-tertiary-container text-tertiary" }: { name: string; size?: number; tone?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${tone}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {name[0]}
    </span>
  );
}

export function SourceChip({ id, sources, onOpen }: { id: string; sources: Map<string, Source>; onOpen: (s: Source) => void }) {
  const src = sources.get(id);
  const email = src?.provider === "email";
  // Sources are smaller and lighter than tags, so they never compete with the fact they support.
  const tone = !src
    ? "border-dashed border-outline-variant bg-surface-container text-on-surface-muted"
    : email
      ? "border-outline-variant bg-tertiary-container text-on-tertiary-container"
      : "border-source-outline bg-primary-container-low text-on-primary-container hover:bg-primary-container";
  return (
    <button
      disabled={!src}
      onClick={() => src && onOpen(src)}
      title={src?.title}
      className={`inline-flex h-[24px] max-w-[16em] items-center gap-[5px] rounded-sm border pl-[6px] pr-[8px] align-middle text-[14px] font-semibold tracking-[0.01em] ${tone}`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden className="shrink-0">
        {email ? (
          <>
            <rect x="1.5" y="2.5" width="9" height="7" rx="0.5" />
            <path d="M2 3l4 3 4-3" />
          </>
        ) : (
          <path d="M3 1h4l2 2v8H3z" />
        )}
      </svg>
      <span className="truncate">{src ? src.title.replace(/\s*\(DEMO.*$/, "") : "Source not found"}</span>
    </button>
  );
}

// Tiny renderer: paragraphs, bullets, tables, **bold**, and [content_id] citations as source chips.
export function Markdown({ text, sources, onOpen }: { text: string; sources: Map<string, Source>; onOpen: (s: Source) => void }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|\[[^\]]+\])/g).map((part, i) => {
      if (part.startsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
      if (part.startsWith("[") && part.endsWith("]")) {
        const ids = part.slice(1, -1).split(/,\s*/);
        if (ids.every((id) => sources.has(id)))
          return (
            <span key={i} className="mx-0.5 inline-flex gap-1 align-middle">
              {ids.map((id) => (
                <SourceChip key={id} id={id} sources={sources} onOpen={onOpen} />
              ))}
            </span>
          );
      }
      return <span key={i}>{part}</span>;
    });
  return (
    <div className="space-y-3 leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        const tableAt = lines.findIndex((l, j) => l.trim().startsWith("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[j + 1] ?? ""));
        if (tableAt >= 0) {
          const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          const head = cells(lines[tableAt]);
          const body = lines.slice(tableAt + 2).filter((l) => l.trim().startsWith("|")).map(cells);
          return (
            <div key={i} className="space-y-2">
              {tableAt > 0 && <p>{inline(lines.slice(0, tableAt).join(" "))}</p>}
              <table className="w-full">
                <thead>
                  <tr>{head.map((h, j) => <th key={j} className="border-b border-outline-variant py-1 pr-3 text-left">{inline(h)}</th>)}</tr>
                </thead>
                <tbody>
                  {body.map((r, j) => (
                    <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-outline-variant py-1 pr-3 align-top">{inline(c)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-6">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>)}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""))}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function SourceDrawer({ source, onClose }: { source: Source | null; onClose: () => void }) {
  if (!source) return null;
  const label =
    source.provider === "senso"
      ? "From Senso (trusted context)"
      : source.provider === "local-fallback"
        ? "From local knowledge base (Senso offline)"
        : source.provider === "email"
          ? "From your email (demo inbox)"
          : "From the store listing";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-inverse-surface/40" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <Pill tone={source.provider === "email" ? "caution" : "brand"}>{label}</Pill>
          <Button kind="ghost" onClick={onClose}>Close</Button>
        </div>
        <h3 className="mt-4 font-serif text-[24px] font-semibold">{source.title}</h3>
        <p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed">{source.chunk_text}</p>
        <div className="mt-6 break-all font-mono text-xs text-on-surface-variant">{source.content_id}</div>
      </aside>
    </div>
  );
}

export function ics(r: { date: string; title: string; details: string }) {
  const d = r.date.replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kin//EN", "BEGIN:VEVENT",
    `UID:${d}-${Math.random().toString(36).slice(2)}@kin`, `DTSTART;VALUE=DATE:${d}`,
    `SUMMARY:${r.title}`, `DESCRIPTION:${r.details.replace(/\n/g, "\\n")}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const store = {
  get<T>(key: string): T | undefined {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : undefined;
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

// Official photo if a teammate drops public/products/<sku>.jpg; otherwise a labeled style illustration.
export function ProductImage({ sku, style, size = 120 }: { sku: string; style: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/products/${sku}.jpg`} alt="" width={size} height={size} onError={() => setFailed(true)}
        className="shrink-0 rounded-lg bg-surface-container object-contain" style={{ width: size, height: size }} />
    );
  const bte = /behind/i.test(style);
  const canal = /canal/i.test(style) && !bte;
  return (
    <div className="relative shrink-0 rounded-lg bg-primary-container" style={{ width: size, height: size }} title="Illustration of the device style">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-label={`Illustration: ${style}`}>
        {bte ? (
          <>
            <path d="M58 18c14 0 22 12 18 30-3 13-10 20-16 20" fill="none" stroke="#0b6e75" strokeWidth="10" strokeLinecap="round" />
            <path d="M60 68c-6 4-14 8-22 8" fill="none" stroke="#475467" strokeWidth="3" />
            <circle cx="34" cy="77" r="7" fill="#101828" />
          </>
        ) : canal ? (
          <>
            <rect x="36" y="30" width="28" height="40" rx="14" fill="#101828" />
            <rect x="44" y="64" width="12" height="12" rx="5" fill="#0b6e75" />
          </>
        ) : (
          <>
            <ellipse cx="46" cy="50" rx="22" ry="20" fill="#101828" />
            <ellipse cx="66" cy="52" rx="10" ry="9" fill="#0b6e75" />
            <circle cx="40" cy="46" r="4" fill="#e6f4f5" />
          </>
        )}
      </svg>
      <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] font-bold text-primary">illustration</span>
    </div>
  );
}
