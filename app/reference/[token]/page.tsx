import { redirect } from "next/navigation";

export default function Page({
  params,
}: {
  params: { token: string };
}) {
  redirect(`/demo?formId=reference&token=${params.token}`);
}

