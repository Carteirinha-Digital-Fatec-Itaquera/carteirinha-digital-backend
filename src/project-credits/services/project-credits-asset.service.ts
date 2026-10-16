import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { EventStorageService } from '../../public-events/event-storage.service';
import { processImage } from '../../upload/process-image';

@Injectable()
export class ProjectCreditsAssetService extends EventStorageService {
  async uploadPhoto(file: Express.Multer.File) {
    const buffer = await processImage(file, 512, ['jpeg', 'png', 'webp'], 512);
    return this.put(buffer, false, `project-credits/${randomUUID()}`);
  }

  previewUrl(key: string): string {
    return cloudinary.utils.private_download_url(key, 'png', {
      resource_type: 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 600,
      attachment: false,
    });
  }
}
