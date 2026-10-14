import type { llm } from 'react-native-executorch';

import type { ToolActivity } from '@/harness/filesystem';

/*
 * Step 2 of the harness study: a planning tool, `todo`. The model writes its
 * steps before acting and ticks them off as it goes; each reply hands back the
 * checklist and the next step, so a failed call doesn't end the task. The plan
 * lives only in this session: nothing is written to the workspace.
 */

export const PLANNING_SYSTEM_PROMPT = `Planning (the todo tool is your own checklist, not the user's /todo.md file):
- For any request that takes more than one step, first call todo with your steps (e.g. find the file, read it, change it).
- Then do the steps in order. After each one, call todo again with that step marked done.
- Only give your final answer when every step is done.`;

export type PlanStep = { step: string; done: boolean };

export type PlanningTool = {
  tool: llm.ToolDefinition;
  /** The plan as last written. */
  plan: () => PlanStep[];
  /** Receives every call, like the file tools' listener; null stops reporting. */
  setActivityListener: (listener: ((activity: ToolActivity) => void) | null) => void;
};

/**
 * Reads the steps however a small model writes them: a list of {step, done}
 * objects, a list of strings, or one markdown checklist string ("- [x] read it").
 */
export function parseSteps(value: unknown): PlanStep[] {
  const items = typeof value === 'string' ? value.split('\n') : Array.isArray(value) ? value : [];
  return items
    .map((item): PlanStep | null => {
      if (typeof item === 'string') {
        const m = /^\s*(?:[-*]|\d+[.)])?\s*(?:\[([ xX])\])?\s*(.*?)\s*$/.exec(item);
        const step = m?.[2] ?? '';
        return step ? { step, done: m?.[1]?.toLowerCase() === 'x' } : null;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const step = String(o.step ?? o.task ?? o.title ?? o.name ?? '').trim();
        const done = o.done === true || o.done === 'true' || o.status === 'done' || o.status === 'completed';
        return step ? { step, done } : null;
      }
      return null;
    })
    .filter((s): s is PlanStep => s !== null);
}

/** The checklist handed back to the model, ending with what to do next. */
export function renderPlan(steps: PlanStep[]): string {
  const list = steps.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.step}`).join('\n');
  const next = steps.find((s) => !s.done);
  return next ? `Plan:\n${list}\n\nNext: ${next.step}` : `Plan:\n${list}\n\nEvery step is done. Give the user your final answer.`;
}

export function createPlanningTool(): PlanningTool {
  let current: PlanStep[] = [];
  let onActivity: ((activity: ToolActivity) => void) | null = null;

  const tool: llm.ToolDefinition = {
    type: 'function',
    function: {
      name: 'todo',
      description:
        "Your own step-by-step checklist for this request (not the user's /todo.md). Send every step each time, marking the finished ones done. Returns the checklist and the next step.",
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'All steps in order',
            items: {
              type: 'object',
              properties: { step: { type: 'string' }, done: { type: 'boolean' } },
              required: ['step', 'done'],
            },
          },
        },
        required: ['steps'],
      },
    },
    execute: async (args) => {
      const startedAt = Date.now();
      const steps = parseSteps(args?.steps);
      const ok = steps.length > 0;
      if (ok) current = steps;
      const result = ok ? renderPlan(steps) : 'Error: send steps as a list, e.g. [{step: "read /todo.md", done: false}]';
      onActivity?.({
        name: 'todo',
        label: ok ? `Plan: ${steps.filter((s) => s.done).length} of ${steps.length} done` : 'Plan (unreadable)',
        ok,
        args: args ?? {},
        startedAt,
        durationMs: Date.now() - startedAt,
        resultChars: result.length,
      });
      return result;
    },
  };

  return {
    tool,
    plan: () => current,
    setActivityListener: (listener) => {
      onActivity = listener;
    },
  };
}
