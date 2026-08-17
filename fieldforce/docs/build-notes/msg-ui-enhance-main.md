---
Task ID: msg-ui-enhance
Agent: Main Agent
Task: Enhance ASOJU FieldForce messaging UI components

Work Log:
- Read all 7 existing messaging component files + use-chat hook + BFF route
- Enhanced types.ts: added ChatReaction interface, extended ChatMessage with reply_to_id, deleted, _replyTo, _reactions fields, added last_message_type and last_message_is_reply to ChatThread, added formatDateSeparator() and isSameDay() helper functions
- Enhanced chat-window.tsx with 6 major features:
  - Date Separators: messages grouped by calendar day with "Today", "Yesterday", or "Mon, Jan 15" labels
  - Scroll-to-Bottom FAB: ArrowDown button appears when user scrolls >200px from bottom
  - Image Preview: image/* files render as max-h-48 thumbnails; click opens Dialog lightbox
  - Reply-to Quotes: colored left-border quote block showing sender name + truncated content, clickable to scroll to original
  - Message Reactions: emoji pills below bubbles showing emoji + count, grouped per emoji, with own-reaction highlight
  - Deleted Messages: centered "This message was deleted" placeholder
  - Message Actions: hover menu (Reply, React via Popover with 8 emoji, Delete for own messages)
- Enhanced chat-input.tsx: reply-to UI bar with sender name, truncated preview, X cancel button, placeholder text change when replying, new props (replyTo, onCancelReply, onSendReply)
- Enhanced chat-admin-view.tsx: unread count Badge next to "Admin Messaging" label, filter tabs renamed (ALL→All, DIRECT→Direct, RELAYED→Supervised)
- Enhanced chat-list.tsx: Paperclip icon for FILE threads, Reply icon for reply threads using new ChatThread optional fields
- Updated chat-view.tsx and chat-customer-view.tsx to pass new replyTo/onSetReplyTo/onDeleteMessage/onAddReaction props
- ESLint passes with zero errors/warnings
- Dev server compiles cleanly

Stage Summary:
- 7 files modified (types.ts, chat-window.tsx, chat-input.tsx, chat-admin-view.tsx, chat-list.tsx, chat-view.tsx, chat-customer-view.tsx)
- All new UI features are client-side only and backward compatible (new fields are optional)
- No backend changes required — new fields are populated server-side when ready
