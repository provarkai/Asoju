// Locked six-service public architecture — docs/frontend-handoff-v1.0/
// 01_Product_Architecture/ASOJU_Master_Services_Frontend_Engineering_
// Specification_v1.0.docx §2/§25: "Farewell is excluded from the public
// service architecture." One shared config so the header menu, mobile
// nav and the Sprint 5/6 service-page shell don't each redefine this
// list — see components/service/ServicePageShell.tsx.
//
// serviceTypes cross-references the real backend ServiceType enum
// (backend/prisma/schema.prisma) per docs/FRONTEND_HANDOFF_V1_GAP_MAP.md
// §1 — the mapping is display-only until the Sprint 1 backend ticket
// proposed there (restructure ServiceType -> ServiceFamily) lands; it is
// not yet wired into case creation.
//
// fromNgn is undefined, never invented, where no serviceType in the
// family has a real published "from" price — Arrivals and Assist's
// AGRICULTURE_SUPPORT leg have none yet (see dashboard/new/page.tsx's
// own SERVICES pricing, the one place these numbers are already live).
// useCases/outcome/faqs are honest process/policy description, not
// fabricated stats, ratings or customer claims — same governance
// ServiceComingSoon.tsx's own comment already documents.

export interface ServiceFaq {
  q: string;
  a: string;
}

export interface ServiceFamily {
  slug: string;
  name: string;
  tagline: string;
  serviceTypes: string[];
  fromNgn?: number;
  useCases: string[];
  outcome: string;
  quickPrompts: string[];
  faqs: ServiceFaq[];
}

export const SERVICE_FAMILIES: ServiceFamily[] = [
  {
    slug: 'arrivals',
    name: 'ASOJU Arrivals',
    tagline: 'Airport pickup, accommodation and pre-arrival coordination.',
    serviceTypes: ['ARRIVAL_SUPPORT'],
    useCases: [
      'Airport pickup and drop-off on arrival',
      'Accommodation booked and confirmed before you land',
      'Groceries and essentials ready at the property',
      'A local point of contact for the length of your stay',
    ],
    outcome:
      'A confirmed arrival plan — flight, accommodation and pickup all in one place — with a representative meeting you or your family on the ground.',
    quickPrompts: [
      "I'm landing in Lagos next month and need airport pickup",
      'Book a short-let apartment before I arrive',
      'Arrange groceries at the house before we land',
    ],
    faqs: [
      {
        q: 'How far in advance should I set this up?',
        a: 'As soon as your travel dates are confirmed. Accommodation and pickup both work better with lead time, but the Concierge will flag if your timeline is tight.',
      },
      {
        q: 'Can you handle multiple travelers?',
        a: 'Yes — tell the Concierge how many people and any special requirements (age, mobility, luggage) and our team scopes accordingly.',
      },
    ],
  },
  {
    slug: 'inspect',
    name: 'ASOJU Inspect',
    tagline: 'Property and asset inspection, with dated evidence.',
    serviceTypes: ['PROPERTY_INSPECTION', 'ASSET_INSPECTION'],
    fromNgn: 60000,
    useCases: [
      'Verify a plot or property before you pay a balance',
      'Check on a house, farm or vehicle you can’t visit yourself',
      'Confirm a property matches what a seller or agent described',
      'Get dated photo and video evidence of current condition',
    ],
    outcome:
      'A representative physically visits the site, captures dated photo/video evidence and notes, and a QC-reviewed report lands in your portal with clearly labelled findings.',
    quickPrompts: [
      'Verify a plot of land in Ibeju-Lekki before I pay the balance',
      "Check my father's farm in Oyo",
      'Inspect a house I want to buy in Abuja',
    ],
    faqs: [
      {
        q: 'What exactly do you check?',
        a: 'Location, physical condition, and surroundings at minimum — the exact checklist depends on the property type and what you tell the Concierge you need confirmed.',
      },
      {
        q: 'How is the evidence trustworthy?',
        a: 'Every photo/video carries a server timestamp and a label showing where it came from (ASOJU-captured, professionally reviewed, customer-provided, etc.) — never presented as more certain than it is.',
      },
    ],
  },
  {
    slug: 'build',
    name: 'ASOJU Build',
    tagline: 'Construction and project supervision while you’re away.',
    serviceTypes: ['CONSTRUCTION_SUPERVISION'],
    fromNgn: 125000,
    useCases: [
      'Scheduled site visits while your building project is underway',
      'Progress evidence so you know what’s actually been done',
      'A second set of eyes when a contractor’s update doesn’t add up',
      'Milestone tracking against the agreed scope',
    ],
    outcome:
      'Recurring, scheduled site visits with dated evidence and a progress report per visit — tracked against the milestones agreed at scope confirmation.',
    quickPrompts: [
      'Monitor my building project in Abuja',
      'I need someone to check my contractor is actually on-site',
      'Set up recurring site visits for an ongoing build',
    ],
    faqs: [
      {
        q: 'How often are site visits?',
        a: 'Scheduled with you during scope confirmation, based on the project stage and your preference — a foundation pour needs closer attention than finishing work.',
      },
      {
        q: 'What if I dispute what the report shows?',
        a: 'Every case has a structured dispute flow — you can flag specific checklist items, and the team schedules rework on exactly those items.',
      },
    ],
  },
  {
    slug: 'care',
    name: 'ASOJU Care',
    tagline: 'Family and personal matters handled by a trusted local presence.',
    serviceTypes: ['FAMILY_SUPPORT', 'BEREAVEMENT_SUPPORT'],
    fromNgn: 45000,
    useCases: [
      'Errands and check-ins for family members back home',
      'Coordinating care or logistics you can’t manage remotely',
      'Bereavement and funeral logistics handled with care',
      'A trusted representative your family can actually meet',
    ],
    outcome:
      'A representative handles the errand or coordination in person, with evidence and updates back to you — sensitive matters handled with the discretion they need.',
    quickPrompts: [
      'Help my parents with an errand back home',
      'Coordinate funeral logistics for a family member',
      'Check in on a relative in Nigeria',
    ],
    faqs: [
      {
        q: 'Is this only for emergencies?',
        a: 'No — routine errands and check-ins are just as much a fit as urgent or sensitive matters. Tell the Concierge what you need and it scopes accordingly.',
      },
      {
        q: 'How do you handle bereavement cases with care?',
        a: 'These are triaged by staff, not left to automation — a human confirms scope and next steps with you directly before anything is scheduled.',
      },
    ],
  },
  {
    slug: 'verify',
    name: 'ASOJU Verify',
    tagline: 'Business, vendor and document verification.',
    serviceTypes: ['BUSINESS_VERIFICATION'],
    fromNgn: 90000,
    useCases: [
      'Confirm a business actually exists before you invest or partner',
      'Verify a vendor or supplier before committing funds',
      'Check registration/documentation claims against reality',
      'Due diligence before a business decision made from abroad',
    ],
    outcome:
      'A representative verifies the business in person — physical presence, documentation, and any claims you asked us to check — with findings labelled by source in the final report.',
    quickPrompts: [
      'Check my father’s farm business is registered',
      "Verify a supplier before I send payment",
      'Confirm a business address actually exists',
    ],
    faqs: [
      {
        q: 'What counts as "verified"?',
        a: 'Every finding is labelled by how we know it — ASOJU-verified, professionally reviewed, customer-provided, or not independently confirmed. We never blur that distinction.',
      },
      {
        q: 'Can this support a legal or investment decision?',
        a: 'The report gives you evidence to make your own decision — it isn’t legal or financial advice, and we’ll say so plainly where relevant.',
      },
    ],
  },
  {
    slug: 'assist',
    name: 'ASOJU Assist',
    tagline: 'Procurement, collection and other supported local tasks.',
    serviceTypes: ['PROCUREMENT', 'INVESTMENT_SUPPORT', 'AGRICULTURE_SUPPORT'],
    fromNgn: 30000,
    useCases: [
      'Buy and deliver goods or materials locally',
      'Collect or hand over an item on your behalf',
      'On-the-ground support for an investment you’re managing remotely',
      'Agricultural site support — farms and land under your management',
    ],
    outcome:
      'A representative completes the specific task — purchase, delivery, collection or site visit — with evidence of completion in your portal.',
    quickPrompts: [
      'Buy and deliver 10 bags of cement to Enugu',
      'Collect a document on my behalf',
      'Check on a farm investment I manage from abroad',
    ],
    faqs: [
      {
        q: 'What kinds of tasks can you take on?',
        a: 'If it’s a concrete, describable local task, tell the Concierge — it’ll say plainly if something is outside what we currently support rather than guess.',
      },
      {
        q: 'How is payment for purchases handled?',
        a: 'Costs are itemised in your quote before anything is bought — no surprise line items after the fact.',
      },
    ],
  },
];
