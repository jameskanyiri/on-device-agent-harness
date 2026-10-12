import RNBlobUtil from 'react-native-blob-util';
import type { LLMModel } from 'react-native-executorch';

/*
 * MedGemma 1.5 4B isn't in react-native-executorch's catalog, so it's put
 * together from two community repos, each pinned to a commit:
 *
 * - the model: kamalkraj's ExecuTorch export (XNNPACK, 8-bit activations and
 *   4-bit weights, 4096-token context; the longer-context exports need 10 GB+).
 *   It's a multimodal export (`token_embedding` + `text_decoder`), so it loads
 *   through the multimodal runner even though the app only sends it text.
 * - the tokenizer: mlx-community's ungated copy of Google's.
 *
 * Neither repo has a `tokenizer_config.json` with the chat template inside (the
 * MLX copy keeps it in `chat_template.jinja`), which the library requires, so
 * the app writes its own to the phone at launch.
 */

const MODEL_URL =
  'https://huggingface.co/kamalkraj/medgemma-1.5-4b-it-executorch/resolve/592c2d7b4f5a5d799ef3f2800f1edfcc17540c44/4096/model.pte';
const TOKENIZER_URL =
  'https://huggingface.co/mlx-community/medgemma-1.5-4b-it-4bit/resolve/762746b7a72b0b68dd8fa3f9aea5dc3980674d23/tokenizer.json';

// Google's MedGemma 1.5 chat template, verbatim.
const CHAT_TEMPLATE = `{{ bos_token }}
{%- if messages[0]['role'] == 'system' -%}
    {%- if messages[0]['content'] is string -%}
        {%- set first_user_prefix = messages[0]['content'] + '

' -%}
    {%- else -%}
        {%- set first_user_prefix = messages[0]['content'][0]['text'] + '

' -%}
    {%- endif -%}
    {%- set loop_messages = messages[1:] -%}
{%- else -%}
    {%- set first_user_prefix = "" -%}
    {%- set loop_messages = messages -%}
{%- endif -%}
{%- for message in loop_messages -%}
    {%- if (message['role'] == 'user') != (loop.index0 % 2 == 0) -%}
        {{ raise_exception("Conversation roles must alternate user/assistant/user/assistant/...") }}
    {%- endif -%}
    {%- if (message['role'] == 'assistant') -%}
        {%- set role = "model" -%}
    {%- else -%}
        {%- set role = message['role'] -%}
    {%- endif -%}
    {{ '<start_of_turn>' + role + '
' + (first_user_prefix if loop.first else "") }}
    {%- if message['content'] is string -%}
        {{ message['content'] | trim }}
    {%- elif message['content'] is iterable -%}
        {%- for item in message['content'] -%}
            {%- if item['type'] == 'image' -%}
                {{ '<start_of_image>' }}
            {%- elif item['type'] == 'text' -%}
                {{ item['text'] | trim }}
            {%- endif -%}
        {%- endfor -%}
    {%- else -%}
        {{ raise_exception("Invalid content type") }}
    {%- endif -%}
    {{ '<end_of_turn>
' }}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{'<start_of_turn>model
'}}
{%- endif -%}`;

// Only the fields the library reads. `eot_token` adds `<end_of_turn>` to the
// stop tokens: a Gemma reply ends with it, not with `<eos>`.
const TOKENIZER_CONFIG = JSON.stringify({
  bos_token: '<bos>',
  eos_token: '<eos>',
  eot_token: '<end_of_turn>',
  pad_token: '<pad>',
  chat_template: CHAT_TEMPLATE,
});

const DIR = `${RNBlobUtil.fs.dirs.DocumentDir}/medgemma`;
const TOKENIZER_CONFIG_PATH = `${DIR}/tokenizer_config.json`;

export const MEDGEMMA_1_5_4B: LLMModel = {
  modelPath: MODEL_URL,
  tokenizerPath: TOKENIZER_URL,
  tokenizerConfigPath: TOKENIZER_CONFIG_PATH,
  // The export's graph is the multimodal one; no image config, so photos stay off.
  modalities: ['image'],
};

/**
 * Writes MedGemma's tokenizer config to the phone, if it's missing or out of
 * date. Written to a temp file and moved into place, so a session loading at
 * the same time never reads half a file (iOS won't move over an existing file,
 * so an outdated one is removed first).
 */
export async function ensureMedGemmaFiles(): Promise<void> {
  try {
    if (await RNBlobUtil.fs.exists(TOKENIZER_CONFIG_PATH)) {
      const current = await RNBlobUtil.fs.readFile(TOKENIZER_CONFIG_PATH, 'utf8');
      if (current === TOKENIZER_CONFIG) return;
      await RNBlobUtil.fs.unlink(TOKENIZER_CONFIG_PATH);
    } else if (!(await RNBlobUtil.fs.isDir(DIR))) {
      await RNBlobUtil.fs.mkdir(DIR);
    }
    const tmp = `${TOKENIZER_CONFIG_PATH}.tmp`;
    await RNBlobUtil.fs.writeFile(tmp, TOKENIZER_CONFIG, 'utf8');
    await RNBlobUtil.fs.mv(tmp, TOKENIZER_CONFIG_PATH);
  } catch {
    // MedGemma then fails to load with a clear error; the other models are unaffected.
  }
}
