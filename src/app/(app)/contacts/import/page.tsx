import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { ContactImport } from '@/components/contacts/contact-import';

export const metadata: Metadata = { title: 'Import contacts' };

export default async function ImportContactsPage() {
  await requireMember('agent');
  return (
    <>
      <Link href="/contacts" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Contacts
      </Link>
      <PageHeader title="Import contacts" description="Upload a CSV. Numbers are validated and normalised to +91 format, and duplicates are detected before anything is saved." />
      <Card>
        <CardBody>
          <ContactImport />
        </CardBody>
      </Card>
    </>
  );
}
