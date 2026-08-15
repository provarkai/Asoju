'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, RotateCcw, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { trackConciergeEvent } from '@/lib/analytics';
import { Button } from '@/components/ui/button';

type UiMsg =
  | { id: number; kind: 'text'; role: 'user' | 'assistant'; text: string; rated?: 'up' | 'down' }
  | { id: number; kind: 'captured'; role: 'assistant' }
  | { id: number; kind: 'error'; retryText: string };

const DRAFT_STORAGE_KEY = 'asoju-concierge-draft';

interface DemoTurnResult {
  reply: string;
  escalate: string;
  conversationComplete: boolean;
}

const DEFAULT_GREETING =
  "Hi 👋 — I'm the ASOJU AI Concierge. Tell me, in your own words, what you need handled back home: a plot or property to verify, a building site to supervise, family errands, procurement… I'll ask a couple of quick questions to capture the essentials.";

const DEFAULT_QUICK_PROMPTS = [
  'Verify a plot of land in Ibeju-Lekki before I pay the balance',
  'Monitor my building project in Abuja',
  "Check my father's farm in Oyo",
  'Buy and deliver 10 bags of cement to Enugu',
];

// This is a public preview (backend: AiPublicController.sendDemoMessage,
// throttled per-IP — see ai.controller.ts) — the conversational capture
// is real, but unlike the original asoju-app-main prototype this never
// shows an AI-generated quote or lets the chat create a case directly.
// This app's real backend always has a human issue the actual quote
// after triage (never the AI) — the prototype's own inline "Accept &
// create my case" quote card would have contradicted that, so completion
// here routes to sign-in instead, same as every other "do something
// real" action in this app.
//
// greeting/quickPrompts are optional overrides — the shared service-page
// shell (Sprint 5/6) passes service-specific ones so the same widget
// feels tailored per page without a second implementation; both default
// to the general landing-page copy above when omitted.
export default function AiConciergeDemo({
  isAuthenticated,
  onNavigate,
  greeting = DEFAULT_GREETING,
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  source = 'homepage',
}: {
  isAuthenticated: boolean;
  onNavigate: (path: string) => void;
  greeting?: string;
  quickPrompts?: string[];
  /** Which page embeds this widget — 'homepage' or a service slug (see
   * ServicePageShell). Analytics metadata only, never rendered. */
  source?: string;
}) {
  const [messages, setMessages] = useState<UiMsg[]>([
    { id: 0, kind: 'text', role: 'assistant', text: greeting },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const idRef = useRef(1);
  const turnRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  // Fires once per mount, not per render (the widget mounts once per page
  // visit — StrictMode's dev-only double-invoke is the one exception,
  // acceptable noise for a usage counter, not worth guarding against).
  useEffect(() => {
    trackConciergeEvent('CONCIERGE_OPENED', { source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextId = () => idRef.current++;

  const toHistory = (msgs: UiMsg[]) =>
    msgs
      .filter((m): m is Extract<UiMsg, { kind: 'text' }> => m.kind === 'text')
      .map((m) => ({ role: m.role, content: m.text }));

  // Sprint 2 "safe draft persistence for the authentication handoff" —
  // the demo endpoint (AiPublicController, no session) can't create a
  // real ServiceRequest, so once the conversation is captured we stash
  // the transcript in sessionStorage. dashboard/new/page.tsx reads this
  // same key on mount and pre-fills its description step, so a visitor
  // who signs in right after doesn't have to retype what they already
  // told the concierge. sessionStorage (not localStorage): this is a
  // one-shot handoff for the current tab's visit, not a persistent draft
  // to resurrect on a later, unrelated session.
  const persistDraft = (msgs: UiMsg[]) => {
    try {
      const transcript = msgs
        .filter((m): m is Extract<UiMsg, { kind: 'text' }> => m.kind === 'text')
        .map((m) => `${m.role === 'user' ? 'You' : 'Concierge'}: ${m.text}`)
        .join('\n\n');
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ description: transcript }));
    } catch {
      // Storage unavailable (private browsing, quota, disabled) — the
      // draft handoff is a convenience, never a requirement to continue.
    }
  };

  // `next` already includes the outgoing user turn — shared by send()
  // (which just added it) and retry() (which reuses the one already on
  // screen, rather than appending a second copy of the same message).
  const submitTurn = async (next: UiMsg[], content: string) => {
    setThinking(true);
    const turnNumber = ++turnRef.current;
    trackConciergeEvent('MESSAGE_SENT', { source, turnNumber });
    try {
      const res = await apiFetch<DemoTurnResult>('/ai/concierge/demo-message', {
        method: 'POST',
        body: JSON.stringify({ message: content, history: toHistory(next) }),
      });
      const replyMsg: UiMsg = { id: nextId(), kind: 'text', role: 'assistant', text: res.reply };
      const withReply = [...next, replyMsg];
      setMessages((m) => [...m, replyMsg]);
      if (res.conversationComplete) {
        setMessages((m) => [...m, { id: nextId(), kind: 'captured', role: 'assistant' }]);
        persistDraft(withReply);
      }
    } catch (e) {
      console.error(e);
      trackConciergeEvent('MESSAGE_FAILED', { source, turnNumber });
      // Retry state (Sprint 2) — re-sends exactly this message rather
      // than making the visitor retype it; the failed user turn stays
      // visible in `messages` above this card.
      setMessages((m) => [...m, { id: nextId(), kind: 'error', retryText: content }]);
    } finally {
      setThinking(false);
    }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || thinking) return;
    setInput('');
    const userMsg: UiMsg = { id: nextId(), kind: 'text', role: 'user', text: content };
    const next = [...messages, userMsg];
    setMessages(next);
    await submitTurn(next, content);
  };

  // No anonymous feedback endpoint (rating is tied to a real customer —
  // see ProfileService.recordConciergeFeedback) — thumbs up/down here
  // is a local acknowledgment only, not persisted.
  const rateReply = (msgId: number, rating: 'up' | 'down') => {
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, rated: rating } : x)));
  };

  const reset = () => {
    setMessages([{ id: nextId(), kind: 'text', role: 'assistant', text: greeting }]);
    setThinking(false);
    setInput('');
    // Starting over invalidates any draft from the previous conversation
    // — otherwise dashboard/new could resurrect a stale, unrelated draft
    // after the visitor deliberately abandoned this one.
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing to clean up */
    }
  };

  const retry = (msgId: number, retryText: string) => {
    if (thinking) return;
    trackConciergeEvent('RETRY_CLICKED', { source });
    const withoutError = messages.filter((x) => x.id !== msgId);
    setMessages(withoutError);
    submitTurn(withoutError, retryText);
  };

  const showChips = !thinking && messages.length <= 2;

  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-gold/25 via-transparent to-forest/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-3xl border border-forest/10 bg-white shadow-2xl shadow-forest/15">
        <div className="flex items-center gap-3 border-b border-forest/8 bg-forest px-5 py-4">
          <span className="relative flex size-9 items-center justify-center rounded-xl bg-gold/20 text-gold-light">
            <Sparkles className="size-5" />
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-forest" />
          </span>
          <div className="flex-1">
            <p className="font-display text-sm font-semibold leading-tight text-ivory">AI Concierge</p>
            <p className="text-[11px] text-ivory/60">{thinking ? 'Thinking…' : 'ASOJU · captures your request'}</p>
          </div>
          <button
            type="button"
            onClick={reset}
            aria-label="Start a new conversation"
            title="New conversation"
            className="rounded-lg p-2 text-ivory/70 transition-colors hover:bg-ivory/10 hover:text-ivory"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>

        <div className="h-[400px] space-y-3 overflow-y-auto bg-ivory/40 px-4 py-5 sm:h-[430px]">
          {messages.map((msg) =>
            msg.kind === 'captured' ? (
              <CapturedCard
                key={msg.id}
                isAuthenticated={isAuthenticated}
                onSignIn={() => onNavigate('/register?returnTo=%2Fdashboard%2Fnew')}
              />
            ) : msg.kind === 'error' ? (
              <ErrorCard key={msg.id} onRetry={() => retry(msg.id, msg.retryText)} />
            ) : (
              <Bubble key={msg.id} user={msg.role === 'user'} text={msg.text} />
            ),
          )}
          {messages.map((msg) =>
            msg.kind === 'text' && msg.role === 'assistant' && msg.text !== greeting && !thinking ? (
              <RatingRow key={`r-${msg.id}`} rated={msg.rated} onRate={(r) => rateReply(msg.id, r)} />
            ) : null,
          )}
          {thinking && <TypingDots />}
          <div ref={endRef} />
        </div>

        {showChips && (
          <div className="flex flex-wrap gap-2 border-t border-forest/8 bg-white px-4 pt-3">
            {quickPrompts.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  trackConciergeEvent('QUICK_PROMPT_CLICKED', { source, promptIndex: i });
                  send(p);
                }}
                className="rounded-full border border-forest/15 bg-ivory/60 px-3 py-1.5 text-left text-[11px] font-medium text-forest/75 transition-colors hover:border-forest/35 hover:bg-white"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-white px-4 py-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
            disabled={thinking}
            placeholder="Describe what needs handling back home…"
            className="h-10 flex-1 rounded-xl border border-forest/15 bg-ivory/50 px-3.5 text-sm text-forest placeholder:text-forest/40 focus:border-forest/40 focus:outline-none focus:ring-2 focus:ring-forest/10 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => send()}
            aria-label="Send message"
            disabled={!input.trim() || thinking}
            className="flex size-10 items-center justify-center rounded-xl bg-forest text-ivory shadow-sm transition-colors hover:bg-forest-deep disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-forest/55">
        <ShieldCheck className="size-4 shrink-0 text-forest" />
        AI Concierge captures &amp; recommends — a human team confirms scope, quote &amp; schedule.
      </div>
    </div>
  );
}

function Bubble({ user, text }: { user: boolean; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex ${user ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed shadow-sm ${
          user ? 'rounded-br-md bg-forest text-ivory' : 'rounded-bl-md border border-forest/10 bg-white text-forest/85'
        }`}
      >
        {text}
      </div>
    </motion.div>
  );
}

function RatingRow({ rated, onRate }: { rated?: 'up' | 'down'; onRate: (r: 'up' | 'down') => void }) {
  if (rated) {
    return (
      <div className="flex justify-start pl-4">
        <p className="text-[10px] text-forest/40">Thanks — this helps us improve.</p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 pl-4">
      <span className="text-[10px] text-forest/45">Was this helpful?</span>
      <button
        type="button"
        aria-label="Good reply"
        title="Good reply"
        onClick={() => onRate('up')}
        className="rounded-full border border-forest/15 bg-white p-1 text-forest/55 transition-colors hover:border-forest/40 hover:text-forest"
      >
        <ThumbsUp className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Poor reply"
        title="Poor reply"
        onClick={() => onRate('down')}
        className="rounded-full border border-forest/15 bg-white p-1 text-forest/55 transition-colors hover:border-clay/50 hover:text-clay"
      >
        <ThumbsDown className="size-3" />
      </button>
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex justify-start"
    >
      <div className="flex max-w-[85%] items-center justify-between gap-3 rounded-2xl rounded-bl-md border border-clay/30 bg-clay/5 px-4 py-2.5 text-[13px] leading-relaxed text-forest/80 shadow-sm">
        <span>Couldn&apos;t reach the concierge — connection hiccup.</span>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 rounded-full border border-clay/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-clay transition-colors hover:bg-clay/10"
        >
          <RotateCcw className="size-3" />
          Retry
        </button>
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-forest/10 bg-white px-4 py-3.5 shadow-sm">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-forest/50"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

function CapturedCard({ isAuthenticated, onSignIn }: { isAuthenticated: boolean; onSignIn: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex justify-end"
    >
      <div className="w-full max-w-[95%] overflow-hidden rounded-2xl border border-gold/35 bg-white shadow-md">
        <div className="flex items-center gap-1.5 border-b border-gold/20 bg-gold/10 px-4 py-2.5">
          <CheckCircle2 className="size-3.5 text-forest" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-clay">Request captured</p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[13px] leading-relaxed text-forest/75">
            Got it — our team will confirm scope and send you a real, transparent quote once you&apos;re signed in.
            Nothing&apos;s billed yet.
          </p>
          {!isAuthenticated && (
            <Button size="sm" className="mt-3 w-full bg-forest text-ivory hover:bg-forest-deep" onClick={onSignIn}>
              Sign in to continue
              <Sparkles className="size-4 text-gold-light" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
