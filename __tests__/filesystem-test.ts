import type { llm } from 'react-native-executorch';

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
    lstat: async (dir: string) => [
      ...[...dirs].filter((d) => parent(d) === dir).map((d) => ({ filename: d.slice(dir.length + 1), type: 'directory', lastModified: 0, path: d, size: 0 })),
      ...[...files.keys()].filter((f) => parent(f) === dir).map((f) => ({ filename: f.slice(dir.length + 1), type: 'file', lastModified: Date.now(), path: f, size: 0 })),
    ],
  };
  return { __esModule: true, default: { fs } };
});

// eslint-disable-next-line import/first
import { createFilesystemTools, type ToolActivity } from '@/harness/filesystem';

const ROOT = '/docs/test-workspace';

function setup() {
  const { tools, setActivityListener } = createFilesystemTools({ root: ROOT });
  const activity: ToolActivity[] = [];
  setActivityListener((a) => activity.push(a));
  const run = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t: llm.ToolDefinition) => t.function.name === name)!;
    return (await tool.execute(args)) as string;
  };
  return { run, activity };
}

describe('filesystem tools', () => {
  it('declares the seven tools', () => {
    const { tools } = createFilesystemTools({ root: ROOT });
    expect(tools.map((t) => t.function.name)).toEqual(['ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'open_file']);
  });

  it('writes, reads (line-numbered) and refuses to overwrite', async () => {
    const { run } = setup();
    expect(await run('write_file', { file_path: '/notes/todo.md', content: '- [ ] Call mom\n- [ ] Book dentist\n' })).toBe('Created file /notes/todo.md');
    expect(await run('read_file', { file_path: '/notes/todo.md' })).toBe('     1\t- [ ] Call mom\n     2\t- [ ] Book dentist');
    expect(await run('write_file', { file_path: '/notes/todo.md', content: 'x' })).toMatch(/already exists/);
  });

  it('only edits files read in this session, and needs a unique match', async () => {
    const first = setup();
    await first.run('write_file', { file_path: '/a.md', content: 'one two two' });
    const fresh = setup();
    expect(await fresh.run('edit_file', { file_path: '/a.md', old_string: 'one', new_string: '1' })).toMatch(/must read/);
    await fresh.run('read_file', { file_path: '/a.md' });
    expect(await fresh.run('edit_file', { file_path: '/a.md', old_string: 'two', new_string: '2' })).toMatch(/appears 2 times/);
    expect(await fresh.run('edit_file', { file_path: '/a.md', old_string: 'two', new_string: '2', replace_all: true })).toBe('Edited /a.md (2 replacement(s))');
    expect(await fresh.run('read_file', { file_path: '/a.md' })).toContain('one 2 2');
  });

  it('errors say what to try next (step 3b)', async () => {
    const { run } = setup();
    expect(await run('read_file', { file_path: '/notes/budget_sync_notes.md' })).toBe(
      "Error: File '/notes/budget_sync_notes.md' not found. To find a file by what it says, use grep with one word from it. To see every file, use glob with **/*."
    );
    await run('write_file', { file_path: '/letter.txt', content: 'Dear landlord,\n' });
    expect(await run('edit_file', { file_path: '/letter.txt', old_string: '     1\tDear landlord,', new_string: 'Hi' })).toMatch(/without the line numbers/);
    expect(await run('grep', { pattern: 'nothing like this' })).toMatch(/^No matches found\. .*shorter word/);
  });

  it('pages long files', async () => {
    const { run } = setup();
    await run('write_file', { file_path: '/long.txt', content: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') });
    const page = await run('read_file', { file_path: '/long.txt', offset: 2, limit: 3 });
    expect(page).toContain('     3\tline 3');
    expect(page).toContain('Showing lines 3-5 of 10');
  });

  it('lists, globs and greps', async () => {
    const { run } = setup();
    await run('write_file', { file_path: '/g/health.md', content: 'Dentist on the 14th' });
    await run('write_file', { file_path: '/g/books.txt', content: 'The Overstory' });
    expect(await run('ls', { path: '/g' })).toBe('/g/books.txt\n/g/health.md');
    expect(await run('glob', { pattern: '*.md', path: '/g' })).toBe('/g/health.md');
    expect(await run('grep', { pattern: 'Dentist', path: '/g' })).toBe('/g/health.md');
    expect(await run('grep', { pattern: 'Dentist', path: '/g', output_mode: 'content' })).toBe('/g/health.md:\n  1: Dentist on the 14th');
  });

  it('keeps paths inside the workspace', async () => {
    const { run } = setup();
    expect(await run('read_file', { file_path: '../../etc/passwd' })).toMatch(/outside the workspace/);
  });

  it('reports each call, with the file it touched', async () => {
    const { run, activity } = setup();
    await run('write_file', { file_path: '/report.md', content: 'hi' });
    await run('open_file', { file_path: '/report.md' });
    await run('open_file', { file_path: '/missing.md' });
    expect(activity.map((a) => [a.name, a.label, a.ok, a.path])).toEqual([
      ['write_file', 'Wrote /report.md', true, '/report.md'],
      ['open_file', 'Opened /report.md', true, '/report.md'],
      ['open_file', 'Opened /missing.md', false, '/missing.md'],
    ]);
    expect(activity[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});
