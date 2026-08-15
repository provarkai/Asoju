'use client';

import { useState } from 'react';

// A scripted, static preview of the AI Concierge for signed-out visitors on
// the landing page. It does not call the real /ai/concierge/message
// endpoint — that requires an authenticated CUSTOMER (see
// backend/src/ai/ai.controller.ts) — so this just shows what the real
// conversation looks like, then hands off to sign-up for the live version
// (see ConciergeChat, used post-login on the dashboard home).

type DemoMsg = { role: 'assistant' | 'user'; text: string };

const GREETING =
  "Hi 👋 — I'm the ASOJU AI Concierge. Tell me, in your own words, what you need handled back home: a plot to verify, a building site to supervise, family errands, procurement… I'll ask a couple of quick questions, then get you a real quote.";

const QUICK_PROMPTS = [
  {
    prompt: 'Verify a plot of land in Ibeju-Lekki before I pay the balance',
    reply:
      "Got it — a property verification in Ibeju-Lekki. I'll need the address or a description of how to find it, and whether there's anything specific you want checked (boundaries, existing structures, occupants). Once our team confirms scope, you'll get a line-item quote before anything is scheduled.",
    quote: {
      label: 'Property Inspection & Verification — Ibeju-Lekki',
      lines: [
        { label: 'ASOJU service fee', amount: '₦85,000' },
        { label: 'Site access & transport', amount: '₦12,000' },
      ],
      total: '₦97,000',
    },
  },
  {
    prompt: 'Monitor my building project in Abuja',
    reply:
      "Understood — recurring construction supervision in Abuja. I'll ask for the site address, current build stage, and how often you'd like a visit (weekly, biweekly, or milestone-based). Each visit comes back with dated photo/video evidence and a plain-language progress note.",
    quote: {
      label: 'Construction / Project Supervision — Abuja',
      lines: [
        { label: 'ASOJU service fee (per visit)', amount: '₦125,000' },
        { label: 'Site access & transport', amount: '₦18,000' },
      ],
      total: '₦143,000',
    },
  },
  {
    prompt: "Check my father's farm in Oyo",
    reply:
      "Understood — an asset inspection for the farm in Oyo. Let me know what you'd like confirmed (condition, activity, any specific concern your father raised) and I'll route it to a representative in that area.",
    quote: {
      label: 'Asset / Project Inspection — Oyo',
      lines: [
        { label: 'ASOJU service fee', amount: '₦60,000' },
        { label: 'Site access & transport', amount: '₦15,000' },
      ],
      total: '₦75,000',
    },
  },
];

export function ConciergeDemo({ signedIn }: { signedIn: boolean }) {
  const [messages, setMessages] = useState<DemoMsg[]>([{ role: 'assistant', text: GREETING }]);
  const [quote, setQuote] = useState<(typeof QUICK_PROMPTS)[number]['quote'] | null>(null);
  const [used, setUsed] = useState(false);

  function runPrompt(option: (typeof QUICK_PROMPTS)[number]) {
    if (used) return;
    setUsed(true);
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: option.prompt },
      { role: 'assistant', text: option.reply },
    ]);
    setQuote(option.quote);
  }

  return (
    <div className="concierge-demo">
      <div className="concierge-demo__header">
        <span className="concierge-demo__dot" />
        ASOJU AI Concierge — preview
      </div>
      <div className="concierge-demo__body chat">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`chat-bubble ${m.role === 'assistant' ? 'chat-bubble--assistant' : 'chat-bubble--user'}`}
          >
            {m.text}
          </div>
        ))}
        {quote && (
          <div className="concierge-demo__quote">
            <strong>{quote.label}</strong>
            <div style={{ marginTop: '0.6rem' }}>
              {quote.lines.map((l) => (
                <div className="concierge-demo__quote-line" key={l.label}>
                  <span>{l.label}</span>
                  <span>{l.amount}</span>
                </div>
              ))}
            </div>
            <div className="concierge-demo__quote-line" style={{ fontWeight: 700 }}>
              <span>Total</span>
              <span>{quote.total}</span>
            </div>
          </div>
        )}
      </div>
      {!used ? (
        <div className="concierge-demo__prompts">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.prompt}
              type="button"
              className="concierge-demo__prompt"
              onClick={() => runPrompt(p)}
            >
              {p.prompt}
            </button>
          ))}
        </div>
      ) : (
        <div className="concierge-demo__prompts">
          <a href={signedIn ? '/' : '/register'} className="btn" style={{ width: '100%' }}>
            {signedIn ? 'Start a real request' : 'Sign up to start a real request'}
          </a>
        </div>
      )}
    </div>
  );
}
