import RNBlobUtil from 'react-native-blob-util';
import type { llm } from 'react-native-executorch';

import {
  cap,
  ensureDir,
  join,
  matchesGlob,
  normalize,
  readText,
  toDisk,
  ToolError,
  WORKSPACE_DIR,
  type ToolActivity,
} from '@/harness/filesystem';

/*
 * Step 3a of the harness study: the seven file tools replaced by one `bash`
 * tool. Its definition costs ~150 tokens instead of ~1,100, and the model has
 * seen these commands millions of times, unlike our own tool schemas.
 *
 * Nothing runs in a real shell (iOS has none, and it wouldn't be safe): this is
 * a small interpreter for the common file commands, working on the same
 * workspace folder as the file tools. Errors read like bash's, because the
 * model knows what to do after "cat: /notes: Is a directory".
 */

const COMMANDS = ['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'printf', 'sed', 'mkdir', 'touch', 'mv', 'cp', 'rm', 'sort', 'uniq', 'tee', 'open', 'pwd', 'cd'];

export const BASH_SYSTEM_PROMPT = `You have a private workspace of files on this phone that persists between chats. Use the bash tool to work with it. Paths start with /.
Commands: ls, cat, head, tail, wc, grep (-r -l -i -n), find, echo/printf with > or >>, cat > FILE <<'EOF', sed -i, mkdir, mv, cp, rm, touch, sort, and open FILE to show a file to the user. Pipes and && work.
Rules:
- Never say a file was created, saved, changed or opened unless a command did it in this reply and succeeded. If a command fails, say so.
- When asked to write something (a poem, a list, notes) and save it, write it yourself and save it in the same reply. Don't ask what to write unless the request is truly unclear.
- cat a file before changing it. To add to the end of a file, use >>.
- Only use bash when the request needs files.`;

const MAX_WALK = 1000;

// ── Parsing ─────────────────────────────────────────────────────────────────

type Token =
  | { kind: 'word'; value: string; glob: boolean }
  | { kind: 'op'; value: '|' | '&&' | '||' | ';' | '>' | '>>' | '<' | 'drop' }
  | { kind: 'heredoc'; body: string };

/**
 * Splits a command line into words and operators, with bash's quoting:
 * '…' is literal, "…" keeps spaces, \x escapes. A heredoc's body (the lines
 * after its line, up to the delimiter) becomes one token.
 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const heredocs: Extract<Token, { kind: 'heredoc' }>[] = [];
  const delimiters: string[] = [];
  let word = '';
  let inWord = false;
  let glob = false;
  const end = () => {
    if (inWord) tokens.push({ kind: 'word', value: word, glob });
    word = '';
    inWord = false;
    glob = false;
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === '\n') {
      end();
      i++;
      // Bodies of heredocs opened on this line come next, each up to its delimiter line.
      while (delimiters.length) {
        const delimiter = delimiters.shift()!;
        const body: string[] = [];
        while (i < line.length) {
          const next = line.indexOf('\n', i);
          const text = next === -1 ? line.slice(i) : line.slice(i, next);
          i = next === -1 ? line.length : next + 1;
          if (text.trim() === delimiter) break;
          body.push(text);
        }
        heredocs.shift()!.body = body.length ? body.join('\n') + '\n' : '';
      }
      tokens.push({ kind: 'op', value: ';' });
      continue;
    }
    if (c === ' ' || c === '\t') {
      end();
      i++;
      continue;
    }
    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      const stop = close === -1 ? line.length : close;
      word += line.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) i++;
        word += line[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === '\\') {
      if (line[i + 1] === '\n') {
        i += 2; // a line continuation
        continue;
      }
      word += line[i + 1] ?? '';
      inWord = true;
      i += 2;
      continue;
    }
    if (c === '<' && line[i + 1] === '<') {
      end();
      i += 2;
      if (line[i] === '-') i++;
      while (line[i] === ' ') i++;
      const m = /^(['"]?)([\w.-]+)\1/.exec(line.slice(i));
      const delimiter = m?.[2] ?? 'EOF';
      i += m?.[0].length ?? 0;
      const token = { kind: 'heredoc' as const, body: '' };
      tokens.push(token);
      heredocs.push(token);
      delimiters.push(delimiter);
      continue;
    }
    // 2>/dev/null, 2>&1 and the like: errors are always shown, so drop them.
    const stderr = /^2>>?(&1|\s*\S+)/.exec(line.slice(i));
    if (!inWord && stderr) {
      tokens.push({ kind: 'op', value: 'drop' });
      i += stderr[0].length;
      continue;
    }
    const op = ['&&', '||', '>>', '|', ';', '>', '<'].find((o) => line.startsWith(o, i));
    if (op) {
      end();
      tokens.push({ kind: 'op', value: op as Extract<Token, { kind: 'op' }>['value'] });
      i += op.length;
      continue;
    }
    if (c === '*' || c === '?') glob = true;
    word += c;
    inWord = true;
    i++;
  }
  end();
  return tokens;
}

type Command = { argv: { value: string; glob: boolean }[]; stdin?: string; inFile?: string; out?: { path: string; append: boolean } };
type Step = { pipeline: Command[]; then: '&&' | '||' | ';' };

function parse(tokens: Token[]): Step[] {
  const steps: Step[] = [];
  let pipeline: Command[] = [];
  let cmd: Command = { argv: [] };
  const endCommand = () => {
    if (cmd.argv.length || cmd.stdin !== undefined || cmd.out) pipeline.push(cmd);
    cmd = { argv: [] };
  };
  const endStep = (then: Step['then']) => {
    endCommand();
    if (pipeline.length) steps.push({ pipeline, then });
    pipeline = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'word') cmd.argv.push({ value: t.value, glob: t.glob });
    else if (t.kind === 'heredoc') cmd.stdin = t.body;
    else if (t.value === '|') endCommand();
    else if (t.value === '&&' || t.value === '||' || t.value === ';') endStep(t.value);
    else if (t.value === '>' || t.value === '>>' || t.value === '<') {
      const target = tokens[i + 1];
      if (target?.kind !== 'word') throw new ToolError(`bash: syntax error near '${t.value}'`);
      i++;
      if (t.value === '<') cmd.inFile = target.value;
      else cmd.out = { path: target.value, append: t.value === '>>' };
    }
  }
  endStep(';');
  return steps;
}

// ── Running ─────────────────────────────────────────────────────────────────

type Result = { out: string; err: string; code: number };
const ok = (out = ''): Result => ({ out, err: '', code: 0 });
const fail = (err: string, code = 1): Result => ({ out: '', err: err.endsWith('\n') ? err : err + '\n', code });

/** Short flags (-rin → r, i, n) and the remaining arguments; `--` ends flags. */
function flags(args: string[], withValue = ''): { set: Set<string>; values: Record<string, string>; rest: string[] } {
  const set = new Set<string>();
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (/^-\d+$/.test(a)) values.n = a.slice(1);
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      values[k!] = v ?? 'true';
    } else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j]!;
        if (withValue.includes(f)) {
          values[f] = a.slice(j + 1) || args[++i] || '';
          break;
        }
        set.add(f);
      }
    } else rest.push(a);
  }
  return { set, values, rest };
}

const lines = (text: string) => {
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  return all;
};
const unlines = (all: string[]) => (all.length ? all.join('\n') + '\n' : '');

function escapes(text: string): string {
  return text.replace(/\\([ntr\\])/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' })[c]!);
}

/** A grep or sed pattern as a JS RegExp: basic regex's \| \( \) and \{ \} become extended. */
function toRegExp(pattern: string, opts: { fixed?: boolean; extended?: boolean; ignoreCase?: boolean; word?: boolean; global?: boolean }): RegExp {
  let source = opts.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
  if (!opts.fixed && !opts.extended) {
    source = source.replace(/\\([|(){}+?])|([|(){}+?])/g, (_, escaped: string, plain: string) => (escaped ? escaped : `\\${plain}`));
  }
  if (opts.word) source = `\\b(?:${source})\\b`;
  const f = (opts.ignoreCase ? 'i' : '') + (opts.global ? 'g' : '');
  try {
    return new RegExp(source, f);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f);
  }
}

export type BashTool = {
  tool: llm.ToolDefinition;
  /** Receives every call, like the file tools' listener; null stops reporting. */
  setActivityListener: (listener: ((activity: ToolActivity) => void) | null) => void;
};

/**
 * The `bash` tool, working in `root` (the user's workspace unless a benchmark
 * passes its own). Create one per chat session: overwriting a file with `>`
 * needs it to have been read (or written) earlier in that session.
 */
export function createBashTool({ root = WORKSPACE_DIR }: { root?: string } = {}): BashTool {
  const known = new Set<string>(); // files read or written this session
  let cwd = '/';
  let onActivity: ((activity: ToolActivity) => void) | null = null;

  const fs = RNBlobUtil.fs;
  const resolve = (p: string) => normalize(p === '~' ? '/' : p.startsWith('~/') ? p.slice(1) : p.startsWith('/') ? p : join(cwd, p));
  const exists = (p: string) => fs.exists(toDisk(root, p));
  const isDir = (p: string) => fs.isDir(toDisk(root, p));

  async function readFile(cmd: string, arg: string): Promise<string> {
    const path = resolve(arg);
    if (!(await exists(path))) throw new ToolError(`${cmd}: ${arg}: No such file or directory`);
    if (await isDir(path)) throw new ToolError(`${cmd}: ${arg}: Is a directory`);
    const text = await readText(root, path);
    known.add(path);
    return text;
  }

  async function writeFile(cmd: string, arg: string, content: string, append: boolean): Promise<string> {
    const path = resolve(arg);
    if (path === '/') throw new ToolError(`${cmd}: /: Is a directory`);
    const there = await exists(path);
    if (there && (await isDir(path))) throw new ToolError(`${cmd}: ${arg}: Is a directory`);
    if (there && !append && !known.has(path)) {
      throw new ToolError(`${cmd}: ${arg}: file exists and you haven't read it. cat it first, or use >> to add to the end`);
    }
    await ensureDir(root, path.slice(0, path.lastIndexOf('/')) || '/');
    const before = there && append ? await readText(root, path) : '';
    const joined = before && !before.endsWith('\n') && content ? `${before}\n` : before;
    await fs.writeFile(toDisk(root, path), joined + content, 'utf8');
    known.add(path);
    return path;
  }

  /** Every file and folder under `dir`. */
  async function walkAll(dir: string): Promise<{ path: string; dir: boolean }[]> {
    const found: { path: string; dir: boolean }[] = [];
    const queue = [dir];
    while (queue.length && found.length < MAX_WALK) {
      const current = queue.shift()!;
      for (const entry of await fs.lstat(toDisk(root, current))) {
        const path = join(current, entry.filename);
        const folder = entry.type === 'directory';
        found.push({ path, dir: folder });
        if (folder) queue.push(path);
      }
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Unquoted * and ? match workspace paths, as in bash; no match keeps the word. */
  async function expand(argv: Command['argv']): Promise<string[]> {
    const out: string[] = [];
    for (const a of argv) {
      if (!a.glob || a.value.startsWith('-')) {
        out.push(a.value);
        continue;
      }
      const absolute = a.value.startsWith('/');
      const pattern = absolute ? a.value : join(cwd, a.value);
      const depth = pattern.split('/').length;
      const matches = (await walkAll('/'))
        .filter((f) => f.path.split('/').length === depth && matchesGlob(f.path, '/', pattern.slice(1)))
        .map((f) => (absolute ? f.path : f.path.slice(cwd === '/' ? 1 : cwd.length + 1)));
      out.push(...(matches.length ? matches : [a.value]));
    }
    return out;
  }

  /** The text a command reads: its files, or stdin. */
  async function inputs(cmd: string, files: string[], stdin: string | null): Promise<{ name: string; text: string }[]> {
    if (!files.length) return [{ name: '(standard input)', text: stdin ?? '' }];
    const texts: { name: string; text: string }[] = [];
    for (const f of files) texts.push({ name: f, text: f === '-' ? (stdin ?? '') : await readFile(cmd, f) });
    return texts;
  }

  const opened: string[] = [];
  const touched: string[] = [];

  const commands: Record<string, (args: string[], stdin: string | null) => Promise<Result>> = {
    pwd: async () => ok(`${cwd}\n`),

    cd: async ([dir = '/']) => {
      const path = resolve(dir);
      if (!(await exists(path)) || !(await isDir(path))) return fail(`cd: ${dir}: No such file or directory`);
      cwd = path;
      return ok();
    },

    ls: async (args) => {
      const { set, rest } = flags(args);
      const targets = rest.length ? rest : ['.'];
      const out: string[] = [];
      let code = 0;
      let err = '';
      for (const t of targets) {
        const path = resolve(t);
        if (!(await exists(path))) {
          err += `ls: cannot access '${t}': No such file or directory\n`;
          code = 2;
          continue;
        }
        if (!(await isDir(path))) {
          out.push(t);
          continue;
        }
        const entries = set.has('R')
          ? (await walkAll(path)).map((e) => e.path.slice(path === '/' ? 1 : path.length + 1) + (e.dir ? '/' : ''))
          : (await fs.lstat(toDisk(root, path))).map((e) => e.filename + (e.type === 'directory' ? '/' : '')).sort();
        const shown = set.has('a') ? entries : entries.filter((e) => !e.startsWith('.'));
        if (targets.length > 1) out.push(`${t}:`);
        out.push(...shown);
        if (targets.length > 1) out.push('');
      }
      return { out: unlines(out), err, code };
    },

    cat: async (args, stdin) => {
      const { set, rest } = flags(args);
      const text = (await inputs('cat', rest, stdin)).map((f) => f.text).join('');
      if (!set.has('n')) return ok(text);
      return ok(unlines(lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`)));
    },

    head: async (args, stdin) => {
      const { values, rest } = flags(args, 'n');
      const n = Number(values.n ?? 10);
      const files = await inputs('head', rest, stdin);
      return ok(files.map((f) => (files.length > 1 ? `==> ${f.name} <==\n` : '') + unlines(lines(f.text).slice(0, n))).join(''));
    },

    tail: async (args, stdin) => {
      const { values, rest } = flags(args, 'n');
      const raw = values.n ?? '10';
      const files = await inputs('tail', rest, stdin);
      const pick = (all: string[]) => (raw.startsWith('+') ? all.slice(Number(raw) - 1) : all.slice(-Number(raw) || all.length));
      return ok(files.map((f) => (files.length > 1 ? `==> ${f.name} <==\n` : '') + unlines(pick(lines(f.text)))).join(''));
    },

    wc: async (args, stdin) => {
      const { set, rest } = flags(args);
      const which = ['l', 'w', 'c'].filter((f) => set.has(f));
      const show = which.length ? which : ['l', 'w', 'c'];
      const files = await inputs('wc', rest, stdin);
      const count = (t: string) => ({ l: (t.match(/\n/g) ?? []).length, w: t.split(/\s+/).filter(Boolean).length, c: t.length });
      return ok(
        unlines(
          files.map((f) => {
            const n = count(f.text);
            const nums = show.map((k) => String(n[k as 'l' | 'w' | 'c'])).join(' ');
            return rest.length ? `${nums} ${f.name}` : nums;
          })
        )
      );
    },

    grep: async (args, stdin) => {
      const { set, values, rest } = flags(args, 'eABCm');
      const pattern = values.e ?? rest.shift();
      if (pattern === undefined) return fail('usage: grep [-rilnvcw] PATTERN [FILE...]', 2);
      const re = toRegExp(pattern, { fixed: set.has('F'), extended: set.has('E'), ignoreCase: set.has('i'), word: set.has('w') });
      const recursive = set.has('r') || set.has('R');
      const include = values.include;
      let targets: { name: string; text: string }[] = [];
      let err = '';
      const paths = rest.length ? rest : recursive && stdin === null ? ['.'] : [];
      for (const p of paths) {
        const path = resolve(p);
        if (!(await exists(path))) {
          err += `grep: ${p}: No such file or directory\n`;
          continue;
        }
        if (await isDir(path)) {
          if (!recursive) {
            err += `grep: ${p}: Is a directory\n`;
            continue;
          }
          for (const f of await walkAll(path)) {
            if (f.dir || (include && !matchesGlob(f.path, path, include))) continue;
            try {
              targets.push({ name: f.path, text: await readText(root, f.path) });
              known.add(f.path);
            } catch {
              // too large or unreadable
            }
          }
        } else targets.push({ name: p, text: await readFile('grep', p) });
      }
      if (!paths.length) targets = [{ name: '(standard input)', text: stdin ?? '' }];
      const named = (set.has('H') || targets.length > 1 || recursive) && !set.has('h');
      const out: string[] = [];
      let matched = false;
      for (const t of targets) {
        const hits = lines(t.text)
          .map((text, i) => ({ text, n: i + 1 }))
          .filter((l) => re.test(l.text) !== set.has('v'));
        if (hits.length) matched = true;
        if (set.has('l')) {
          if (hits.length) out.push(t.name);
        } else if (set.has('c')) out.push(named ? `${t.name}:${hits.length}` : String(hits.length));
        else for (const h of hits) out.push(`${named ? `${t.name}:` : ''}${set.has('n') ? `${h.n}:` : ''}${h.text}`);
      }
      return { out: unlines(out), err, code: err && !matched ? 2 : matched ? 0 : 1 };
    },

    find: async (args) => {
      const starts: string[] = [];
      let i = 0;
      while (i < args.length && !args[i]!.startsWith('-')) starts.push(args[i++]!);
      const tests: ((f: { path: string; dir: boolean }) => boolean)[] = [];
      for (; i < args.length; i++) {
        const a = args[i]!;
        const v = args[i + 1] ?? '';
        if (a === '-name' || a === '-iname') {
          const re = new RegExp(`^${v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, a === '-iname' ? 'i' : '');
          tests.push((f) => re.test(f.path.split('/').pop() ?? ''));
          i++;
        } else if (a === '-type') {
          tests.push((f) => (v === 'd' ? f.dir : !f.dir));
          i++;
        } else if (a === '-maxdepth' || a === '-mindepth') i++;
      }
      const out: string[] = [];
      let err = '';
      for (const s of starts.length ? starts : ['.']) {
        const path = resolve(s);
        if (!(await exists(path))) {
          err += `find: '${s}': No such file or directory\n`;
          continue;
        }
        const all = (await isDir(path)) ? [{ path, dir: true }, ...(await walkAll(path))] : [{ path, dir: false }];
        out.push(...all.filter((f) => tests.every((t) => t(f))).map((f) => f.path));
      }
      return { out: unlines(out), err, code: err ? 1 : 0 };
    },

    // Like zsh's and sh's echo (not bash's): \n and \t are turned into a new line and a tab
    // unless -E is given. Gemma writes `echo "a\nb" > file` expecting two lines (step3a-smoke).
    echo: async (args) => {
      let n = false;
      let e = true;
      while (/^-[neE]+$/.test(args[0] ?? '')) {
        n ||= args[0]!.includes('n');
        if (args[0]!.includes('E')) e = false;
        args = args.slice(1);
      }
      const text = args.join(' ');
      return ok((e ? escapes(text) : text) + (n ? '' : '\n'));
    },

    printf: async ([format = '', ...args]) => {
      let out = '';
      let rest = args;
      do {
        let used = 0;
        out += escapes(format).replace(/%([sd%])/g, (_, c: string) => (c === '%' ? '%' : (rest[used++] ?? '')));
        rest = rest.slice(used);
        if (!used) break;
      } while (rest.length);
      return ok(out);
    },

    sed: async (args, stdin) => {
      const { set, values, rest } = flags(args, 'e');
      const script = values.e ?? rest.shift() ?? '';
      const edit = (text: string): string => {
        const all = lines(text);
        const sub = /^s(.)(.*?)\1(.*?)\1([gip]*)$/s.exec(script);
        if (sub) {
          const re = toRegExp(sub[2]!, { extended: set.has('E') || set.has('r'), ignoreCase: sub[4]!.includes('i'), global: sub[4]!.includes('g') });
          const replacement = sub[3]!.replace(/\\n/g, '\n').replace(/\\\//g, '/').replace(/&/g, '$$&');
          return unlines(all.map((l) => l.replace(re, replacement)));
        }
        // $a text / 3a text / 3i text / 3d / /pattern/d
        const cmd = /^(\$|\d+|\/(.*)\/)\s*([aid])\\?\s?(.*)$/s.exec(script);
        if (!cmd) throw new ToolError(`sed: unsupported script '${script}' (use s/old/new/g, $a text, Nd or /pattern/d)`);
        const [, where, regex, op, text2] = cmd;
        const at = (i: number) => (where === '$' ? i === all.length - 1 : regex !== undefined ? toRegExp(regex, {}).test(all[i]!) : i === Number(where) - 1);
        const out: string[] = [];
        all.forEach((l, i) => {
          if (op === 'i' && at(i)) out.push(text2!);
          if (!(op === 'd' && at(i))) out.push(l);
          if (op === 'a' && at(i)) out.push(text2!);
        });
        if (!all.length && op === 'a') out.push(text2!);
        return unlines(out);
      };
      if (set.has('i')) {
        if (!rest.length) return fail('sed: no input files');
        for (const f of rest) {
          const before = await readFile('sed', f);
          const path = resolve(f);
          await fs.writeFile(toDisk(root, path), edit(before), 'utf8');
          touched.push(path);
        }
        return ok();
      }
      return ok((await inputs('sed', rest, stdin)).map((f) => edit(f.text)).join(''));
    },

    mkdir: async (args) => {
      const { rest } = flags(args);
      for (const d of rest) {
        const path = resolve(d);
        if ((await exists(path)) && !(await isDir(path))) return fail(`mkdir: ${d}: File exists`);
        await ensureDir(root, path);
      }
      return ok();
    },

    touch: async (args) => {
      for (const f of args) if (!(await exists(resolve(f)))) touched.push(await writeFile('touch', f, '', true));
      return ok();
    },

    cp: async (args) => {
      const { rest } = flags(args);
      if (rest.length < 2) return fail('usage: cp SOURCE DEST');
      const dest = rest.pop()!;
      const into = (await exists(resolve(dest))) && (await isDir(resolve(dest)));
      for (const s of rest) {
        const text = await readFile('cp', s);
        const target = into ? join(resolve(dest), s.split('/').pop()!) : dest;
        known.add(resolve(target));
        touched.push(await writeFile('cp', target, text, false));
      }
      return ok();
    },

    mv: async (args) => {
      const { rest } = flags(args);
      if (rest.length < 2) return fail('usage: mv SOURCE DEST');
      const dest = rest.pop()!;
      const into = (await exists(resolve(dest))) && (await isDir(resolve(dest)));
      for (const s of rest) {
        const from = resolve(s);
        if (!(await exists(from))) return fail(`mv: ${s}: No such file or directory`);
        const to = into ? join(resolve(dest), from.split('/').pop()!) : resolve(dest);
        await ensureDir(root, to.slice(0, to.lastIndexOf('/')) || '/');
        await fs.mv(toDisk(root, from), toDisk(root, to));
        known.add(to);
        touched.push(to);
      }
      return ok();
    },

    rm: async (args) => {
      const { set, rest } = flags(args);
      for (const f of rest) {
        const path = resolve(f);
        if (path === '/') return fail('rm: refusing to remove /');
        if (!(await exists(path))) {
          if (set.has('f')) continue;
          return fail(`rm: ${f}: No such file or directory`);
        }
        if ((await isDir(path)) && !set.has('r') && !set.has('R')) return fail(`rm: ${f}: is a directory`);
        await fs.unlink(toDisk(root, path));
        touched.push(path);
      }
      return ok();
    },

    sort: async (args, stdin) => {
      const { set, rest } = flags(args);
      let all = (await inputs('sort', rest, stdin)).flatMap((f) => lines(f.text));
      all = set.has('n') ? all.sort((a, b) => parseFloat(a) - parseFloat(b)) : all.sort();
      if (set.has('r')) all.reverse();
      if (set.has('u')) all = all.filter((l, i) => all.indexOf(l) === i);
      return ok(unlines(all));
    },

    uniq: async (args, stdin) => {
      const all = (await inputs('uniq', flags(args).rest, stdin)).flatMap((f) => lines(f.text));
      return ok(unlines(all.filter((l, i) => l !== all[i - 1])));
    },

    tee: async (args, stdin) => {
      const { set, rest } = flags(args);
      for (const f of rest) touched.push(await writeFile('tee', f, stdin ?? '', set.has('a')));
      return ok(stdin ?? '');
    },

    open: async ([file]) => {
      if (!file) return fail('usage: open FILE');
      await readFile('open', file);
      const path = resolve(file);
      opened.push(path);
      return ok(`Opened ${path} for the user.\n`);
    },
  };

  async function run(commandLine: string): Promise<Result> {
    const steps = parse(tokenize(commandLine.replace(/\r\n/g, '\n')));
    let last: Result = ok();
    let out = '';
    let err = '';
    for (let s = 0; s < steps.length; s++) {
      const prev = steps[s - 1];
      if (prev && ((prev.then === '&&' && last.code !== 0) || (prev.then === '||' && last.code === 0))) continue;
      let stdin: string | null = null;
      for (const cmd of steps[s]!.pipeline) {
        const [name, ...args] = await expand(cmd.argv);
        let result: Result;
        try {
          if (cmd.inFile !== undefined) stdin = await readFile('bash', cmd.inFile);
          if (cmd.stdin !== undefined) stdin = cmd.stdin;
          if (!name) result = ok(stdin ?? ''); // a bare `> file` or `<<EOF` writes stdin
          else if (!commands[name]) result = fail(`bash: ${name}: command not found. Available: ${COMMANDS.join(', ')}`, 127);
          else result = await commands[name]!(args, stdin);
          if (cmd.out && result.code === 0) {
            touched.push(await writeFile('bash', cmd.out.path, result.out, cmd.out.append));
            result = { ...result, out: '' };
          }
        } catch (e) {
          result = fail(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e));
        }
        err += result.err;
        stdin = result.out;
        last = result;
      }
      out += stdin ?? '';
    }
    return { out, err, code: last.code };
  }

  const tool: llm.ToolDefinition = {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command in the workspace (a sandbox with common file commands). Pipes, &&, > and >>, and heredocs work. Returns the output.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'e.g. grep -ril dentist /notes' } },
        required: ['command'],
      },
    },
    execute: async (args) => {
      const startedAt = Date.now();
      const command = typeof args?.command === 'string' ? args.command : '';
      opened.length = 0;
      touched.length = 0;
      let result: Result;
      try {
        await ensureDir(root, '/');
        result = command.trim() ? await run(command) : fail('bash: command is required');
      } catch (e) {
        result = fail(e instanceof Error ? e.message.replace(/^Error: /, '') : String(e));
      }
      // grep finding nothing (exit 1, no errors) is an answer, not a failure.
      const succeeded = result.code === 0 || (result.code === 1 && !result.err);
      const text = result.out + result.err;
      const shown = text.trim()
        ? cap(text.replace(/\n$/, ''), 'Narrow it with head, grep or a smaller path.')
        : succeeded
          ? result.code === 1
            ? '(no matches)'
            : '(done, no output)'
          : `(failed with exit code ${result.code})`;
      const firstLine = command.trim().split('\n')[0] ?? '';
      onActivity?.({
        name: 'bash',
        label: opened.length ? `Opened ${opened.at(-1)}` : `$ ${firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine}`,
        ok: succeeded,
        path: opened.at(-1) ?? touched.at(-1),
        opens: opened.length > 0,
        args: args ?? {},
        startedAt,
        durationMs: Date.now() - startedAt,
        resultChars: shown.length,
      });
      return shown;
    },
  };

  return {
    tool,
    setActivityListener: (listener) => {
      onActivity = listener;
    },
  };
}
