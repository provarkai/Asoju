'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BANKS } from '@/lib/constants';
import { createAgentProfile } from '@/lib/asoju-api';
import { useAppStore } from '@/lib/store';

// ─── Validation Schema ──────────────────────────────────────────────────────

const basicInfoSchema = z
  .object({
    firstName: z.string().min(2, 'First name is required'),
    lastName: z.string().min(2, 'Last name is required'),
    phone: z
      .string()
      .min(1, 'Phone is required')
      .regex(/^\+234[0-9]{10}$/, 'Enter a valid Nigerian number (+234XXXXXXXXXX)'),
    email: z.string().email('Enter a valid email').or(z.literal('')),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
    bankCode: z.string().min(1, 'Select a bank'),
    accountNumber: z
      .string()
      .min(10, 'Account number must be 10 digits')
      .max(10, 'Account number must be 10 digits')
      .regex(/^[0-9]+$/, 'Digits only'),
    accountName: z.string().min(2, 'Account name is required'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type BasicInfoValues = z.infer<typeof basicInfoSchema>;

// ─── Props ──────────────────────────────────────────────────────────────────

interface BasicInfoStepProps {
  onNext: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BasicInfoStep({ onNext }: BasicInfoStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setAgent = useAppStore((s) => s.setAgent);

  const form = useForm<BasicInfoValues>({
    resolver: zodResolver(basicInfoSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phone: '+234',
      email: '',
      password: '',
      confirmPassword: '',
      bankCode: '',
      accountNumber: '',
      accountName: '',
    },
  });

  async function onSubmit(values: BasicInfoValues) {
    setLoading(true);
    setError('');
    try {
      const result = await createAgentProfile({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        email: values.email,
        password: values.password,
        bankCode: values.bankCode,
        accountNumber: values.accountNumber,
        accountName: values.accountName,
      });
      setAgent(result);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full border-2 border-emerald-200">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl text-emerald-900">Your Information</CardTitle>
        <CardDescription className="text-sm">
          Fill in your details to create your agent profile
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/* Name Row */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">First Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="First name"
                        className="h-12 text-base"
                        autoComplete="given-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Last Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Last name"
                        className="h-12 text-base"
                        autoComplete="family-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Phone */}
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Phone Number *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="+234XXXXXXXXXX"
                      className="h-12 text-base"
                      type="tel"
                      autoComplete="tel"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="you@example.com"
                      className="h-12 text-base"
                      type="email"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password Row */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Password *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Min 8 chars"
                        className="h-12 text-base"
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Confirm *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Re-enter"
                        className="h-12 text-base"
                        type="password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Bank Selection */}
            <FormField
              control={form.control}
              name="bankCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Bank *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-12 w-full text-base">
                        <SelectValue placeholder="Select your bank" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BANKS.map((bank) => (
                        <SelectItem key={bank.code} value={bank.code}>
                          {bank.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Account Number */}
            <FormField
              control={form.control}
              name="accountNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Account Number *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="10-digit account number"
                      className="h-12 text-base"
                      inputMode="numeric"
                      maxLength={10}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Account Name */}
            <FormField
              control={form.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Account Name *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Name on the account"
                      className="h-12 text-base"
                      autoComplete="cc-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Error Display */}
            {error && (
              <p className="text-sm text-red-600 font-medium text-center bg-red-50 rounded-lg py-2 px-3">
                {error}
              </p>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="h-12 w-full text-base font-bold bg-emerald-600 hover:bg-emerald-700 mt-2"
              disabled={loading}
            >
              {loading && <Loader2 className="animate-spin" />}
              {loading ? 'Creating Profile...' : 'Continue'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
