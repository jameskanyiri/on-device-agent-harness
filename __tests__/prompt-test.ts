jest.mock('react-native-blob-util', () => ({ __esModule: true, default: { fs: { dirs: { DocumentDir: '/docs' } } } }));

// eslint-disable-next-line import/first
import { BASH_SYSTEM_PROMPT } from '@/harness/bash';
// eslint-disable-next-line import/first
import { FILESYSTEM_SYSTEM_PROMPT } from '@/harness/filesystem';
// eslint-disable-next-line import/first
import { PLANNING_SYSTEM_PROMPT } from '@/harness/planning';
// eslint-disable-next-line import/first
import { harnessPrompt } from '@/harness/prompt';

describe('harnessPrompt', () => {
  it('without examples, is exactly the earlier steps’ prompts', () => {
    expect(harnessPrompt({ fileTools: true, planning: true })).toBe(`${FILESYSTEM_SYSTEM_PROMPT}\n\n${PLANNING_SYSTEM_PROMPT}`);
    expect(harnessPrompt({ bash: true })).toBe(BASH_SYSTEM_PROMPT);
    expect(harnessPrompt({})).toBe('');
  });

  it('with examples, shows one call per job for the tools that are on', () => {
    const bash = harnessPrompt({ bash: true, planning: true, examples: true });
    expect(bash).toMatch(/^You are James's assistant/);
    expect(bash).toContain(`bash(command="grep -ril 'invoice' /")`);
    expect(bash).toContain('todo(steps=[');
    expect(bash).not.toContain('read_file(');
    const files = harnessPrompt({ fileTools: true, examples: true });
    expect(files).toContain('grep(pattern="invoice")');
    expect(files).not.toContain('bash(');
    expect(files).not.toContain('todo(');
  });

  it('never uses the eval’s files or words', () => {
    const all = harnessPrompt({ fileTools: true, bash: true, planning: true, examples: true });
    expect(all).not.toMatch(/dentist|budget|landlord|wanjiru|drafts|todo\.md|health\.md/i);
  });
});
