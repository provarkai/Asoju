import { ServicePageShell } from '@/components/service/ServicePageShell';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'verify')!;

export default function VerifyPage() {
  return <ServicePageShell service={service} />;
}
