import {
  parseParticipantFile,
  assertParticipantFileEvent,
} from './participant-file';
const file = (text: string, ext = 'json') =>
  ({
    originalname: `test.${ext}`,
    size: Buffer.byteLength(text),
    buffer: Buffer.from(text),
  }) as Express.Multer.File;
describe('Participant JSON and CSV', () => {
  it('explains conflicting aliases, duplicate headers and unsupported versions', () => {
    expect(() =>
      parseParticipantFile(
        file('{"versao_formato":"99","participantes":["Aluno Teste"]}'),
      ),
    ).toThrow('Versão');
    expect(() =>
      parseParticipantFile(
        file('[{"nome":"Aluno Teste","name":"Outra Pessoa"}]'),
      ),
    ).toThrow('Linha 1');
    expect(() =>
      parseParticipantFile(file('nome,nome\nAluno Teste,Outro Teste', 'csv')),
    ).toThrow('duplicado');
  });
  it('accepts names and the provided participant object format', () => {
    expect(parseParticipantFile(file('["Aluno Teste"]'))).toEqual([
      { name: 'Aluno Teste', review: false },
    ]);
    expect(
      parseParticipantFile(
        file(
          '{"participantes":[{"nome_transcrito":"Aluno Teste","revisao_identidade_pendente":"SIM"}]}',
        ),
      )[0].review,
    ).toBe(true);
    expect(
      parseParticipantFile(file('nome;status\n"Aluno, Teste";ativo', 'csv'))[0]
        .name,
    ).toBe('Aluno, Teste');
  });
  it('rejects invalid, empty, oversized and unexpected formats', () => {
    for (const f of [
      file('['),
      file('[]'),
      file('[null]'),
      file('nome\nA', 'csv'),
      file('abc', 'exe'),
      { ...file('[]'), size: 3000000 },
    ])
      expect(() => parseParticipantFile(f)).toThrow();
  });
  it('rejects the wrong Ambev session while keeping Brasilia time', () => {
    const f = file(
      '{"evento":{"titulo":"Ambev","data":"2026-10-26","horario_inicio":"15:00"},"participantes":["Aluno Teste"]}',
    );
    expect(() =>
      assertParticipantFileEvent(f, {
        id: 'event',
        title: 'Ambev',
        startsAt: new Date('2026-10-26T18:00:00Z'),
      }),
    ).not.toThrow();
    expect(() =>
      assertParticipantFileEvent(f, {
        id: 'event',
        title: 'Ambev',
        startsAt: new Date('2026-10-26T14:00:00Z'),
      }),
    ).toThrow();
  });
});
