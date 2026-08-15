import { ServicePageShell } from '@/components/service/ServicePageShell';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'arrivals')!;

export default function ArrivalsPage() {
  return <ServicePageShell service={service} />;
}
