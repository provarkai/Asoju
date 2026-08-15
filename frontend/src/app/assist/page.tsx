import { ServiceComingSoon } from '@/components/ServiceComingSoon';
import { SERVICE_FAMILIES } from '@/lib/services';

const service = SERVICE_FAMILIES.find((s) => s.slug === 'assist')!;

export default function AssistPage() {
  return <ServiceComingSoon service={service} />;
}
