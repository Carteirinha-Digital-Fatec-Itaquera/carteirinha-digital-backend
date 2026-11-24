import type { EmployeePhotoAttemptView } from '../contracts/v1-employees.types';
import type { EmployeePhotoAudit } from './entities/employee.entity';

export function latestPhotoAttempt(
  audits: EmployeePhotoAudit[] = [],
): EmployeePhotoAttemptView | null {
  const latest = audits[0];
  if (!latest || latest.action === 'PHOTO_REMOVED') return null;
  const fields = latest.changedFields;
  if (
    !fields ||
    typeof fields !== 'object' ||
    !('photoId' in fields) ||
    typeof fields.photoId !== 'string'
  )
    return null;
  const statuses = {
    PHOTO_UPLOADED: 'PENDING',
    PHOTO_APPROVED: 'APPROVED',
    PHOTO_REJECTED: 'REJECTED',
  } as const;
  const status = statuses[latest.action as keyof typeof statuses];
  if (!status) return null;
  return {
    photoId: fields.photoId,
    reviewStatus: status,
    reviewReason: latest.reason,
    reviewedAt: status === 'PENDING' ? null : latest.createdAt.toISOString(),
  };
}
