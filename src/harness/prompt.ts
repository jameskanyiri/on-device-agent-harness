import { BASH_SYSTEM_PROMPT } from '@/harness/bash';
import { FILESYSTEM_SYSTEM_PROMPT } from '@/harness/filesystem';
import { PLANNING_SYSTEM_PROMPT } from '@/harness/planning';

/*
 * The system prompt for a set of tools.
 *
 * Without examples it's the tools' own prompts, as in Steps 1–3a. With examples
 * (Step 3b) it's one prompt in the user's framing: who the assistant is, what
 * each tool is for, one worked example per job, and rules taken from failures
 * seen in the evals. Small models learn tool use from examples far better than
 * from rules (on-device-talk/research-notes.md).
 *
 * The examples never use the eval's files or words (dentist, budget, landlord,
 * /todo.md): a gain should come from learning the method, not the answers.
 */

export type PromptTools = { fileTools?: boolean; bash?: boolean; planning?: boolean; examples?: boolean };

const USER = 'James';

const FILE_TOOLS_LINE = `- File tools (ls, glob, grep, read_file, write_file, edit_file, open_file): work with ${USER}'s files. Paths start with /.`;
const BASH_LINE = `- bash: work with ${USER}'s files. Paths start with /.`;
const PLANNING_LINE = `- todo: your own checklist (not a file). For anything with more than one step, first write your steps, then mark each one done as you go. Answer only when every step is done.`;

const FILE_TOOLS_EXAMPLES = `How to use the file tools (each line is one call):
- List a folder: ls(path="/notes")
- See every file: glob(pattern="**/*")
- Find files that mention something: grep(pattern="invoice")   (searches inside files; never guess a file name)
- Find files by name: glob(pattern="**/*.md")
- Read: read_file(file_path="/notes/trip.md")
- Create: write_file(file_path="/notes/errands.md", content="Buy stamps")
- Change text (read the file first): edit_file(file_path="/notes/trip.md", old_string="Friday", new_string="Monday")
- Add an item to a list (read the file first): edit_file(file_path="/tasks.md", old_string="- [ ] Call the bank", new_string="- [ ] Call the bank\\n- [ ] Pay invoice")
- Tick an item: edit_file(file_path="/tasks.md", old_string="- [ ] Pay invoice", new_string="- [x] Pay invoice")
- Show a file to ${USER}: open_file(file_path="/notes/trip.md")   (read_file only shows it to you)`;

const BASH_EXAMPLES = `How to use bash (each line is one call):
- List a folder: bash(command="ls /notes")
- See every file: bash(command="ls -R /")
- Find files that mention something: bash(command="grep -ril 'invoice' /")   (searches inside files; never guess a file name)
- Find files by name: bash(command="find / -name '*.md'")
- Read: bash(command="cat /notes/trip.md")
- Create: bash(command="echo 'Buy stamps' > /notes/errands.md")
- Create with several lines:
  bash(command="cat > /notes/plan.md <<'EOF'
  # Plan
  - Book flights
  EOF")
- Change text: bash(command="sed -i 's/Friday/Monday/' /notes/trip.md")
- Add an item to a list: bash(command="echo '- [ ] Pay invoice' >> /tasks.md")
- Tick an item: bash(command="sed -i 's/- \\[ \\] Pay invoice/- [x] Pay invoice/' /tasks.md")
- Copy: bash(command="cp /notes/trip.md /archive/trip.md")
- Move or rename: bash(command="mv /notes/old.md /notes/new.md")
- Delete: bash(command="rm /notes/old.md")
- Show a file to ${USER}: bash(command="open /notes/trip.md")   (cat only shows it to you)`;

const PLANNING_EXAMPLE = `How to plan: todo(steps=[{step: "find the invoice note", done: true}, {step: "add Pay invoice to /tasks.md", done: false}])`;

const RULES = `Rules:
- Read a file before you describe, quote or change it.
- Use the real text from ${USER}'s files, never placeholders like [date].
- When you add to a list in a file, write the new line in the same style as the others (e.g. "- [ ] Pay invoice").
- If ${USER} pasted the text in the message, answer from it. Don't look for a file.
- Answer questions about this conversation or general knowledge yourself, without tools.
- Never say a file was created, changed or opened unless the tool succeeded. If it fails, say so.`;

export function harnessPrompt({ fileTools, bash, planning, examples }: PromptTools): string {
  if (!examples) {
    return [fileTools && FILESYSTEM_SYSTEM_PROMPT, bash && BASH_SYSTEM_PROMPT, planning && PLANNING_SYSTEM_PROMPT].filter(Boolean).join('\n\n');
  }
  const lines = [planning && PLANNING_LINE, fileTools && FILE_TOOLS_LINE, bash && BASH_LINE].filter(Boolean) as string[];
  if (!lines.length) return '';
  const intro = `You are ${USER}'s assistant, running privately on ${USER}'s phone. You have these tools:`;
  return [
    [intro, ...lines].join('\n'),
    fileTools && FILE_TOOLS_EXAMPLES,
    bash && BASH_EXAMPLES,
    planning && PLANNING_EXAMPLE,
    RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
}
