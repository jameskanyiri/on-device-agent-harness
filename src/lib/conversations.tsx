import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import RNBlobUtil from 'react-native-blob-util';

import type { Message } from '@/components/chat/message-item';

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Pinned chats stay at the top of the sidebar. */
  pinned?: boolean;
};

// Stored next to the downloaded models, in the app's private Documents folder.
const STORE_PATH = `${RNBlobUtil.fs.dirs.DocumentDir}/conversations.json`;

export const newConversationId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Conversational openers that don't say what a chat is about.
const FILLER = [
  /^(hi|hello|hey|yo)\b[\s,!.]*/i,
  /^(please|pls|kindly)\s+/i,
  /^(can|could|would|will) you\s+(please\s+)?/i,
  /^(i want|i need|i'd like|i would like)( you)? to\s+/i,
  /^help me( to)?\s+/i,
  /^(tell|show) me\s+/i,
];
const MAX_TITLE_WORDS = 6;

/**
 * A short title from the first message: first sentence, openers like "Can you
 * please" removed, capped at a few words. Instant and costs no model context.
 */
export function titleFrom(messages: Message[]): string {
  // Prose before any code block, on one line.
  const prose = (messages.find((m) => m.role === 'user')?.text ?? '')
    .split('```')[0]!
    .replace(/\s+/g, ' ')
    .trim();
  const stripFiller = (text: string) => {
    for (let changed = true; changed;) {
      const before = text;
      for (const filler of FILLER) text = text.replace(filler, '');
      changed = text !== before;
    }
    return text;
  };
  // Strip openers before taking the first sentence, so "Hey! Can you…" isn't titled "Hey".
  const sentence = stripFiller(prose).split(/(?<=[.?!])\s/)[0] ?? '';
  let topic = stripFiller(sentence).replace(/[\s.?!,:;]+$/, '');
  if (!topic) topic = prose.replace(/[\s.?!,:;]+$/, '') || 'New chat';

  const words = topic.split(' ');
  const short =
    words.slice(0, MAX_TITLE_WORDS).join(' ') + (words.length > MAX_TITLE_WORDS ? '…' : '');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

async function readAll(): Promise<Conversation[]> {
  try {
    if (!(await RNBlobUtil.fs.exists(STORE_PATH))) return [];
    return JSON.parse(await RNBlobUtil.fs.readFile(STORE_PATH, 'utf8')) as Conversation[];
  } catch {
    return [];
  }
}

async function writeAll(conversations: Conversation[]): Promise<void> {
  await RNBlobUtil.fs.writeFile(STORE_PATH, JSON.stringify(conversations), 'utf8');
}

function useConversationStore() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Serializes writes so a slow write never overwrites a newer one.
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    readAll().then((all) => setConversations(all.sort((a, b) => b.updatedAt - a.updatedAt)));
  }, []);

  const persist = useCallback((next: Conversation[]) => {
    writeQueue.current = writeQueue.current.then(() => writeAll(next)).catch(() => {});
  }, []);

  /** Saves the messages of a conversation, creating it on first save. */
  const save = useCallback(
    (id: string, messages: Message[]) => {
      if (messages.length === 0) return;
      setConversations((prev) => {
        const now = Date.now();
        const existing = prev.find((c) => c.id === id);
        const updated: Conversation = existing
          ? { ...existing, messages, updatedAt: now }
          : {
              id,
              title: titleFrom(messages),
              createdAt: now,
              updatedAt: now,
              messages,
            };
        const next = [updated, ...prev.filter((c) => c.id !== id)];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const clearAll = useCallback(() => {
    setConversations([]);
    persist([]);
  }, [persist]);

  /** Updates a conversation's metadata without moving it in the list. */
  const patch = useCallback(
    (id: string, change: Partial<Pick<Conversation, 'title' | 'pinned'>>) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, ...change } : c));
        persist(next);
        return next;
      });
    },
    [persist]
  );
  const rename = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed) patch(id, { title: trimmed });
    },
    [patch]
  );
  const togglePin = useCallback((id: string, pinned: boolean) => patch(id, { pinned }), [patch]);

  return { conversations, save, remove, clearAll, rename, togglePin };
}

type ConversationStore = ReturnType<typeof useConversationStore>;
const ConversationsContext = createContext<ConversationStore | null>(null);

/** Shares one conversation list between the chat screen and Settings. */
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const store = useConversationStore();
  return <ConversationsContext.Provider value={store}>{children}</ConversationsContext.Provider>;
}

/** Conversations persisted on the phone, newest first. */
export function useConversations() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used inside <ConversationsProvider>');
  return ctx;
}

/** Size of the saved chats file, in bytes. */
export async function conversationsSize(): Promise<number> {
  try {
    return Number((await RNBlobUtil.fs.stat(STORE_PATH)).size) || 0;
  } catch {
    return 0;
  }
}
