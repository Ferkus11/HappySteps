import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export async function generateMetadata() {
  return { title: (await getTranslations("chats"))("title") };
}

/** Desktop right pane before a chat is chosen (phones show only the list). */
export default async function ChatsPage() {
  const t = await getTranslations("chats");
  return (
    <div className="hidden h-full items-center justify-center rounded-card border border-border/70 bg-surface shadow-card md:flex">
      <EmptyState icon={MessagesSquare} title={t("pickChat")} hint={t("pickChatHint")} />
    </div>
  );
}
