'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantResponse {
  reply: string;
}

const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Hi — I'm ASOJU's assistant. Ask me about your cases, your subscription, or anything saved on your account. I can only answer, not take action — for that, use your dashboard or a team member.",
};

/**
 * Section 12 P2 "personal AI assistant" — distinct from ConciergeChat: this
 * one only answers questions grounded in the signed-in customer's own
 * account data (see AiService.assistantReply), never creates a request.
 */
export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: input }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    try {
      const result = await apiFetch<AssistantResponse>('/ai/assistant/message', {
        method: 'POST',
        body: JSON.stringify({
          message: input,
          history: nextMessages.slice(1),
        }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant is unavailable right now — please try again shortly.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Ask ASOJU</h2>
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="chat-bubble chat-bubble--assistant muted">Typing…</div>}
      </div>

      <form onSubmit={onSubmit} style={{ marginTop: '1rem', maxWidth: 'none' }}>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <input
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. What's the status of my latest case?"
            disabled={sending}
          />
          <button className="btn" type="submit" disabled={sending || !input.trim()}>
            Send
          </button>
        </div>
      </form>
      {error && <p className="error-text" style={{ marginTop: '0.75rem' }}>{error}</p>}
    </div>
  );
}
