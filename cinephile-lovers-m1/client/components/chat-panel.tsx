"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";

import type { ChatMessage, SlotId } from "@/lib/room-socket";

const MAX_TEXT = 500;

type ChatPanelProps = {
  messages: ChatMessage[];
  youSlot: SlotId;
  disabled: boolean;
  onSend: (text: string) => void;
};

/**
 * Minimal two-person chat (M4). Rendering is driven ENTIRELY by the
 * server's chat:message broadcasts (no local echo — docs/socket-events.md
 * §4), so both sides see identical order and timestamps.
 */
export function ChatPanel({ messages, youSlot, disabled, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length]);

  function submit(): void {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
      aria-label="Chat"
    >
      <p className="text-sm font-medium">Whisper</p>

      <div ref={listRef} className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="text-xs text-muted">
            Nothing said yet. The last 50 lines are kept while the room lives.
          </p>
        ) : null}
        {messages.map((message) => {
          const mine = message.from === youSlot;
          return (
            <div
              key={message.id}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                  mine
                    ? "bg-btn-red text-ink"
                    : "border border-line bg-elevated text-ink"
                }`}
              >
                {message.text}
              </p>
              <p className="mt-0.5 px-1 text-[10px] uppercase tracking-wide text-muted">
                {mine ? "You" : "Partner"} ·{" "}
                {new Date(message.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={MAX_TEXT}
          disabled={disabled}
          placeholder={disabled ? "Reconnecting…" : "Say something…"}
          aria-label="Chat message"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="min-w-0 flex-1 rounded-xl border border-line bg-base px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || draft.trim().length === 0}
          aria-label="Send chat message"
          className="inline-flex min-h-11 flex-none items-center justify-center gap-2 rounded-xl bg-btn-red px-4 text-sm font-semibold text-ink transition-colors hover:bg-btn-red-deep disabled:opacity-50"
        >
          <SendHorizontal size={16} aria-hidden="true" />
          Send
        </button>
      </div>
      <p className="text-[10px] text-muted">
        {draft.length}/{MAX_TEXT}
      </p>
    </section>
  );
}