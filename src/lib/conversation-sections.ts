import type { Conversation } from '@/lib/conversations';

export type ConversationSection = { title: string; data: Conversation[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Groups chats like ChatGPT's sidebar: Pinned, Today, Yesterday, Previous 7
 * days, Previous 30 days, then by month. Input is newest-first.
 */
export function sectionsFor(
  conversations: Conversation[],
  now = new Date()
): ConversationSection[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = new Map<string, Conversation[]>();
  const add = (title: string, c: Conversation) => {
    const list = buckets.get(title);
    if (list) list.push(c);
    else buckets.set(title, [c]);
  };

  const pinned = conversations.filter((c) => c.pinned);
  for (const c of conversations) {
    if (c.pinned) continue;
    const t = c.updatedAt;
    if (t >= startOfToday) add('Today', c);
    else if (t >= startOfToday - DAY_MS) add('Yesterday', c);
    else if (t >= startOfToday - 7 * DAY_MS) add('Previous 7 days', c);
    else if (t >= startOfToday - 30 * DAY_MS) add('Previous 30 days', c);
    else {
      const d = new Date(t);
      const sameYear = d.getFullYear() === now.getFullYear();
      add(
        d.toLocaleDateString(
          undefined,
          sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }
        ),
        c
      );
    }
  }

  const sections: ConversationSection[] = [];
  if (pinned.length) sections.push({ title: 'Pinned', data: pinned });
  // Map preserves insertion order, which follows the newest-first input.
  for (const [title, data] of buckets) sections.push({ title, data });
  return sections;
}
