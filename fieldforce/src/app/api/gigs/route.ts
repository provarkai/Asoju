import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── GET /api/gigs ─────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure tiers exist
    const tierCount = await db.agentTier.count();
    if (tierCount === 0) {
      await db.agentTier.createMany({
        data: [
          { name: 'Starter', level: 1, description: 'New agents' },
          { name: 'Verified', level: 2, description: 'Identity verified' },
          { name: 'Pro', level: 3, description: 'High-performing' },
          { name: 'Elite', level: 4, description: 'Top-tier' },
        ],
      });
    }

    // Seed demo gigs only when the agent has none
    const agentGigs = await db.cachedGig.findMany({
      where: { agentId },
    });
    const globalAvailableGigs = await db.cachedGig.findMany({
      where: { status: 'AVAILABLE' },
    });

    if (globalAvailableGigs.length === 0 && agentGigs.length === 0) {
      const demoGigs = [
        {
          caseId: 'CASE-2024-001',
          serviceCode: 'PROPERTY_INSPECTION',
          title: 'Property Inspection - 3BR Flat',
          description: 'Inspect a 3-bedroom flat in Victoria Island. Check structural integrity, plumbing, and electrical systems.',
          state: 'Lagos',
          lga: 'Eti-Osa',
          address: 'Plot 42, Admiralty Way, Victoria Island',
          estimatedPayout: 15000,
          slaDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          priority: 'NORMAL',
          beneficiaryName: 'Mr. Ade',
          beneficiaryPhone: '+23480XXXX1234',
          caseScope: JSON.stringify({
            objectives: [
              'Verify property exists at listed address',
              'Check structural condition (walls, roof, floors)',
              'Inspect plumbing (running water, leaks)',
              'Inspect electrical (wiring, sockets, lights)',
              'Check security features (locks, gates)',
            ],
            checklist: [
              { id: 'cl-1', label: 'Photo of property exterior (front view)', type: 'photo', completed: false },
              { id: 'cl-2', label: 'Photo of property exterior (side view)', type: 'photo', completed: false },
              { id: 'cl-3', label: 'Photo of street/gate entrance', type: 'photo', completed: false },
              { id: 'cl-4', label: 'Living room condition satisfactory', type: 'boolean', completed: false },
              { id: 'cl-5', label: 'Kitchen - all fixtures working', type: 'boolean', completed: false },
              { id: 'cl-6', label: 'Bedroom 1 condition photo', type: 'photo', completed: false },
              { id: 'cl-7', label: 'Bedroom 2 condition photo', type: 'photo', completed: false },
              { id: 'cl-8', label: 'Bedroom 3 condition photo', type: 'photo', completed: false },
              { id: 'cl-9', label: 'Bathroom - plumbing check', type: 'boolean', completed: false },
              { id: 'cl-10', label: 'Electrical panels & sockets photo', type: 'photo', completed: false },
              { id: 'cl-11', label: 'Evidence of dampness/mold', type: 'note', completed: false },
              { id: 'cl-12', label: 'Security features intact (locks, gates)', type: 'boolean', completed: false },
            ],
            exclusions: [
              'Do NOT open any locked rooms or safes',
              'Do NOT interact with neighbors about the property owner',
              'Do NOT take photos of any personal documents left on site',
            ],
            specialInstructions: 'Contact beneficiary Mr. Ade 30 mins before arrival. Gate code: 4521.',
          }),
          status: 'AVAILABLE',
          agentId,
        },
        {
          caseId: 'CASE-2024-002',
          serviceCode: 'DOCUMENT_RETRIEVAL',
          title: 'Document Collection - Land Title',
          description: 'Collect original land title documents from a law firm in Ikeja. Verify authenticity on-site.',
          state: 'Lagos',
          lga: 'Ikeja',
          address: '15 Allen Avenue, Ikeja',
          estimatedPayout: 8000,
          slaDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          priority: 'URGENT',
          beneficiaryName: 'Barr. Williams',
          beneficiaryPhone: '+23480XXXX5678',
          caseScope: JSON.stringify({
            objectives: [
              'Visit the law firm at the listed address',
              'Present case reference number to front desk',
              'Collect the sealed land title document envelope',
              'Verify seal integrity and document count on-site',
              'Photograph the sealed envelope before transport',
            ],
            checklist: [
              { id: 'cl-1', label: 'Photo of law firm exterior/signage', type: 'photo', completed: false },
              { id: 'cl-2', label: 'Photo of sealed envelope (front)', type: 'photo', completed: false },
              { id: 'cl-3', label: 'Photo of sealed envelope (back)', type: 'photo', completed: false },
              { id: 'cl-4', label: 'Document count verified', type: 'boolean', completed: false },
              { id: 'cl-5', label: 'Seal integrity confirmed', type: 'boolean', completed: false },
              { id: 'cl-6', label: 'Receipt/collection acknowledgment obtained', type: 'photo', completed: false },
              { id: 'cl-7', label: 'Contact person name confirmed', type: 'note', completed: false },
            ],
            exclusions: [
              'Do NOT open the sealed envelope',
              'Do NOT make copies of the documents',
              'Do NOT leave documents unattended at any time',
            ],
          }),
          status: 'AVAILABLE',
          agentId,
        },
        {
          caseId: 'CASE-2024-003',
          serviceCode: 'CONSTRUCTION_SITE_INSPECTION',
          title: 'Construction Site Progress Check',
          description: 'Visit an ongoing construction site and verify progress against the approved plan.',
          state: 'Lagos',
          lga: 'Eti-Osa',
          address: 'Off Ozumba Mbadiwe, Victoria Island',
          estimatedPayout: 20000,
          slaDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          priority: 'NORMAL',
          beneficiaryName: 'Engr. Bola',
          beneficiaryPhone: '+23480XXXX9012',
          caseScope: JSON.stringify({
            objectives: [
              'Visit the construction site during working hours',
              'Photograph current state of construction',
              'Compare with approved building plan',
              'Interview site supervisor',
              'Check safety compliance',
            ],
            checklist: [
              { id: 'cl-1', label: 'Site entrance/gate photo', type: 'photo', completed: false },
              { id: 'cl-2', label: 'Overall site progress photo (wide angle)', type: 'photo', completed: false },
              { id: 'cl-3', label: 'Ground floor progress photo', type: 'photo', completed: false },
              { id: 'cl-4', label: 'First floor progress photo (if applicable)', type: 'photo', completed: false },
              { id: 'cl-5', label: 'Building materials on-site photo', type: 'photo', completed: false },
              { id: 'cl-6', label: 'Number of workers present', type: 'note', completed: false },
              { id: 'cl-7', label: 'Safety equipment observed (helmets, vests)', type: 'boolean', completed: false },
              { id: 'cl-8', label: 'Site supervisor available', type: 'boolean', completed: false },
              { id: 'cl-9', label: 'Supervisor interview notes', type: 'note', completed: false },
              { id: 'cl-10', label: 'Estimated completion percentage', type: 'note', completed: false },
            ],
            exclusions: [
              'Do NOT enter restricted zones',
              'Do NOT operate any construction equipment',
              'Do NOT climb scaffolding',
            ],
          }),
          status: 'AVAILABLE',
          agentId,
        },
        {
          caseId: 'CASE-2024-004',
          serviceCode: 'BUSINESS_VERIFICATION',
          title: 'Business Verification - Tech Startup',
          description: 'Verify a registered tech startup at the provided address. Confirm operational status, signage, and key contacts.',
          state: 'Lagos',
          lga: 'Ikeja',
          address: '42 Opebi Road, Ikeja',
          estimatedPayout: 12000,
          slaDeadline: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
          priority: 'NORMAL',
          beneficiaryName: 'Ms. Adebayo',
          beneficiaryPhone: '+23480XXXX7890',
          caseScope: JSON.stringify({
            objectives: [
              'Visit the business address at listed location',
              'Confirm business signage is visible',
              'Verify business is operational (staff present, open for business)',
              'Confirm business name matches registration',
              'Speak with a point of contact at the business',
            ],
            checklist: [
              { id: 'cl-1', label: 'Photo of building exterior with address visible', type: 'photo', completed: false },
              { id: 'cl-2', label: 'Photo of business signage', type: 'photo', completed: false },
              { id: 'cl-3', label: 'Business is operational (staff/activity visible)', type: 'boolean', completed: false },
              { id: 'cl-4', label: 'Interior photo showing business activity', type: 'photo', completed: false },
              { id: 'cl-5', label: 'Business registration document sighted', type: 'boolean', completed: false },
              { id: 'cl-6', label: 'Contact person name and title', type: 'note', completed: false },
              { id: 'cl-7', label: 'Nature of business observed', type: 'note', completed: false },
            ],
            exclusions: [
              'Do NOT request confidential financial information',
              'Do NOT impersonate a regulatory official',
            ],
          }),
          status: 'AVAILABLE',
          agentId,
        },
        {
          caseId: 'CASE-2024-005',
          serviceCode: 'DELIVERY_VERIFICATION',
          title: 'Delivery Confirmation - Electronics',
          description: 'Verify delivery of electronics items at a residential address. Check package count and condition.',
          state: 'Lagos',
          lga: 'Lagos Island',
          address: '24 Broad Street, Lagos Island',
          estimatedPayout: 5000,
          slaDeadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          priority: 'CRITICAL',
          beneficiaryName: 'Mrs. Ogun',
          beneficiaryPhone: '+23480XXXX3456',
          caseScope: JSON.stringify({
            objectives: [
              'Visit the delivery address',
              'Verify items against the packing list',
              'Photograph items and packaging',
              'Get beneficiary signature/confirmation',
            ],
            checklist: [
              { id: 'cl-1', label: 'Photo of delivery address exterior', type: 'photo', completed: false },
              { id: 'cl-2', label: 'Photo of all items unpacked', type: 'photo', completed: false },
              { id: 'cl-3', label: 'Item count matches packing list', type: 'boolean', completed: false },
              { id: 'cl-4', label: 'All items in good condition', type: 'boolean', completed: false },
              { id: 'cl-5', label: 'Photo of any damaged items (if any)', type: 'photo', completed: false },
              { id: 'cl-6', label: 'Beneficiary confirmation received', type: 'boolean', completed: false },
              { id: 'cl-7', label: 'Notes on delivery condition', type: 'note', completed: false },
            ],
            exclusions: [
              'Do NOT open sealed electronics packages',
              'Do NOT accept delivery on behalf of absent beneficiary',
            ],
          }),
          status: 'AVAILABLE',
          agentId,
        },
      ];

      await db.cachedGig.createMany({ data: demoGigs });
    }

    const gigs = await db.cachedGig.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: [{ priority: 'desc' }, { slaDeadline: 'asc' }],
    });

    return NextResponse.json(gigs);
  } catch (error) {
    console.error('GET /api/gigs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gigs' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/gigs ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { caseId } = await request.json();
    if (!caseId) {
      return NextResponse.json({ error: 'caseId required' }, { status: 400 });
    }

    // Verify gig is still available (not claimed by anyone)
    const gig = await db.cachedGig.findUnique({ where: { caseId } });
    if (!gig || gig.status !== 'AVAILABLE') {
      return NextResponse.json(
        { error: 'Gig is no longer available' },
        { status: 409 },
      );
    }

    await db.cachedGig.update({
      where: { caseId },
      data: { status: 'EXPIRED' },
    });

    return NextResponse.json({ success: true, message: 'Gig declined' });
  } catch (error) {
    console.error('DELETE /api/gigs error:', error);
    return NextResponse.json(
      { error: 'Failed to decline gig' },
      { status: 500 },
    );
  }
}
