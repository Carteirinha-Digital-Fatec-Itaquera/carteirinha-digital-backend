import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/** Shared with event images: decode, orient, resize and strip metadata. */
export async function processImage(
  file: Express.Multer.File,
  width: number,
  formats = ['png', 'jpeg'],
  height?: number,
): Promise<Buffer> {
  if (!file || !file.buffer || file.size > 2 * 1024 * 1024)
    throw new BadRequestException('Envie uma imagem de atÃ© 2 MB.');
  try {
    const options = { limitInputPixels: 16000000 };
    const metadata = await sharp(file.buffer, options).metadata();
    if (!formats.includes(metadata.format || '') || (metadata.pages || 1) > 1)
      throw new Error('Formato invÃ¡lido');
    return await sharp(file.buffer, options)
      .rotate()
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new BadRequestException('Imagem invÃ¡lida ou formato nÃ£o permitido.');
  }
}
