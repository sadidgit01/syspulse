import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";

export default async function AcceptInvitePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return <AcceptInviteForm token={params.token ?? ""} />;
}
