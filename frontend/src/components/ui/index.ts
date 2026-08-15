// Design-system component library (Sprint 1 — docs/frontend-handoff-v1.0/
// 03_Design_System). Single import surface so pages compose from shared
// primitives instead of hand-rolling className strings, per that spec's
// "build shared primitives once; compose pages from them."

export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { Input, Textarea } from './Field';
export type { InputProps, TextareaProps } from './Field';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Badge, StatusBadge, CASE_STATUS_TONE, PAYMENT_STATUS_TONE } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Modal } from './Modal';
export type { ModalProps } from './Modal';

export { Accordion } from './Accordion';
export type { AccordionItem } from './Accordion';

export { ToastProvider, useToast } from './Toast';
export type { ToastTone } from './Toast';

export { Skeleton, SkeletonText, SkeletonCard } from './Skeleton';

export { ErrorState } from './ErrorState';
