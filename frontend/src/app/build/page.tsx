import { ServicePageShell } from '@/components/service/ServicePageShell';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'build')!;

export default function BuildPage() {
  return <ServicePageShell service={service} />;
}
