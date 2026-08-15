'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, User, ShieldCheck, MapPin, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { BasicInfoStep } from './basic-info-step';
import { KYCStep } from './kyc-step';
import { LGAStep } from './lga-step';
import { DeviceStep } from './device-step';

// ─── Step Config ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

const STEP_META = [
  { label: 'Profile', icon: User },
  { label: 'KYC', icon: ShieldCheck },
  { label: 'Coverage', icon: MapPin },
  { label: 'Device', icon: Smartphone },
] as const;

// ─── Animation Variants ────────────────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

// ─── Component ──────────────────────────────────────────────────────────────

export function OnboardingFlow() {
  const step = useAppStore((s) => s.onboardingStep);
  const setStep = useAppStore((s) => s.setOnboardingStep);

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS) setStep(step + 1);
  }, [step, setStep]);

  const goBack = useCallback(() => {
    if (step > 1) setStep(step - 1);
  }, [step, setStep]);

  // Direction for animation
  // We track via a ref-like approach: store the previous step in a simple way
  // Since we can't use a ref easily with store, we always animate forward for now
  // and the AnimatePresence handles exit.
  const direction = 1;

  function renderStep() {
    switch (step) {
      case 1:
        return <BasicInfoStep onNext={goNext} />;
      case 2:
        return <KYCStep onNext={goNext} />;
      case 3:
        return <LGAStep onNext={goNext} />;
      case 4:
        return <DeviceStep />;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col min-h-dvh bg-gray-50">
      {/* Stepper Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          {step > 1 ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={goBack}
              className="min-w-[44px] min-h-[44px] -ml-2"
              aria-label="Go back"
            >
              <ArrowLeft className="size-5" />
            </Button>
          ) : (
            <div className="w-[44px]" />
          )}
          <h1 className="text-base font-bold text-gray-900">
            Step {step} of {TOTAL_STEPS}
          </h1>
          <div className="w-[44px]" />
        </div>

        {/* Progress Dots + Labels */}
        <div className="flex items-center gap-1">
          {STEP_META.map((meta, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === step;
            const isComplete = stepNum < step;
            const Icon = meta.icon;

            return (
              <div key={stepNum} className="flex-1 flex flex-col items-center gap-1.5">
                {/* Dot / Icon circle */}
                <div
                  className={[
                    'flex items-center justify-center rounded-full transition-all duration-300',
                    isActive
                      ? 'w-10 h-10 bg-emerald-600 text-white shadow-md scale-110'
                      : isComplete
                        ? 'w-8 h-8 bg-emerald-500 text-white'
                        : 'w-8 h-8 bg-gray-200 text-gray-400',
                  ].join(' ')}
                >
                  {isComplete ? (
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <Icon className="size-4" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={[
                    'text-[10px] font-semibold leading-tight text-center',
                    isActive ? 'text-emerald-700' : isComplete ? 'text-emerald-600' : 'text-gray-400',
                  ].join(' ')}
                >
                  {meta.label}
                </span>

                {/* Connector line (except last) */}
                {idx < STEP_META.length - 1 && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 -z-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500 rounded-full"
            initial={false}
            animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 flex items-start justify-center px-4 py-5 overflow-y-auto">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
