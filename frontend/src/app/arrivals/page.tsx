import { ServiceComingSoon } from '@/components/ServiceComingSoon';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'arrivals')!;

export default function ArrivalsPage() {
  return <ServiceComingSoon service={service} />;
}
