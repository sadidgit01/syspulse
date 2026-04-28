"use client";

import {
  Bot,
  HeartPulse,
  MessageSquareText,
  SendHorizonal,
  Sparkles,
  X
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Button } from "@/components/ui/button";
import { askAI, getAIHealthScore } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AIHealthScoreBackendResponse, ChatMessage } from "@/types";

const MESSAGE_HISTORY_KEY = "syspulse:ai-chat-messages";
const MAX_MESSAGES = 10;
const MAX_PERSISTED_MESSAGES = 5;
const TYPEWRITER_DELAY_MS = 15;
const SUGGESTIONS = [
  "How is my fleet right now?",
  "Any anomalies in the last hour?",
  "What's my memory trend?",
  "Is anything about to break?"
] as const;

export function AIQueryBox() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthScore, setHealthScore] = useState<AIHealthScoreBackendResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(MESSAGE_HISTORY_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setMessages(parsed.map(parseStoredMessage).filter(isChatMessage).slice(-MAX_MESSAGES));
      }
    } catch {
      window.localStorage.removeItem(MESSAGE_HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const persisted = messages.slice(-MAX_PERSISTED_MESSAGES).map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString()
    }));
    window.localStorage.setItem(MESSAGE_HISTORY_KEY, JSON.stringify(persisted));
  }, [messages]);

  useEffect(() => {
    const refreshHealthScore = async () => {
      try {
        setHealthScore(await getAIHealthScore());
      } catch {
        setHealthScore(null);
      }
    };

    void refreshHealthScore();
    const intervalId = window.setInterval(() => {
      void refreshHealthScore();
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, streamingMessage, isWaiting, error]);

  const visibleMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages),
    [messages, streamingMessage]
  );
  const isBusy = isWaiting || streamingMessage !== null;

  const runQuery = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || isBusy) {
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
      timestamp: new Date()
    };
    setOpen(true);
    setMessages((current) => trimMessages([...current, userMessage]));
    setDraft("");
    setError(null);
    setIsWaiting(true);

    try {
      const response = await askAI(question);
      setIsWaiting(false);
      await animateAssistantResponse(response);
    } catch {
      setIsWaiting(false);
      setError("AI unavailable right now");
    }
  };

  const animateAssistantResponse = async (content: string) => {
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date()
    };

    setStreamingMessage(assistantMessage);
    for (let index = 1; index <= content.length; index += 1) {
      await wait(TYPEWRITER_DELAY_MS);
      setStreamingMessage({
        ...assistantMessage,
        content: content.slice(0, index)
      });
    }

    setMessages((current) =>
      trimMessages([
        ...current,
        {
          ...assistantMessage,
          content
        }
      ])
    );
    setStreamingMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runQuery(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runQuery(draft);
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-4 z-40 flex w-full max-w-[calc(100vw-2rem)] justify-end sm:right-6 lg:right-10">
      {open ? (
        <div className="pointer-events-auto flex h-[min(720px,calc(100vh-3rem))] w-full max-w-xl flex-col overflow-hidden rounded-[32px] border border-blue-500/20 bg-[#07101f]/96 shadow-[0_24px_120px_rgba(2,6,23,0.68)] backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">SysPulse AI</p>
              <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
                <Sparkles className="h-4 w-4 text-blue-300" />
                Infrastructure copilot
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <HealthBadge healthScore={healthScore} />
              <Button variant="ghost" size="icon" aria-label="Close AI query box" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {visibleMessages.length === 0 && !isWaiting ? (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-blue-500/16 bg-blue-500/[0.06] p-4">
                  <p className="text-sm font-medium text-white">Ask me like your on-call SRE.</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    I can read live metrics, recent errors, anomalies, forecasts, and open incidents.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 transition hover:border-blue-400/40 hover:bg-blue-500/[0.1]"
                      onClick={() => {
                        void runQuery(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {visibleMessages.map((message, index) => (
              <ChatBubble key={`${message.timestamp.toISOString()}-${index}`} message={message} />
            ))}

            {isWaiting ? (
              <div className="flex items-end gap-3">
                <AssistantAvatar />
                <div className="rounded-3xl rounded-bl-lg border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                  <span>SysPulse AI is thinking</span>
                  <TypingDots />
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}
          </div>

          <form className="border-t border-white/8 p-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-2 transition focus-within:border-blue-400/40">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about CPU, memory, incidents, errors..."
                rows={2}
                className="max-h-32 min-h-12 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-slate-500"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <p className="text-[11px] text-slate-500">Enter sends. Shift+Enter adds a line.</p>
                <Button
                  type="submit"
                  disabled={isBusy || draft.trim().length === 0}
                  className="rounded-2xl bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,0.32)] hover:bg-blue-400"
                >
                  <SendHorizonal className="mr-2 h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "pointer-events-auto inline-flex items-center gap-3 rounded-full border border-blue-500/20 bg-[#0b1426]/92 px-4 py-3 text-sm font-medium text-white shadow-[0_0_40px_rgba(59,130,246,0.18)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-[#0f1a31]"
          )}
          onClick={() => setOpen(true)}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/16 text-blue-200">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div className="text-left">
            <p className="text-xs uppercase tracking-[0.18em] text-blue-200/70">AI query</p>
            <p className="text-sm text-white">Ask about your infrastructure</p>
          </div>
        </button>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex items-end gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? <AssistantAvatar /> : null}
      <div
        className={cn(
          "max-w-[82%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm",
          isUser
            ? "rounded-br-lg bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,0.2)]"
            : "rounded-bl-lg border border-white/8 bg-white/[0.04] text-slate-200"
        )}
      >
        <p>{message.content}</p>
        <p className={cn("mt-2 text-[10px]", isUser ? "text-blue-100/70" : "text-slate-500")}>
          {formatMessageTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/12 text-blue-200">
      <Bot className="h-4 w-4" />
    </div>
  );
}

function HealthBadge({ healthScore }: { healthScore: AIHealthScoreBackendResponse | null }) {
  const score = healthScore?.score;
  const tone =
    score === undefined
      ? "border-white/10 bg-white/[0.04] text-slate-300"
      : score >= 91
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : score >= 71
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : "border-red-500/30 bg-red-500/10 text-red-100";

  return (
    <div className={cn("flex items-center gap-2 rounded-full border px-3 py-2 text-xs", tone)}>
      <HeartPulse className="h-3.5 w-3.5" />
      <span>{score === undefined ? "Syncing" : `${score}/100`}</span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-300"
          style={{ animationDelay: `${dot * 120}ms` }}
        />
      ))}
    </span>
  );
}

function parseStoredMessage(value: unknown): ChatMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = record.role;
  const content = record.content;
  const timestamp = record.timestamp;
  if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
    return null;
  }
  const parsedDate = new Date(String(timestamp));
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return {
    role,
    content,
    timestamp: parsedDate
  };
}

function isChatMessage(value: ChatMessage | null): value is ChatMessage {
  return value !== null;
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}
