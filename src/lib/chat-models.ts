import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import { models, type LLMModel } from 'react-native-executorch';

export type ChatModel = {
  id: string;
  /** Short name for the composer pill. */
  name: string;
  description: string;
  /** Approximate download size on a real iPhone (MLX int4 variant). */
  sizeLabel: string;
  config: LLMModel;
  /** Accepts photos (vision-language model). */
  vision?: boolean;
  /** Can call tools (the filesystem tools in src/harness/filesystem.ts). */
  tools?: boolean;
};

// DEFAULT picks the best variant per platform (MLX int4 on a real iPhone).
export const CHAT_MODELS: ChatModel[] = [
  {
    id: 'gemma4-e2b',
    name: 'Gemma 4',
    description: 'Google Gemma 4 E2B · strongest answers',
    sizeLabel: '2.9 GB',
    config: models.llm.GEMMA4_E2B.DEFAULT,
    tools: true,
  },
  // MedGemma (MEDGEMMA_1_5_4B) is set up but not offered: the XNNPACK export
  // peaks above iOS's 3.54 GB per-app limit on an iPhone 15 Pro and is killed
  // while loading (JetsamEvent, per-process-limit). The increased-memory-limit
  // entitlement would lift that, but a free Apple ID can't sign it.
  {
    id: 'lfm2.5-1.2b',
    name: 'LFM 2.5',
    description: 'Liquid LFM2.5 1.2B · fast multi-turn chat',
    sizeLabel: '0.9 GB',
    config: models.llm.LFM2_5_1_2B.DEFAULT,
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen 3',
    description: 'Qwen3 1.7B · reasoning and tool use',
    sizeLabel: '1.5 GB',
    config: models.llm.QWEN3_1_7B.DEFAULT,
  },
  {
    id: 'lfm2.5-vl-450m',
    name: 'LFM 2.5 Vision',
    description: 'Liquid LFM2.5-VL 450M · understands photos',
    sizeLabel: '0.65 GB',
    // Pinned to XNNPACK (CPU): the MLX export can't prefill a whole image in one
    // call (fails with Error::NotSupported); XNNPACK's per-call window fits it.
    config: models.llm.LFM2_5_VL_450M.XNNPACK_8DA4W,
    vision: true,
  },
  {
    id: 'lfm2.5-350m',
    name: 'LFM 2.5 Mini',
    description: 'Liquid LFM2.5 350M · tiny and very fast',
    sizeLabel: '0.3 GB',
    config: models.llm.LFM2_5_350M.DEFAULT,
  },
];

// Mirrors react-native-executorch's private `cachePathFor` (src/fetcher/fetcher.ts)
// so we can tell which models are already on the phone. Completed downloads live
// at this path; in-progress ones use a separate `.partial` file.
const CACHE_DIR =
  Platform.OS === 'android'
    ? `${RNBlobUtil.fs.dirs.SDCardDir || RNBlobUtil.fs.dirs.DocumentDir}/react-native-executorch`
    : `${RNBlobUtil.fs.dirs.DocumentDir}/react-native-executorch`;

const djb2 = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
};

function cachePathFor(url: string): string {
  const urlWithoutQuery = url.split('?')[0]!;
  const basename = urlWithoutQuery.split('/').pop() || 'model';
  return `${CACHE_DIR}/${djb2(urlWithoutQuery)}_${basename}`;
}

export async function isModelDownloaded(model: ChatModel): Promise<boolean> {
  try {
    return await RNBlobUtil.fs.exists(cachePathFor(model.config.modelPath));
  } catch {
    return false;
  }
}

/** Size of a downloaded model file in bytes, or 0 if it isn't on the phone. */
export async function modelFileSize(model: ChatModel): Promise<number> {
  try {
    const path = cachePathFor(model.config.modelPath);
    if (!(await RNBlobUtil.fs.exists(path))) return 0;
    return Number((await RNBlobUtil.fs.stat(path)).size) || 0;
  } catch {
    return 0;
  }
}

/**
 * Deletes a model's weights from the phone. The small tokenizer files are kept
 * (some are shared between sizes); the weights are what take up space.
 */
export async function deleteModelFile(model: ChatModel): Promise<void> {
  const path = cachePathFor(model.config.modelPath);
  if (await RNBlobUtil.fs.exists(path)) await RNBlobUtil.fs.unlink(path);
}

export const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export const VISION_MODEL = CHAT_MODELS.find((m) => m.vision)!;

/**
 * Model files from earlier versions of the app that it no longer uses (e.g. the
 * LFM2.5-VL 1.6B MLX export, which couldn't take images). Deleted on launch so
 * they don't sit in storage where Settings → Storage can't list them.
 */
const RETIRED_MODEL_URLS = [models.llm.LFM2_5_VL_1_6B.MLX_INT4.modelPath];

export async function deleteRetiredModels(): Promise<void> {
  await Promise.all(
    RETIRED_MODEL_URLS.map(async (url) => {
      const path = cachePathFor(url);
      if (await RNBlobUtil.fs.exists(path)) await RNBlobUtil.fs.unlink(path).catch(() => {});
    })
  );
}
