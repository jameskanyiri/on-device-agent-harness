import RNBlobUtil from 'react-native-blob-util';
import type { llm } from 'react-native-executorch';

/*
 * Filesystem tools for the on-device model, ported from workpods_agent's
 * FilesystemMiddleware (ls, read_file, write_file, edit_file, glob, grep).
 *
 * Differences from workpods:
 * - Backed by a real folder in the app's Documents (`workspace/`) instead of a
 *   per-thread virtual filesystem, so files persist across chats. The model
 *   sees it as `/`; paths can't escape it.
 * - Text only (no images, PDFs or artifact specs), and no `activity` argument.
 * - Smaller read windows and output caps: the model's context is a few
 *   thousand tokens, not hundreds of thousands.
 */

export const WORKSPACE_DIR = `${RNBlobUtil.fs.dirs.DocumentDir}/workspace`;

// ── Limits ──────────────────────────────────────────────────────────────────
const DEFAULT_READ_LIMIT = 200; // lines
const MAX_LINE_LENGTH = 1000; // longer lines are split into continuation lines
const LINE_NUMBER_WIDTH = 6;
const MAX_OUTPUT_CHARS = 8000; // ~2k tokens per tool result
const MAX_FILE_BYTES = 1_000_000; // larger files are refused (likely binary)
const MAX_WALK_FILES = 1000; // glob/grep stop after this many files
const MAX_GREP_LINES = 100;

export const FILESYSTEM_SYSTEM_PROMPT = `You have a private workspace of files on this phone that persists between chats. Paths start with /.
- ls: list a folder
- read_file: read a file (line-numbered; use offset/limit for long files)
- write_file: create a new file
- edit_file: replace exact text in a file you have read
- glob: find files by name pattern, e.g. **/*.md
- grep: search file contents for literal text
- open_file: show a file to the user on their screen
Read a file before editing it. Prefer editing an existing file over creating a new one. Only use the tools when the request needs files.`;

// ── Paths ───────────────────────────────────────────────────────────────────

class ToolError extends Error {}

/** Normalizes a model-supplied path to `/a/b` form; rejects escaping the workspace. */
function normalize(path: unknown): string {
  const raw = typeof path === 'string' && path.trim() ? path.trim() : '/';
  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new ToolError(`Error: Path '${raw}' is outside the workspace`);
      parts.pop();
    } else parts.push(segment);
  }
  return '/' + parts.join('/');
}

/** Where a workspace path lives on disk, under `root` (a folder in Documents). */
const toDisk = (root: string, virtual: string) => (virtual === '/' ? root : root + virtual);

const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

async function ensureDir(root: string, virtual: string): Promise<void> {
  let current = '';
  for (const part of ['', ...virtual.split('/').filter(Boolean)]) {
    current = part ? `${current}/${part}` : '';
    const disk = toDisk(root, current || '/');
    if (!(await RNBlobUtil.fs.exists(disk))) await RNBlobUtil.fs.mkdir(disk);
    else if (!(await RNBlobUtil.fs.isDir(disk))) {
      throw new ToolError(`Error: '${current}' is a file, not a folder`);
    }
  }
}

/** Reads a workspace file for the app's file viewer. Throws a readable message on failure. */
export async function readWorkspaceFile(path: string, root = WORKSPACE_DIR): Promise<string> {
  return readText(root, normalize(path));
}

async function readText(root: string, virtual: string): Promise<string> {
  const disk = toDisk(root, virtual);
  if (!(await RNBlobUtil.fs.exists(disk))) throw new ToolError(`Error: File '${virtual}' not found`);
  if (await RNBlobUtil.fs.isDir(disk)) {
    throw new ToolError(`Error: '${virtual}' is a folder; use ls to list it`);
  }
  const { size } = await RNBlobUtil.fs.stat(disk);
  if (Number(size) > MAX_FILE_BYTES) {
    throw new ToolError(`Error: '${virtual}' is too large to read (${size} bytes)`);
  }
  return RNBlobUtil.fs.readFile(disk, 'utf8');
}

export type WalkedFile = { path: string; modified: number };

/** Every file under `dir` (recursively), capped at MAX_WALK_FILES. */
export async function walk(root: string, dir: string): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const queue = [dir];
  while (queue.length && files.length < MAX_WALK_FILES) {
    const current = queue.shift()!;
    const disk = toDisk(root, current);
    if (!(await RNBlobUtil.fs.exists(disk)) || !(await RNBlobUtil.fs.isDir(disk))) continue;
    for (const entry of await RNBlobUtil.fs.lstat(disk)) {
      const path = join(current, entry.filename);
      if (entry.type === 'directory') queue.push(path);
      else files.push({ path, modified: Number(entry.lastModified) || 0 });
    }
  }
  return files;
}

/** Glob → RegExp: `**` spans folders, `*` and `?` stay within one name. */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      const slash = pattern[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Whether `path` (under `base`) matches a glob; a pattern without `/` matches file names. */
function matchesGlob(path: string, base: string, pattern: string): boolean {
  const relative = base === '/' ? path.slice(1) : path.slice(base.length + 1);
  const pat = pattern.replace(/^\/+/, '');
  const target = pat.includes('/') ? relative : (relative.split('/').pop() ?? relative);
  return globToRegExp(pat).test(target);
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** `cat -n` style, splitting over-long lines into continuation lines (5.1, 5.2, …). */
function withLineNumbers(lines: string[], startLine: number): string {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const n = i + startLine;
    const chunks = Math.max(1, Math.ceil(line.length / MAX_LINE_LENGTH));
    for (let c = 0; c < chunks; c++) {
      const label = c === 0 ? String(n) : `${n}.${c}`;
      out.push(
        `${label.padStart(LINE_NUMBER_WIDTH)}\t${line.slice(c * MAX_LINE_LENGTH, (c + 1) * MAX_LINE_LENGTH)}`
      );
    }
  });
  return out.join('\n');
}

function cap(text: string, hint: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[Output truncated at ${MAX_OUTPUT_CHARS} characters. ${hint}]`;
}

const toInt = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const str = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

// ── Tools ───────────────────────────────────────────────────────────────────

/** A tool call as shown in the chat, e.g. "Read /notes.md". */
export type ToolActivity = {
  name: string;
  label: string;
  ok: boolean;
  /** The file the call touched, if any (tapping the step opens it). */
  path?: string;
  /** Arguments the model passed (benchmarks record them; the chat doesn't persist them). */
  args?: Record<string, unknown>;
  /** When the call started (ms since epoch) and how long it took. */
  startedAt?: number;
  durationMs?: number;
  /** Length of the result handed back to the model, in characters. */
  resultChars?: number;
};

export type FilesystemTools = {
  tools: llm.ToolDefinition[];
  /** Receives every tool call (for the UI and for benchmarks); null stops reporting. */
  setActivityListener: (listener: ((activity: ToolActivity) => void) | null) => void;
};

/**
 * The filesystem tools (workpods' six, plus open_file to show a file to the user),
 * working in `root` (the user's workspace unless a benchmark passes its own).
 * Create one set per chat session: `edit_file` only edits files read (or
 * written) earlier in that session.
 */
export function createFilesystemTools({ root = WORKSPACE_DIR }: { root?: string } = {}): FilesystemTools {
  const readPaths = new Set<string>();
  let onActivity: ((activity: ToolActivity) => void) | null = null;

  const tool = (
    name: string,
    description: string,
    parameters: llm.ToolParameters,
    label: (args: Record<string, unknown>) => string,
    run: (args: Record<string, unknown>) => Promise<string>,
    /** Argument naming the file the call works on. */
    fileArg?: string
  ): llm.ToolDefinition => ({
    type: 'function',
    function: { name, description, parameters },
    execute: async (args) => {
      const startedAt = Date.now();
      let result: string;
      let ok = true;
      try {
        await ensureDir(root, '/');
        result = await run(args ?? {});
      } catch (e) {
        ok = false;
        result = e instanceof ToolError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      let shown = name;
      let path: string | undefined;
      try {
        shown = label(args ?? {});
        if (fileArg) path = normalize(args?.[fileArg]);
      } catch {
        // A path outside the workspace: the step shows without a file.
      }
      onActivity?.({
        name,
        label: shown,
        ok: ok && !result.startsWith('Error:'),
        path,
        args: args ?? {},
        startedAt,
        durationMs: Date.now() - startedAt,
        resultChars: result.length,
      });
      return result;
    },
  });

  const tools = [
    tool(
      'ls',
      'List the files and folders directly inside a folder of the workspace. Folders end with /.',
      {
        type: 'object',
        properties: { path: { type: 'string', description: 'Folder to list, e.g. / or /notes' } },
      },
      (a) => `Listed ${normalize(a.path)}`,
      async (args) => {
        const path = normalize(args.path);
        const disk = toDisk(root, path);
        if (!(await RNBlobUtil.fs.exists(disk))) throw new ToolError(`Error: Folder '${path}' not found`);
        if (!(await RNBlobUtil.fs.isDir(disk))) throw new ToolError(`Error: '${path}' is a file, not a folder`);
        const entries = (await RNBlobUtil.fs.lstat(disk))
          .map((e) => join(path, e.filename) + (e.type === 'directory' ? '/' : ''))
          .sort();
        return entries.length ? cap(entries.join('\n'), 'Use glob to narrow it down.') : `(no files under ${path})`;
      }
    ),

    tool(
      'read_file',
      `Read a text file. Returns line-numbered content (cat -n). Reads ${DEFAULT_READ_LIMIT} lines by default; use offset and limit (in lines) for long files. Read a file before editing it.`,
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'File to read, e.g. /notes/todo.md' },
          offset: { type: 'integer', description: 'Line to start from (0-based). Default 0' },
          limit: { type: 'integer', description: `Number of lines to read. Default ${DEFAULT_READ_LIMIT}` },
        },
        required: ['file_path'],
      },
      (a) => `Read ${normalize(a.file_path)}`,
      async (args) => {
        const path = normalize(args.file_path);
        const content = await readText(root, path);
        readPaths.add(path);
        if (!content.trim()) return 'System reminder: File exists but has empty contents';
        const lines = content.split('\n');
        if (lines.at(-1) === '') lines.pop();
        const offset = toInt(args.offset, 0);
        const limit = Math.max(1, toInt(args.limit, DEFAULT_READ_LIMIT));
        const selected = lines.slice(offset, offset + limit);
        if (!selected.length) {
          throw new ToolError(`Error: offset ${offset} is beyond end of file (${lines.length} lines)`);
        }
        let body = withLineNumbers(selected, offset + 1);
        if (offset + limit < lines.length) {
          body += `\n\n[Showing lines ${offset + 1}-${offset + selected.length} of ${lines.length}. Use offset/limit to read more.]`;
        }
        return cap(body, 'Use a smaller limit.');
      }
    ,
      'file_path'
    ),

    tool(
      'write_file',
      'Create a NEW text file with the full content. Fails if the file exists: read it and use edit_file instead. Missing folders are created.',
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'File to create, e.g. /notes/ideas.md' },
          content: { type: 'string', description: 'Full content of the file' },
        },
        required: ['file_path', 'content'],
      },
      (a) => `Wrote ${normalize(a.file_path)}`,
      async (args) => {
        const path = normalize(args.file_path);
        const content = str(args.content);
        if (path === '/') throw new ToolError('Error: file_path must name a file');
        if (!content.trim()) {
          throw new ToolError('Error: content is required (empty/whitespace-only rejected).');
        }
        if (await RNBlobUtil.fs.exists(toDisk(root, path))) {
          throw new ToolError(`Error: '${path}' already exists. Read it and use edit_file, or write to a new path.`);
        }
        await ensureDir(root, path.slice(0, path.lastIndexOf('/')) || '/');
        await RNBlobUtil.fs.writeFile(toDisk(root, path), content, 'utf8');
        readPaths.add(path); // its content is known, so it can be edited right away
        return `Created file ${path}`;
      }
    ,
      'file_path'
    ),

    tool(
      'edit_file',
      'Replace exact text in a file you have read. old_string must match the file exactly (without the line-number prefix) and be unique, unless replace_all is true.',
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'File to edit' },
          old_string: { type: 'string', description: 'Exact text to replace' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
      (a) => `Edited ${normalize(a.file_path)}`,
      async (args) => {
        const path = normalize(args.file_path);
        const content = await readText(root, path);
        if (!readPaths.has(path)) {
          throw new ToolError(`Error: You must read '${path}' with read_file before editing it.`);
        }
        const oldString = str(args.old_string);
        const newString = str(args.new_string);
        if (!oldString) throw new ToolError('Error: old_string is required');
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) throw new ToolError(`Error: String not found in file: '${oldString}'`);
        if (occurrences > 1 && args.replace_all !== true) {
          throw new ToolError(
            `Error: String '${oldString}' appears ${occurrences} times. Use replace_all=true to replace all, or provide a more specific string with surrounding context.`
          );
        }
        await RNBlobUtil.fs.writeFile(toDisk(root, path), content.split(oldString).join(newString), 'utf8');
        return `Edited ${path} (${occurrences} replacement(s))`;
      }
    ,
      'file_path'
    ),

    tool(
      'glob',
      'Find files by path pattern, newest first. * matches within a name, ** across folders, ? one character. A pattern without / matches file names anywhere, e.g. *.md',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. **/*.md' },
          path: { type: 'string', description: 'Folder to search in. Default /' },
        },
        required: ['pattern'],
      },
      (a) => `Searched for ${str(a.pattern)}`,
      async (args) => {
        const pattern = str(args.pattern);
        if (!pattern) throw new ToolError('Error: pattern is required');
        const base = normalize(args.path);
        const matches = (await walk(root, base))
          .filter((f) => matchesGlob(f.path, base, pattern))
          .sort((a, b) => b.modified - a.modified)
          .map((f) => f.path);
        return matches.length ? cap(matches.join('\n'), 'Use a narrower pattern.') : 'No files found';
      }
    ),

    tool(
      'grep',
      'Search file contents for literal text (not a regex). output_mode: files_with_matches (default, file paths), content (matching lines with line numbers) or count.',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text to search for' },
          path: { type: 'string', description: 'Folder to search in. Default /' },
          glob: { type: 'string', description: 'Only search files whose name matches, e.g. *.md' },
          output_mode: {
            type: 'string',
            enum: ['files_with_matches', 'content', 'count'],
            description: 'What to return',
          },
        },
        required: ['pattern'],
      },
      (a) => `Searched files for “${str(a.pattern)}”`,
      async (args) => {
        const pattern = str(args.pattern);
        if (!pattern) throw new ToolError('Error: pattern is required');
        const base = normalize(args.path);
        const nameGlob = str(args.glob);
        const mode = str(args.output_mode) || 'files_with_matches';
        const results = new Map<string, { line: number; text: string }[]>();
        for (const file of await walk(root, base)) {
          if (nameGlob && !matchesGlob(file.path, base, nameGlob)) continue;
          let content: string;
          try {
            content = await readText(root, file.path);
          } catch {
            continue; // too large or unreadable
          }
          content.split('\n').forEach((text, i) => {
            if (!text.includes(pattern)) return;
            const hits = results.get(file.path) ?? [];
            hits.push({ line: i + 1, text });
            results.set(file.path, hits);
          });
        }
        if (!results.size) return 'No matches found';
        const paths = [...results.keys()].sort();
        if (mode === 'count') return paths.map((p) => `${p}: ${results.get(p)!.length}`).join('\n');
        if (mode !== 'content') return cap(paths.join('\n'), 'Narrow it with path or glob.');
        const lines: string[] = [];
        for (const p of paths) {
          lines.push(`${p}:`);
          for (const hit of results.get(p)!) lines.push(`  ${hit.line}: ${hit.text}`);
        }
        const shown = lines.slice(0, MAX_GREP_LINES).join('\n');
        const more = lines.length > MAX_GREP_LINES ? `\n[${lines.length - MAX_GREP_LINES} more lines not shown]` : '';
        return cap(shown + more, 'Narrow it with path or glob.');
      }
    ),

    tool(
      'open_file',
      'Show a file to the user: it opens full screen on their phone so they can read it. Use it when the user asks to see, open or show a file, or after creating a file they will want to look at. You do not get the contents back; use read_file for that.',
      {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'File to show, e.g. /notes/todo.md' } },
        required: ['file_path'],
      },
      (a) => `Opened ${normalize(a.file_path)}`,
      async (args) => {
        const path = normalize(args.file_path);
        await readText(root, path); // fails clearly if it's missing, a folder or too large
        return `Opened ${path} for the user.`;
      },
      'file_path'
    ),
  ];

  return {
    tools,
    setActivityListener: (listener) => {
      onActivity = listener;
    },
  };
}
