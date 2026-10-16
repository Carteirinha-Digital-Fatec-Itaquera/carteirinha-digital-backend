import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { createHash, randomUUID } from 'node:crypto';
import { processImage } from '../upload/process-image';

@Injectable()
export class EventStorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
  private configured() {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    )
      throw new ServiceUnavailableException(
        'Armazenamento de certificados não configurado.',
      );
  }
  async put(buffer: Buffer, pdf = false, requestedKey?: string) {
    this.configured();
    const id =
      requestedKey || `event-certificates/${randomUUID()}${pdf ? '.pdf' : ''}`;
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: id,
          resource_type: pdf ? 'raw' : 'image',
          type: 'authenticated',
          overwrite: false,
          timeout: 60000,
        },
        (error) =>
          error
            ? reject(
                new ServiceUnavailableException(
                  'Falha ao armazenar documento.',
                ),
              )
            : resolve(),
      );
      stream.end(buffer);
    });
    return {
      storageKey: id,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }
  async remove(key: string, pdf = false) {
    this.configured();
    await cloudinary.uploader.destroy(key, {
      resource_type: pdf ? 'raw' : 'image',
      type: 'authenticated',
      invalidate: true,
    });
  }
  async image(file: Express.Multer.File, kind: string) {
    if (
      !file ||
      file.size > 2 * 1024 * 1024 ||
      !['SIGNATURE', 'BACKGROUND'].includes(kind)
    )
      throw new BadRequestException('Envie PNG ou JPEG de até 2 MB.');
    const buffer = await processImage(file, kind === 'BACKGROUND' ? 2400 : 1000);
    return this.put(buffer);
  }
  async get(key: string, pdf = false) {
    this.configured();
    const url = cloudinary.utils.private_download_url(key, pdf ? '' : 'png', {
      resource_type: pdf ? 'raw' : 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: false,
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Documento temporariamente indisponível.',
      );
    return Buffer.from(await response.arrayBuffer());
  }
}
