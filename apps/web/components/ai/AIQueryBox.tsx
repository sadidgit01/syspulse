"use client";

import { Bot, MessageSquareText, SendHorizonal, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAI } from "@/lib/api";
import { cn } from "@/lib/utils";

const HISTORY_KEY = "syspulse:ai-query-history";
const MAX_HISTORY = 5;

export function AIQueryBox() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [animatedAnswer, setAnimatedAnswer] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        setHistory(parsed.slice(0, MAX_HISTORY));
      }
    } catch {
      window.localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (!answer) {
      setAnimatedAnswer("");
      return;
    }

    let index = 0;
    setAnimatedAnswer("");
    const intervalId = window.setInterval(() => {
      index += 1;
      setAnimatedAnswer(answer.slice(0, index));
      if (index >= answer.length) {
        window.clearInterval(intervalId);
      }
    }, 12);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [answer]);

  const quickQuestions = useMemo(() => history.slice(0, MAX_HISTORY), [history]);

  const runQuery = async (rawQuestion: string) => {
    const trimmedQuestion = rawQuestion.trim();
    if (!trimmedQuestion || isLoading) {
      return;
    }
    setIsLoading(true);
    setError(null);
    setAnswer("");

    try {
      const response = await askAI(trimmedQuestion);
      setAnswer(response);
      setHistory((current) => {
        const nextHistory = [trimmedQuestion, ...current.filter((entry) => entry !== trimmedQuestion)].slice(
          0,
          MAX_HISTORY
        );
        if (typeof window !== "undefined") {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
        }
        return nextHistory;
      });
      setQuestion("");
    } catch {
      setError("AI unavailable right now");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runQuery(question);
  };

  const handleQuickAsk = async (nextQuestion: string) => {
    setQuestion(nextQuestion);
    setOpen(true);
    await runQuery(nextQuestion);
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-4 z-40 flex w-full max-w-[calc(100vw-2rem)] justify-end sm:right-6 lg:right-10">
      {open ? (
        <div className="pointer-events-auto w-full max-w-md rounded-[30px] border border-blue-500/18 bg-[#08101f]/94 shadow-[0_24px_100px_rgba(2,6,23,0.54)] backdrop-blur-2xl">
          <div className="flex items-start justify-between border-b border-white/8 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">SysPulse AI</p>
              <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
                <Sparkles className="h-4 w-4 text-blue-300" />
                Ask about your infrastructure
              </h3>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close AI query box" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <form id="syspulse-ai-query-form" className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about your infrastructure..."
                className="h-12 rounded-2xl border-white/10 bg-white/[0.04] text-white placeholder:text-slate-500"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Bound to the last 30 minutes of org context.</p>
                <Button
                  type="submit"
                  disabled={isLoading || question.trim().length === 0}
                  className="rounded-2xl bg-blue-500 text-white shadow-[0_0_24px_rgba(59,130,246,0.32)] hover:bg-blue-400"
                >
                  <SendHorizonal className="mr-2 h-4 w-4" />
                  Ask
                </Button>
              </div>
            </form>

            {quickQuestions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Recent questions</p>
                <div className="flex flex-wrap gap-2">
                  {quickQuestions.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 transition hover:border-blue-400/30 hover:bg-blue-500/[0.08]"
                      onClick={() => {
                        void handleQuickAsk(entry);
                      }}
                    >
                      {entry}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                <Bot className="h-4 w-4 text-blue-300" />
                Response
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <span>Thinking</span>
                  <TypingDots />
                </div>
              ) : error ? (
                <p className="text-sm text-red-200">{error}</p>
              ) : animatedAnswer ? (
                <p className="text-sm leading-6 text-slate-200">{animatedAnswer}</p>
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  Ask what changed, which node looks unhealthy, or what risk is building next.
                </p>
              )}
            </div>
          </div>
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

function TypingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-blue-300 animate-pulse"
          style={{ animationDelay: `${dot * 120}ms` }}
        />
      ))}
    </span>
  );
}
