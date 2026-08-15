'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  User,
  Building2,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  Award,
  Copy,
} from 'lucide-react';
import { useCustomerContext, formatDate } from './customer-shell';

// ─── InfoRow component (declared outside render) ────────────────────────

interface InfoRowProps {
  icon: React.ElementType;
  label: string;
  value?: string | null;
  copyable?: boolean;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
}

function InfoRow({ icon: Icon, label, value, copyable, copied, onCopy }: InfoRowProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-900 truncate">
            {value || '—'}
          </p>
          {copyable && value && (
            <button
              onClick={() => onCopy(value, label)}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              title={`Copy ${label}`}
            >
              {copied === label ? (
                <span className="text-[10px] text-emerald-600">Copied!</span>
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground hover:text-gray-700" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function CustomerProfile() {
  const { profile } = useCustomerContext();
  const [copied, setCopied] = useState<string | null>(null);

  const loading = !profile;

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const org = profile?.member?.customer;
  const member = profile?.member;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-16">
        <User className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Profile not available</p>
      </div>
    );
  }

  const orgStatusBadge = org?.status === 'ACTIVE'
    ? { label: 'Active', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    : { label: org?.status || 'Unknown', className: 'bg-slate-100 text-slate-600 border-slate-200' };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Profile &amp; Account</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your organization details and account information.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Organization Info */}
        <Card className="py-5">
          <CardHeader className="pb-0 px-4 sm:px-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Organization
              </CardTitle>
              <Badge variant="outline" className={`text-[10px] ${orgStatusBadge.className}`}>
                <Shield className="h-3 w-3 mr-0.5" />
                {orgStatusBadge.label}
              </Badge>
            </div>
            {org?.name && (
              <CardDescription className="mt-1">{org.name}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-4">
            <div className="group space-y-0">
              <InfoRow icon={Mail} label="Email" value={org?.email} copyable copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Phone} label="Phone" value={org?.phone} copyable copied={copied} onCopy={copyToClipboard} />
              {org?.address && (
                <InfoRow icon={MapPin} label="Address" value={[org.address, org.city, org.state, org.country].filter(Boolean).join(', ')} copied={copied} onCopy={copyToClipboard} />
              )}
              <InfoRow icon={Award} label="Type" value={org?.type} copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Calendar} label="Member Since" value={org?.createdAt ? formatDate(org.createdAt) : null} copied={copied} onCopy={copyToClipboard} />
            </div>
          </CardContent>
        </Card>

        {/* Member Info */}
        <Card className="py-5">
          <CardHeader className="pb-0 px-4 sm:px-6">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              Your Account
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-4 space-y-4">
            {/* Avatar & Name */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <span className="text-xl font-bold text-emerald-700">
                  {member?.displayName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </span>
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-lg">{member?.displayName || 'User'}</p>
                <p className="text-sm text-muted-foreground">{member?.role || 'Member'}</p>
              </div>
            </div>

            <Separator />

            <div className="group space-y-0">
              <InfoRow icon={Mail} label="Email" value={member?.email} copyable copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Phone} label="Phone" value={member?.phone} copyable copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Award} label="Role" value={member?.role} copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Calendar} label="Last Login" value={member?.lastLoginAt ? formatDate(member.lastLoginAt) : 'N/A'} copied={copied} onCopy={copyToClipboard} />
              <InfoRow icon={Calendar} label="Joined" value={member?.createdAt ? formatDate(member.createdAt) : null} copied={copied} onCopy={copyToClipboard} />
            </div>

            <Separator />

            {/* Stats */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Activity Overview</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-900">{profile.stats?.totalRequests || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Requests</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-900">{profile.stats?.totalCases || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Cases</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-900">{profile.stats?.totalPayments || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Payments</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Management (view-only) */}
      <Card className="py-5">
        <CardHeader className="pb-0 px-4 sm:px-6">
          <CardTitle className="text-base">Account Management</CardTitle>
          <CardDescription>
            Contact your organization administrator or ASOJU support for account changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="gap-2 self-start">
              <Mail className="h-4 w-4" />
              Contact Support
            </Button>
            <Button variant="outline" className="gap-2 self-start text-red-600 hover:text-red-700 hover:bg-red-50">
              <Shield className="h-4 w-4" />
              Request Account Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
