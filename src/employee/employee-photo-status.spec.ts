import { latestPhotoAttempt } from './employee-photo-status';

describe('Metadados da última tentativa de fotografia', () => {
  it('apresenta somente metadados de rejeição, sem imagem privada', () => {
    const result = latestPhotoAttempt([
      {
        action: 'PHOTO_REJECTED',
        reason: 'Imagem desfocada.',
        changedFields: { photoId: 'foto-sintetica' },
        createdAt: new Date('2026-11-23T12:00:00Z'),
      },
    ]);
    expect(result).toEqual({
      photoId: 'foto-sintetica',
      reviewStatus: 'REJECTED',
      reviewReason: 'Imagem desfocada.',
      reviewedAt: '2026-11-23T12:00:00.000Z',
    });
    expect(result).not.toHaveProperty('contentUrl');
    expect(result).not.toHaveProperty('storageKey');
  });
  it('limpa a tentativa após remoção e aceita registros legados sem auditoria', () => {
    expect(latestPhotoAttempt()).toBeNull();
    expect(
      latestPhotoAttempt([
        {
          action: 'PHOTO_REMOVED',
          reason: null,
          changedFields: { removed: true },
          createdAt: new Date(),
        },
      ]),
    ).toBeNull();
  });
  it('não transforma auditoria incompleta em um estado inventado', () => {
    expect(
      latestPhotoAttempt([
        {
          action: 'PHOTO_REJECTED',
          reason: null,
          changedFields: {},
          createdAt: new Date(),
        },
      ]),
    ).toBeNull();
  });
});
