import { Injectable } from '@nestjs/common';
import * as qrcode from 'qrcode'

@Injectable()
export class QrCodeService {
    async generateQrCode(data: string): Promise<string> {
        try {
            const qrCodeDataURL = await qrcode.toDataURL(data);
            return qrCodeDataURL;
        } catch (error) {
            throw new Error('Falha ao gerar QR code.');
        }
    }
}
