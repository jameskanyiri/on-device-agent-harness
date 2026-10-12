import { router } from 'expo-router';

/** Opens a workspace file in the viewer sheet (src/app/file.tsx). */
export function openFile(path: string) {
  router.push({ pathname: '/file', params: { path } });
}
