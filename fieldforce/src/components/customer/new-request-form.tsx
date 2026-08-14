'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  FileText,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useCustomerContext } from './customer-shell';
import { authFetch } from '@/lib/auth-fetch';
import { SERVICE_TYPE_LABELS } from '@/lib/types';

const SERVICE_CODES = Object.keys(SERVICE_TYPE_LABELS);

interface FormData {
  serviceCode: string;
  title: string;
  description: string;
  locationAddress: string;
  locationLga: string;
  locationState: string;
  priority: 'NORMAL' | 'URGENT';
  specialInstructions: string;
}

const STEPS = [
  { id: 1, label: 'Service Type', icon: FileText },
  { id: 2, label: 'Details', icon: FileText },
  { id: 3, label: 'Location', icon: MapPin },
];

export default function NewRequestForm() {
  const { setActiveView, setProfile } = useCustomerContext();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState<FormData>({
    serviceCode: '',
    title: '',
    description: '',
    locationAddress: '',
    locationLga: '',
    locationState: '',
    priority: 'NORMAL',
    specialInstructions: '',
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const canProceed = () => {
    if (step === 1) return !!form.serviceCode;
    if (step === 2) return !!form.title.trim();
    if (step === 3) return true;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await authFetch('/api/customer/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceCode: form.serviceCode,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          locationAddress: form.locationAddress.trim() || undefined,
          locationLga: form.locationLga.trim() || undefined,
          locationState: form.locationState.trim() || undefined,
          priority: form.priority,
          urgency: form.priority === 'URGENT' ? 'URGENT' : 'STANDARD',
          specialInstructions: form.specialInstructions.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create request');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="py-10">
          <CardContent className="flex flex-col items-center justify-center gap-4 p-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-gray-900">Request Submitted!</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Your service request for <strong>{SERVICE_TYPE_LABELS[form.serviceCode]}</strong> has been
                submitted successfully. Our team will review it and send you a quote shortly.
              </p>
            </div>
            <div className="flex gap-3 mt-2">
              <Button
                variant="outline"
                onClick={() => setActiveView('requests')}
              >
                View Requests
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  setSuccess(false);
                  setForm({
                    serviceCode: '',
                    title: '',
                    description: '',
                    locationAddress: '',
                    locationLga: '',
                    locationState: '',
                    priority: 'NORMAL',
                    specialInstructions: '',
                  });
                  setStep(1);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Request
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">New Service Request</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tell us what you need, and we&apos;ll get it done for you.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((s, idx) => (
          <React.Fragment key={s.id}>
            <button
              onClick={() => s.id < step && setStep(s.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                step === s.id
                  ? 'bg-emerald-100 text-emerald-700'
                  : step > s.id
                  ? 'bg-emerald-50 text-emerald-600 cursor-pointer hover:bg-emerald-100'
                  : 'bg-gray-100 text-gray-400'
              }`}
              disabled={s.id >= step}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === s.id
                    ? 'bg-emerald-600 text-white'
                    : step > s.id
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-300 text-white'
                }`}
              >
                {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-6 sm:w-10 rounded-full ${
                  step > s.id ? 'bg-emerald-400' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <Card className="py-5">
        <CardContent className="p-4 sm:p-6 space-y-5">
          {/* Step 1: Service Type */}
          {step === 1 && (
            <>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">What service do you need?</h3>
                <p className="text-sm text-muted-foreground">Select the type of field service you&apos;re requesting.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SERVICE_CODES.map((code) => (
                  <button
                    key={code}
                    onClick={() => updateField('serviceCode', code)}
                    className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all hover:border-emerald-300 ${
                      form.serviceCode === code
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        form.serviceCode === code
                          ? 'border-emerald-500 bg-emerald-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {form.serviceCode === code && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <span className="text-sm font-medium">{SERVICE_TYPE_LABELS[code]}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step 2: Details */}
          {step === 2 && (
            <>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Request Details</h3>
                <p className="text-sm text-muted-foreground">
                  Provide a title and describe what needs to be done.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">
                    Title <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    placeholder="e.g., Inspect property at 12 Admiralty Way"
                    value={form.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    maxLength={200}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe what you need done in detail..."
                    value={form.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label>Priority</Label>
                  <RadioGroup
                    value={form.priority}
                    onValueChange={(val) => updateField('priority', val)}
                    className="flex gap-3"
                  >
                    <Label
                      htmlFor="priority-normal"
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                        form.priority === 'NORMAL'
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <RadioGroupItem value="NORMAL" id="priority-normal" />
                      <span className="text-sm font-medium">Normal</span>
                      <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600">Standard SLA</Badge>
                    </Label>
                    <Label
                      htmlFor="priority-urgent"
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                        form.priority === 'URGENT'
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <RadioGroupItem value="URGENT" id="priority-urgent" />
                      <span className="text-sm font-medium">Urgent</span>
                      <Badge variant="outline" className="text-[10px] bg-orange-100 text-orange-600">Priority SLA</Badge>
                    </Label>
                  </RadioGroup>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Location */}
          {step === 3 && (
            <>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Location Details</h3>
                <p className="text-sm text-muted-foreground">
                  Where should our agent go? Provide as much detail as possible.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address">Street Address</Label>
                  <Input
                    id="address"
                    placeholder="e.g., 12 Admiralty Way, Lekki Phase 1"
                    value={form.locationAddress}
                    onChange={(e) => updateField('locationAddress', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="lga">Local Government Area</Label>
                    <Input
                      id="lga"
                      placeholder="e.g., Eti-Osa"
                      value={form.locationLga}
                      onChange={(e) => updateField('locationLga', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      placeholder="e.g., Lagos"
                      value={form.locationState}
                      onChange={(e) => updateField('locationState', e.target.value)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="instructions">Special Instructions <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea
                    id="instructions"
                    placeholder="Any special access codes, gate instructions, or things the agent should know..."
                    value={form.specialInstructions}
                    onChange={(e) => updateField('specialInstructions', e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 1}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>

            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canProceed()}
                className="bg-emerald-600 hover:bg-emerald-700 gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Submit Request
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
