import { Skia } from '@shopify/react-native-skia';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import RNBlobUtil from 'react-native-blob-util';
import type { ImageBuffer } from 'react-native-executorch/cv';

export type PhotoSource = 'camera' | 'library';

export type Attachment = {
  /** Copy kept in the app's Documents folder, so it still shows when a chat is reopened. */
  uri: string;
  /** Raw RGBA pixels for the vision model. */
  buffer: ImageBuffer;
};

/**
 * Longest side of the photo we decode. The model resizes to its own encoder
 * size anyway; decoding a 12 MP photo would cost ~48 MB of pixels for nothing.
 */
const MAX_SIDE = 1024;

const ATTACHMENTS_DIR = `${RNBlobUtil.fs.dirs.DocumentDir}/attachments`;

/** Lets the user take or pick a photo, then prepares it for the model. Null if cancelled. */
export async function pickPhoto(source: PhotoSource): Promise<Attachment | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      source === 'camera' ? 'Camera access is turned off.' : 'Photo access is turned off.'
    );
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  // Downscale, then keep a JPEG copy in Documents (picker files live in a temp cache).
  const landscape = asset.width >= asset.height;
  const rendered = await ImageManipulator.manipulate(asset.uri)
    .resize(
      landscape
        ? { width: Math.min(asset.width, MAX_SIDE) }
        : { height: Math.min(asset.height, MAX_SIDE) }
    )
    .renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });

  await RNBlobUtil.fs.mkdir(ATTACHMENTS_DIR).catch(() => {});
  const dest = `${ATTACHMENTS_DIR}/${Date.now().toString(36)}.jpg`;
  await RNBlobUtil.fs.cp(saved.uri.replace('file://', ''), dest);
  const uri = `file://${dest}`;

  return { uri, buffer: await decode(uri) };
}

/** Decodes an image file into the RGBA pixel buffer react-native-executorch expects. */
async function decode(uri: string): Promise<ImageBuffer> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Could not read that photo.');
  const pixels = image.readPixels();
  if (!(pixels instanceof Uint8Array)) throw new Error('Could not read that photo.');
  return {
    data: pixels,
    width: image.width(),
    height: image.height(),
    format: 'rgba',
    layout: 'hwc',
  };
}
