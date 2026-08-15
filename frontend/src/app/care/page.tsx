import { ServiceComingSoon } from '@/components/ServiceComingSoon';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'care')!;

export default function CarePage() {
  return <ServiceComingSoon service={service} />;
}
