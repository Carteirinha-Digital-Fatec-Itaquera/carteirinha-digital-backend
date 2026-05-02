import { Injectable, BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class UploadService {
  private readonly uploadDir = './uploads/fotos';

  constructor() {
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  async uploadPhoto(file: any, ra: string): Promise<string> {
  // async uploadPhoto(file: Express.Multer.File, ra: string): Promise<string> {
    const allowedFormats = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedFormats.includes(file.mimetype)) {
      throw new BadRequestException('Formato não permitido. Use JPG, PNG ou WEBP');
    }

    
    let extension = '';
    switch (file.mimetype) {
      case 'image/jpeg':
        extension = '.jpg';
        break;
      case 'image/png':
        extension = '.png';
        break;
      case 'image/webp':
        extension = '.webp';
        break;
    }

  
    const timestamp = Date.now();
    const filename = `${ra}_${timestamp}${extension}`;
    const filepath = path.join(this.uploadDir, filename);

    
    await fs.writeFile(filepath, file.buffer);

    return `/uploads/fotos/${filename}`;
  }
}