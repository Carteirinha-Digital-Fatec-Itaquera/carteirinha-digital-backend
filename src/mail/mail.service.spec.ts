import { MailService } from './mail.service';

interface SendTransacEmailPayload {
  subject: string;
  to: Array<{ email: string; name?: string }>;
  sender: { name: string; email: string };
  htmlContent: string;
  textContent: string;
}

describe('MailService', () => {
  let service: MailService;
  let sendTransacEmailMock: jest.Mock<
    Promise<{ messageId: string }>,
    [SendTransacEmailPayload]
  >;

  beforeEach(() => {
    service = new MailService();
    sendTransacEmailMock = jest.fn<
      Promise<{ messageId: string }>,
      [SendTransacEmailPayload]
    >(() => Promise.resolve({ messageId: 'msg-123' }));
    Object.assign(service, {
      client: {
        transactionalEmails: {
          sendTransacEmail: sendTransacEmailMock,
        },
      },
    });
  });

  it('escapa tags HTML em nome e título no htmlContent e sanitiza URL', async () => {
    const maliciousName =
      '<a href="https://example.invalid">Texto injetado</a>';
    const maliciousTitle = '<b>Título com tag</b> & "aspas"';
    const safeUrl =
      'https://carteirinha-digital-front-end-aluno.vercel.app/certificados';

    const result = await service.sendCertificateNotification({
      email: 'aluno@fatec.sp.gov.br',
      recipientName: maliciousName,
      eventTitle: maliciousTitle,
      accessUrl: safeUrl,
      profile: 'ALUNO',
    });

    expect(result).toEqual({ messageId: 'msg-123' });
    expect(sendTransacEmailMock).toHaveBeenCalledTimes(1);

    const callArgs = sendTransacEmailMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;

    expect(callArgs.to).toEqual([
      { email: 'aluno@fatec.sp.gov.br', name: maliciousName },
    ]);
    expect(callArgs.subject).toContain(maliciousTitle);

    expect(callArgs.htmlContent).not.toContain(
      '<a href="https://example.invalid">',
    );
    expect(callArgs.htmlContent).toContain(
      '&lt;a href=&quot;https://example.invalid&quot;&gt;Texto injetado&lt;/a&gt;',
    );
    expect(callArgs.htmlContent).not.toContain('<b>Título com tag</b>');
    expect(callArgs.htmlContent).toContain(
      '&lt;b&gt;Título com tag&lt;/b&gt; &amp; &quot;aspas&quot;',
    );
    expect(callArgs.htmlContent).toContain(`href="${safeUrl}"`);

    expect(callArgs.textContent).toContain(maliciousName);
    expect(callArgs.textContent).toContain(maliciousTitle);
    expect(callArgs.textContent).toContain(safeUrl);
  });

  it('substitui URLs invalidas ou com esquemas perigosos por #', async () => {
    await service.sendCertificateNotification({
      email: 'aluno@fatec.sp.gov.br',
      recipientName: 'Aluno Teste',
      eventTitle: 'Workshop',
      accessUrl: 'javascript:alert(1)',
      profile: 'ALUNO',
    });

    const callArgs = sendTransacEmailMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;

    expect(callArgs.htmlContent).toContain('href="#"');
    expect(callArgs.textContent).toContain('#');
  });

  it('configura instrucoes corretas para perfil VISITANTE', async () => {
    await service.sendCertificateNotification({
      email: 'visitante@gmail.com',
      recipientName: 'Visitante Teste',
      eventTitle: 'Semana de TI',
      accessUrl: 'https://carteirinha.example.com/visitantes/certificados',
      profile: 'VISITANTE',
    });

    const callArgs = sendTransacEmailMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;

    expect(callArgs.htmlContent).toContain(
      'Acesse a área de visitantes com seu CPF cadastrado',
    );
    expect(callArgs.textContent).toContain(
      'Acesse a área de visitantes com seu CPF cadastrado',
    );
  });
});
