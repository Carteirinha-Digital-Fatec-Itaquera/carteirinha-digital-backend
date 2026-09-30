# Guia Operacional de Certificados Acadêmicos (#27)

Este documento descreve o funcionamento, configuração, procedimentos de backfill e políticas de segurança dos Certificados de Eventos no backend.

## 1. Configuração e Variáveis de Ambiente

As seguintes variáveis controlam a emissão e verificação de certificados:

- `CERTIFICATE_VERIFICATION_BASE_URL`: Origem pública do frontend para verificação (ex: `https://carteirinha.fatecitaquera.edu.br` ou `http://localhost:5173` em dev). O QR Code impresso no PDF aponta para `${CERTIFICATE_VERIFICATION_BASE_URL}/certificado/verificar/${verificationCode}`.
- `CERTIFICATE_TEST_DATABASE_URL`: URL do PostgreSQL local dedicado aos testes de integração (ex: `postgresql://postgres:postgres@localhost:5432/issue27_certificates`). Restrita estritamente a instâncias locais (`localhost` ou `127.0.0.1`).
- `CERTIFICATE_BACKFILL_DATABASE_URL`: URL explícita para execução do script de backfill. Por segurança, não é inferida automaticamente de `DATABASE_URL` ou `DIRECT_URL`.

## 2. Emissão de Certificados

A emissão ocorre automaticamente e de forma idempotente durante a transação de confirmação de presença (checkout via QR Code) quando:
1. A presença do aluno atinge o status `CONFIRMED` com `checkInAt` e `checkOutAt` registrados.
2. O evento possui `certificateEnabled: true` e não está no status `CANCELLED`.
3. O par `(eventId, studentRa)` é único no banco de dados.

### Snapshot Histórico
Os dados do certificado são congelados em um snapshot imutável (`payloadSnapshot`) no momento da emissão contendo:
- Nome do aluno, RA e curso no momento da presença (extraídos do snapshot da presença).
- Título do evento, data formatada (no fuso `America/Sao_Paulo`), carga horária legível e palestrante.
- Instituição: `FATEC Itaquera - Centro Paula Souza`.

A alteração posterior do cadastro do estudante não afeta certificados já emitidos. Caso o cadastro seja excluído, `studentRefRa` é anulado (`SetNull`), preservando o histórico e a validade da verificação pública.

## 3. Segurança e Rate Limiting

A rota de verificação pública (`GET /certificates/verify/:code`) é protegida por um guard em memória (`CertificateRateLimitGuard`):
- **Limite por IP**: 60 requisições por minuto.
- **Limite por Código**: 300 requisições por minuto para o mesmo código normalizado.
- **Header de Resposta**: Em caso de excesso (HTTP 429), o cabeçalho `Retry-After: 60` é incluído.
- **Capacidade do Storage**: Máximo de 20.000 chaves ativas em memória com limpeza periódica.
- **Privacidade Mínima**: A resposta pública contém apenas os dados acadêmicos do evento e o nome do aluno; RA, curso e e-mail não são revelados publicamente.

## 4. Procedimento de Backfill

Para emitir certificados retroativos para presenças confirmadas anteriores à ativação da funcionalidade:

```bash
# 1. Simulação segura sem alteração no banco (DRY-RUN padrão)
CERTIFICATE_BACKFILL_DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsx scripts/backfill-certificates.ts --dry-run

# 2. Execução real com escrita em lotes de 100
CERTIFICATE_BACKFILL_DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsx scripts/backfill-certificates.ts --apply

# 3. Filtrar opcionalmente por um evento específico
CERTIFICATE_BACKFILL_DATABASE_URL="..." npx tsx scripts/backfill-certificates.ts --apply --event-id "<UUID-DO-EVENTO>"
```
