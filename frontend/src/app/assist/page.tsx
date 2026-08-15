import { ServicePageShell } from '@/components/service/ServicePageShell';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'assist')!;

export default function AssistPage() {
  return <ServicePageShell service={service} />;
}
