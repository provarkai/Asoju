import { ServicePageShell } from '@/components/service/ServicePageShell';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'inspect')!;

export default function InspectPage() {
  return <ServicePageShell service={service} />;
}
