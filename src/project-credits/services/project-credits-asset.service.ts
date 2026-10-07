import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { PrismaService } from '../../database/prisma.service';

export interface ProcessedPhotoResult {
  buffer: Buffer;
  mimeType: string;
}

@Injectable()
export class ProjectCreditsAssetService {
  private readonly logger = new Logger(ProjectCreditsAssetService.name);
  private readonly isCloudinaryConfigured: boolean;

  constructor(private readonly prisma: PrismaService) {
    this.isCloudinaryConfigured = Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET,
    );

    if (this.isCloudinaryConfigured) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    }
  }

  async processPhoto(buffer: Buffer): Promise<ProcessedPhotoResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Buffer da imagem vazio ou ausente.');
    }

    if (buffer.length > 2 * 1024 * 1024) {
      throw new BadRequestException('Imagem excede o limite máximo de 2 MB.');
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException(
        'Arquivo de imagem inválido ou corrompido.',
      );
    }

    const allowedFormats = ['jpeg', 'jpg', 'png', 'webp'];
    if (!metadata.format || !allowedFormats.includes(metadata.format)) {
      throw new BadRequestException(
        'Formato inválido. Apenas JPG, PNG ou WebP são permitidos.',
      );
    }

    try {
      const processedBuffer = await sharp(buffer)
        .rotate()
        .resize(256, 256, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 85 })
        .toBuffer();

      return {
        buffer: processedBuffer,
        mimeType: 'image/webp',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao processar imagem com sharp: ${msg}`);
      throw new InternalServerErrorException(
        'Falha no processamento da imagem.',
      );
    }
  }

  async uploadDraftPhoto(
    contributorId: string,
    version: number,
    buffer: Buffer,
  ): Promise<{ storageKey: string }> {
    const publicId = `draft_${contributorId}_v${version}_${Date.now()}`;
    const storageKey = `project-credits/private/${publicId}`;

    if (!this.isCloudinaryConfigured) {
      this.logger.warn(
        'Cloudinary não configurado. Utilizando storageKey simulada para ambiente de teste.',
      );
      return { storageKey };
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: storageKey,
          type: 'authenticated',
          resource_type: 'image',
          format: 'webp',
          overwrite: true,
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error(
              `Erro no upload authenticated para Cloudinary: ${error?.message}`,
            );
            return reject(
              new InternalServerErrorException(
                'Falha ao armazenar foto rascunho no servidor de mídia.',
              ),
            );
          }
          resolve({ storageKey: result.public_id });
        },
      );
      uploadStream.end(buffer);
    });
  }

  async publishPhoto(
    contributorId: string,
    version: number,
    buffer: Buffer,
  ): Promise<{ publicUrl: string; storageKey: string }> {
    const publicId = `pub_${contributorId}_v${version}_${Date.now()}`;
    const storageKey = `project-credits/public/${publicId}`;

    if (!this.isCloudinaryConfigured) {
      this.logger.warn(
        'Cloudinary não configurado. Utilizando URL simulada para ambiente de teste.',
      );
      return {
        publicUrl: `https://mock.cdn.local/credits/${publicId}.webp`,
        storageKey,
      };
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: storageKey,
          type: 'upload',
          resource_type: 'image',
          format: 'webp',
          overwrite: true,
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error(
              `Erro no upload público para Cloudinary: ${error?.message}`,
            );
            return reject(
              new InternalServerErrorException(
                'Falha ao publicar foto no servidor de mídia.',
              ),
            );
          }
          resolve({
            publicUrl: result.secure_url,
            storageKey: result.public_id,
          });
        },
      );
      uploadStream.end(buffer);
    });
  }

  getPrivateDownloadUrl(storageKey: string): string {
    if (!this.isCloudinaryConfigured) {
      return `https://mock.cdn.local/private/${storageKey}.webp`;
    }
    return cloudinary.url(storageKey, {
      type: 'authenticated',
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  async queueAssetCleanup(storageKey: string, source = 'CREDITS_PHOTO'): Promise<void> {
    try {
      await this.prisma.projectCreditAssetCleanup.create({
        data: {
          storageKey,
          source,
          status: 'PENDING',
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falha ao enfileirar limpeza de asset ${storageKey}: ${msg}`,
      );
    }
  }

  async destroyAsset(storageKey: string, type: 'authenticated' | 'upload' = 'authenticated'): Promise<void> {
    if (!this.isCloudinaryConfigured || !storageKey) return;
    try {
      await cloudinary.uploader.destroy(storageKey, {
        type,
        invalidate: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Erro ao destruir asset ${storageKey} (${type}): ${msg}. Enfileirando na limpeza.`,
      );
      await this.queueAssetCleanup(storageKey);
    }
  }
}
