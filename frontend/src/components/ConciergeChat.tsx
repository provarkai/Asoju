'use client';

import { FormEvent, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConciergeResponse {
  reply: string;
  escalate: string;
  conversationComplete: boolean;
  serviceRequestId: string | null;
}

interface AutomationDecision {
  outcome: 'AUTO' | 'CUSTOMER_INPUT' | 'ESCALATE' | 'UNSUPPORTED' | 'BLOCKED' | null;
}

// Section 7.2, Message 1 — greeting + AI disclosure, shown immediately
// without a round-trip so the "AI must disclose within its first 2
// messages" rule (Section 7.1) is satisfied the instant the chat opens.
const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Hi! 👋 Thanks for reaching out to ASOJU. I'm the AI Concierge — I'll ask a few quick questions so we can get the right people handling this for you. Takes about 2 minutes. What would you like us to handle for you in Nigeria?",
};

// docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — this is now the
// authenticated customer's primary intake (mounted as dashboard/new's
// first step), not dead code sitting unused. On a completed conversation
// it checks whether the request the Concierge just created was eligible
// for AUTO — the pilot service type (currently BUSINESS_VERIFICATION;
// see AutomationCapability admin config) auto-creates a real Case with no
// staff click at all (CasesService.autoConvert), so there's nothing left
// for the customer to fill in. Every other outcome hands off to the
// existing manual wizard exactly the way the pre-login landing demo
// already does (same transcript-to-rawDescription shape) — the AI never
// invents structured fields the backend doesn't already expose to this
// client.
export function ConciergeChat({
  onHandoff,
  onAutoCreated,
  onSkip,
}: {
  onHandoff: (draft: { description: string }) => void;
  onAutoCreated: () => void;
  onSkip: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || resolving) return;

    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: input }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const result = await apiFetch<ConciergeResponse>('/ai/concierge/message', {
        method: 'POST',
        body: JSON.stringify({
          message: input,
          // Skip the local-only greeting — it never went through the model.
          history: nextMessages.slice(1, -1),
        }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);

      if (result.conversationComplete) {
        setResolving(true);
        const transcript = [...nextMessages, { role: 'assistant' as const, content: result.reply }]
          .map((m) => m.content)
          .join(' ');

        let outcome: AutomationDecision['outcome'] = null;
        if (result.serviceRequestId) {
          try {
            const decision = await apiFetch<AutomationDecision>(`/service-requests/${result.serviceRequestId}/automation-decision`);
            outcome = decision?.outcome ?? null;
          } catch {
            /* no decision yet, or the request failed to score — fall through to the manual handoff below, same as if AUTO never applied */
          }
        }

        if (outcome === 'AUTO') {
          onAutoCreated();
        } else {
          onHandoff({ description: transcript });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI Concierge is unavailable right now — please try again shortly.');
      setResolving(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-3xl border border-forest/10 bg-white p-6 shadow-lg shadow-forest/5 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-clay">
          <MessageCircle className="size-4" />
          Chat with the AI Concierge
        </p>
        <button type="button" onClick={onSkip} className="text-xs font-medium text-forest/50 underline-offset-2 hover:text-forest hover:underline">
          I&apos;d rather fill this out myself
        </button>
      </div>

      <div className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto rounded-2xl bg-ivory/60 p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
              m.role === 'assistant' ? 'self-start bg-white text-forest shadow-sm' : 'self-end bg-forest text-ivory',
            )}
          >
            {m.content}
          </div>
        ))}
        {(sending || resolving) && (
          <div className="self-start rounded-2xl bg-white px-4 py-2.5 text-sm text-forest/50 shadow-sm">
            <Loader2 className="inline size-3.5 animate-spin" /> {resolving ? 'One moment…' : 'Typing…'}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message…"
          disabled={sending || resolving}
          className="flex-1 rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white"
        />
        <Button type="submit" disabled={sending || resolving || !input.trim()} className="bg-forest text-ivory hover:bg-forest-deep">
          <Send className="size-4" />
          Send
        </Button>
      </form>
      {error && <p className="error-text mt-3">{error}</p>}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-forest/45">
        <Sparkles className="size-3" />
        I&apos;m AI, not a human team member — everything you tell me is reviewed before anything is scheduled.
      </p>
    </div>
  );
}
