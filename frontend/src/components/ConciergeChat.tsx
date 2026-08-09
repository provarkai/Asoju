'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

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

// Section 7.2, Message 1 — greeting + AI disclosure, shown immediately
// without a round-trip so the "AI must disclose within its first 2
// messages" rule (Section 7.1) is satisfied the instant the chat opens.
const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Hi! 👋 Thanks for reaching out to ASOJU. I'm the AI Concierge — I'll ask a few quick questions so we can get the right people handling this for you. Takes about 2 minutes. What would you like us to handle for you in Nigeria?",
};

export function ConciergeChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || complete) return;

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
      if (result.conversationComplete) setComplete(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'The AI Concierge is unavailable right now — please try again shortly.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="chat-bubble chat-bubble--assistant muted">Typing…</div>}
      </div>

      {complete ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          Thanks — one of our team will confirm scope and next steps shortly. You can track this from
          your dashboard once it becomes a case.
        </p>
      ) : (
        <form onSubmit={onSubmit} style={{ marginTop: '1rem', maxWidth: 'none' }}>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <input
              style={{ flex: 1 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message…"
              disabled={sending}
            />
            <button className="btn" type="submit" disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
      {error && <p className="error-text" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  );
}
