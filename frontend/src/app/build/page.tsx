import { ServiceComingSoon } from '@/components/ServiceComingSoon';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'build')!;

export default function BuildPage() {
  return <ServiceComingSoon service={service} />;
}
