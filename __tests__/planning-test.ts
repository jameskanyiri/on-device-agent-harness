import { parseGemmaToolCalls } from '@/harness/gemma-tool-parser';
import { createPlanningTool, parseSteps, renderPlan } from '@/harness/planning';
import type { ToolActivity } from '@/harness/filesystem';

const Q = '<|"|>';

describe('parseSteps', () => {
  it('reads a list of {step, done}', () => {
    expect(parseSteps([{ step: 'find the note', done: true }, { step: 'edit the todo', done: false }])).toEqual([
      { step: 'find the note', done: true },
      { step: 'edit the todo', done: false },
    ]);
  });

  it('reads plain strings and a markdown checklist', () => {
    expect(parseSteps(['find the note', 'edit the todo'])).toEqual([
      { step: 'find the note', done: false },
      { step: 'edit the todo', done: false },
    ]);
    expect(parseSteps('- [x] find the note\n- [ ] edit the todo\n')).toEqual([
      { step: 'find the note', done: true },
      { step: 'edit the todo', done: false },
    ]);
  });

  it('accepts other names small models use (task, status)', () => {
    expect(parseSteps([{ task: 'read /todo.md', status: 'completed' }])).toEqual([{ step: 'read /todo.md', done: true }]);
  });

  it('reads the steps from a Gemma tool call', () => {
    const text = `<|tool_call>call:todo{steps:[{step:${Q}grep for dentist${Q},done:true},{step:${Q}edit /todo.md${Q},done:false}]}<tool_call|>`;
    const args = parseGemmaToolCalls(text)!.toolCalls[0]!.function.arguments as Record<string, unknown>;
    expect(parseSteps(args.steps)).toEqual([
      { step: 'grep for dentist', done: true },
      { step: 'edit /todo.md', done: false },
    ]);
  });

  it('nothing usable gives no steps', () => {
    expect(parseSteps(undefined)).toEqual([]);
    expect(parseSteps([{ done: true }, '', 42])).toEqual([]);
  });
});

describe('renderPlan', () => {
  it('ends with the next step, or with "answer now" when all are done', () => {
    expect(renderPlan([{ step: 'a', done: true }, { step: 'b', done: false }])).toBe('Plan:\n1. [x] a\n2. [ ] b\n\nNext: b');
    expect(renderPlan([{ step: 'a', done: true }])).toMatch(/Every step is done/);
  });
});

describe('todo tool', () => {
  it('keeps the latest plan and reports each call', async () => {
    const planning = createPlanningTool();
    const seen: ToolActivity[] = [];
    planning.setActivityListener((a) => seen.push(a));
    await planning.tool.execute!({ steps: [{ step: 'find it', done: false }] });
    const result = await planning.tool.execute!({ steps: [{ step: 'find it', done: true }] });
    expect(result).toMatch(/Every step is done/);
    expect(planning.plan()).toEqual([{ step: 'find it', done: true }]);
    expect(seen.map((a) => [a.name, a.ok, a.label])).toEqual([
      ['todo', true, 'Plan: 0 of 1 done'],
      ['todo', true, 'Plan: 1 of 1 done'],
    ]);
  });

  it('an unreadable plan is a failed call that keeps the old plan', async () => {
    const planning = createPlanningTool();
    await planning.tool.execute!({ steps: ['read it'] });
    const result = await planning.tool.execute!({ steps: [] });
    expect(result).toMatch(/^Error:/);
    expect(planning.plan()).toEqual([{ step: 'read it', done: false }]);
  });
});
