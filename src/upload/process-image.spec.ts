import sharp from 'sharp';
import { processImage } from './process-image';

describe('shared image processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s and resizes to PNG',
    async (format) => {
      const buffer = await sharp({
        create: { width: 1024, height: 768, channels: 3, background: 'red' },
      })
        .toFormat(format)
        .toBuffer();
      const output = await processImage(
        { buffer, size: buffer.length } as Express.Multer.File,
        512,
        ['jpeg', 'png', 'webp'],
      );
      const meta = await sharp(output).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(384);
      expect(meta.exif).toBeUndefined();
    },
  );
  it('fits portrait photos inside the avatar dimensions without enlarging', async () => {
    const buffer = await sharp({
      create: { width: 400, height: 1200, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const output = await processImage(
      { buffer, size: buffer.length } as Express.Multer.File,
      512,
      ['png'],
      512,
    );
    const meta = await sharp(output).metadata();
    expect(meta.height).toBe(512);
    expect(meta.width).toBeLessThanOrEqual(512);
  });
  it('rejects corrupt images and oversized inputs', async () => {
    await expect(
      processImage(
        { buffer: Buffer.from('bad'), size: 3 } as Express.Multer.File,
        512,
      ),
    ).rejects.toThrow();
    await expect(
      processImage(
        { buffer: Buffer.from('bad'), size: 2097153 } as Express.Multer.File,
        512,
      ),
    ).rejects.toThrow();
  });
  it('keeps event images restricted to JPEG and PNG', async () => {
    const buffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'red' },
    })
      .webp()
      .toBuffer();
    await expect(
      processImage(
        { buffer, size: buffer.length } as Express.Multer.File,
        1000,
      ),
    ).rejects.toThrow();
  });
});
