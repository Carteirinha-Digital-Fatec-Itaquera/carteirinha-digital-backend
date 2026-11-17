import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class UploadService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadPhoto(file: any, ra: string): Promise<string> {
    const allowedFormats = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedFormats.includes(file.mimetype)) {
      throw new BadRequestException('Formato não permitido. Use JPG, PNG ou WEBP');
    }

    const maxSize = 200 * 1024; // 200KB
    if (file.size > maxSize) {
      throw new BadRequestException('Imagem muito grande. Tamanho máximo: 200KB');
    }

    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'carteirinha-digital',
          public_id: `${ra}_${Date.now()}`,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) reject(new BadRequestException('Erro ao fazer upload da foto'));
          else resolve(result!.secure_url);
        }
      ).end(file.buffer);
    });
  }

  async deletePhoto(photoUrl: string): Promise<void> {
  const parts = photoUrl.split('/');
  const filename = parts[parts.length - 1].split('.')[0]; // ra_timestamp
  const publicId = `carteirinha-digital/${filename}`;

  await cloudinary.uploader.destroy(publicId);
}

  async uploadPrivateEmployeePhoto(
    buffer: Buffer,
    storageKey: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: storageKey,
            type: 'authenticated',
            resource_type: 'image',
            overwrite: false,
          },
          (error) => {
            if (error) {
              reject(new Error('Erro ao fazer upload da foto privada'));
            } else {
              resolve();
            }
          },
        )
        .end(buffer);
    });
  }

  async getPrivateEmployeePhotoBuffer(
    storageKey: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const signedUrl = cloudinary.url(storageKey, {
      type: 'authenticated',
      sign_url: true,
      resource_type: 'image',
      secure: true,
    });
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar foto privada (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  async deletePrivateEmployeePhoto(storageKey: string): Promise<void> {
    await cloudinary.uploader.destroy(storageKey, {
      type: 'authenticated',
      resource_type: 'image',
      invalidate: true,
    });
  }
}