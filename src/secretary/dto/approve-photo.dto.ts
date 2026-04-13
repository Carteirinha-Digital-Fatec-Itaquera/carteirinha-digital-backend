export class ApprovePhotoDto {
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
}