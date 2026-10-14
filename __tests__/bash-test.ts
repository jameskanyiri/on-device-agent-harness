// An in-memory stand-in for react-native-blob-util's file system.
jest.mock('react-native-blob-util', () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/docs']);
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/'));
  const fs = {
    dirs: { DocumentDir: '/docs' },
    exists: async (p: string) => files.has(p) || dirs.has(p),
    isDir: async (p: string) => dirs.has(p),
    mkdir: async (p: string) => {
      if (!dirs.has(parent(p))) throw new Error(`no parent for ${p}`);
      dirs.add(p);
    },
    stat: async (p: string) => ({ size: files.get(p)?.length ?? 0 }),
    readFile: async (p: string) => {
      if (!files.has(p)) throw new Error(`missing ${p}`);
      return files.get(p);
    },
    writeFile: async (p: string, data: string) => {
      if (!dirs.has(parent(p))) throw new Error(`no folder for ${p}`);
      files.set(p, data);
    },
    unlink: async (p: string) => {
      files.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(p + '/')) files.delete(k);
      for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d);
    },
    mv: async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    lstat: async (dir: string) => [
      ...[...dirs].filter((d) => parent(d) === dir).map((d) => ({ filename: d.slice(dir.length + 1), type: 'directory', lastModified: 0, path: d, size: 0 })),
      ...[...files.keys()].filter((f) => parent(f) === dir).map((f) => ({ filename: f.slice(dir.length + 1), type: 'file', lastModified: 0, path: f, size: 0 })),
    ],
  };
  return { __esModule: true, default: { fs } };
});

// eslint-disable-next-line import/first
import { createBashTool, tokenize } from '@/harness/bash';
// eslint-disable-next-line import/first
import { parseGemmaToolCalls } from '@/harness/gemma-tool-parser';
// eslint-disable-next-line import/first
import type { ToolActivity } from '@/harness/filesystem';

let n = 0;

/** A fresh workspace with the eval's notes in it. */
async function setup() {
  const root = `/docs/ws${n++}`;
  const seed = createBashTool({ root });
  const sh = (command: string, tool = seed) => tool.tool.execute({ command }) as Promise<string>;
  await sh(`mkdir -p /notes /drafts && printf '# Health\\n\\nDentist on the 14th at 9am.\\n' > /notes/health.md`);
  await sh(`printf '# Todo\\n\\n- [ ] Call mom\\n- [ ] Book dentist\\n' > /todo.md`);
  await sh(`printf 'Dear landlord,\\n\\nThe kitchen tap is leaking again.' > /drafts/letter.txt`);
  await sh(`echo 'Water the plants on Sunday.' > /drafts/ideas.txt`);
  // A new session: nothing read yet.
  const tool = createBashTool({ root });
  const activity: ToolActivity[] = [];
  tool.setActivityListener((a) => activity.push(a));
  return { sh: (command: string) => sh(command, tool), activity };
}

describe('tokenize', () => {
  it('handles quotes, operators and a heredoc', () => {
    const t = tokenize(`grep -ri "dentist on" '/notes' | head -1 && cat > /a.md <<'EOF'\nline 1\n  $x\nEOF\necho done`);
    expect(t.map((x) => (x.kind === 'word' ? x.value : x.kind === 'op' ? x.value : `<<${x.body}`))).toEqual([
      'grep', '-ri', 'dentist on', '/notes', '|', 'head', '-1', '&&', 'cat', '>', '/a.md', '<<line 1\n  $x\n', ';', 'echo', 'done',
    ]);
  });
});

it('reads a bash call from Gemma, quotes and newlines included', () => {
  const Q = '<|"|>';
  const text = `<|tool_call>call:bash{command:${Q}cat > /drafts/index.md <<'EOF'\n- letter.txt: \"fix the tap\"\nEOF${Q}}<tool_call|>`;
  const args = parseGemmaToolCalls(text)!.toolCalls[0]!.function.arguments as Record<string, unknown>;
  expect(tokenize(String(args.command)).at(-2)).toEqual({ kind: 'heredoc', body: '- letter.txt: "fix the tap"\n' });
});

describe('bash tool', () => {
  it('lists, reads and searches like bash', async () => {
    const { sh } = await setup();
    expect(await sh('ls /')).toBe('drafts/\nnotes/\ntodo.md');
    expect(await sh('cat /drafts/letter.txt')).toBe('Dear landlord,\n\nThe kitchen tap is leaking again.');
    expect(await sh('grep -ril dentist /')).toBe('/notes/health.md\n/todo.md');
    expect(await sh('grep -rn "9am" /notes')).toBe('/notes/health.md:3:Dentist on the 14th at 9am.');
    expect(await sh('ls /drafts/*.txt | wc -l')).toBe('2');
    expect(await sh('find / -name "*.txt"')).toBe('/drafts/ideas.txt\n/drafts/letter.txt');
    expect(await sh('grep -r passport /')).toBe('(no matches)');
  });

  it('gives the errors the model already knows', async () => {
    const { sh, activity } = await setup();
    expect(await sh('cat /notes')).toBe('cat: /notes: Is a directory');
    expect(await sh('cat /notes/budget.md')).toBe('cat: /notes/budget.md: No such file or directory');
    expect(await sh('python3 x.py')).toMatch(/^bash: python3: command not found\. Available: ls, cat/);
    expect(activity.map((a) => a.ok)).toEqual([false, false, false]);
  });

  it('appends with >> and writes new files, with a heredoc too', async () => {
    const { sh } = await setup();
    await sh(`echo "Please fix the tap by Friday." >> /drafts/letter.txt`);
    expect(await sh('cat /drafts/letter.txt')).toBe('Dear landlord,\n\nThe kitchen tap is leaking again.\nPlease fix the tap by Friday.');
    expect(await sh(`cat > /drafts/index.md <<'EOF'\n- letter.txt: asks the landlord to fix the tap\n- ideas.txt: watering the plants\nEOF`)).toBe('(done, no output)');
    expect(await sh('cat /drafts/index.md')).toBe('- letter.txt: asks the landlord to fix the tap\n- ideas.txt: watering the plants');
    await sh(`echo 'Reminder: dentist on the 14th at 9am' > /reminders/dentist.txt`);
    expect(await sh('cat /reminders/dentist.txt')).toBe('Reminder: dentist on the 14th at 9am');
  });

  it('won’t overwrite a file it hasn’t read, as edit_file won’t', async () => {
    const { sh } = await setup();
    expect(await sh(`echo '- [x] Book dentist' > /todo.md`)).toBe(
      "bash: /todo.md: file exists and you haven't read it. cat it first, or use >> to add to the end"
    );
    await sh('cat /todo.md');
    await sh(`echo '# Todo' > /todo.md`);
    expect(await sh('cat /todo.md')).toBe('# Todo');
  });

  it('edits with sed -i: substitute, append a line, delete a line', async () => {
    const { sh } = await setup();
    await sh(`sed -i 's/- \\[ \\] Book dentist/- [x] Book dentist/' /todo.md`);
    expect(await sh('cat /todo.md')).toContain('- [x] Book dentist');
    await sh(`sed -i '$a - [ ] Follow up with landlord' /todo.md`);
    expect(await sh('tail -n 1 /todo.md')).toBe('- [ ] Follow up with landlord');
    await sh(`sed -i '/Call mom/d' /todo.md`);
    expect(await sh('grep -c "" /todo.md')).toBe('4');
    expect(await sh(`sed 's/kitchen/bathroom/' /drafts/letter.txt | tail -1`)).toBe('The bathroom tap is leaking again.');
  });

  it('runs && only after success, and || only after failure', async () => {
    const { sh } = await setup();
    expect(await sh('cat /nope.md && echo yes')).toBe('cat: /nope.md: No such file or directory');
    expect(await sh('cat /nope.md || echo fallback')).toBe('fallback\ncat: /nope.md: No such file or directory');
    expect(await sh('cd /notes; ls')).toBe('health.md');
  });

  it('open shows a file to the user, and the activity says so', async () => {
    const { sh, activity } = await setup();
    expect(await sh('open /notes/health.md')).toBe('Opened /notes/health.md for the user.');
    expect(activity.at(-1)).toMatchObject({ name: 'bash', label: 'Opened /notes/health.md', ok: true, opens: true, path: '/notes/health.md' });
  });

  it('records each call for the chat and the benchmarks', async () => {
    const { sh, activity } = await setup();
    await sh('grep -ril dentist /notes');
    expect(activity[0]).toMatchObject({ name: 'bash', label: '$ grep -ril dentist /notes', ok: true, args: { command: 'grep -ril dentist /notes' } });
  });

  it('stays inside the workspace', async () => {
    const { sh } = await setup();
    expect(await sh('cat ../../etc/passwd')).toMatch(/outside the workspace/);
    expect(await sh('rm -rf /')).toBe('rm: refusing to remove /');
  });
});
