# Entrega — issue #26: Attendance

Branch sugerida: `feature/attendance-scan-validation`.

Título de PR: `feat(attendance): registro e validacao de presenca idempotente`.

Base: ZIP `carteirinha-digital-backend-main (2).zip` enviado nesta conversa. Nenhum código de frontend foi modificado nesta entrega. O scanner da #5 já reconhece as respostas de sucesso, duplicidade e `CHECK_IN_REQUIRED` deste backend.

## O que foi implementado

- `AttendanceModule` registrado no `AppModule`.
- `POST /attendances/scan`, exclusivo para aluno. DTO rejeita campos extras (inclusive RA/accountId); a identidade vem do JWT de login.
- `GET /attendances/me`, exclusivo para aluno ativo e filtrado simultaneamente por RA, vínculo atual e accountId.
- `GET /events/:id/attendances` e `GET /events/:id/attendances/summary`, exclusivos para Secretaria.
- QR verificado com assinatura HS256, expiração e formato das claims `eventId`, `checkpoint`, `checkpointVersion`, `jti`, `iat`, `exp`. Não aceita URL da carteirinha ou claim `type` em lugar de `checkpoint`.
- Validação de checkpoint aberto, versão vigente e evento em andamento; data/hora do servidor.
- Entrada com snapshots de RA/nome/curso/accountId; saída confirma presença. Duplicidade retorna HTTP 200 e não sobrescreve horários.
- Conta existente com status `Ativo` ou `Em curso`, com trim e comparação sem distinção de maiúsculas. Token antigo após exclusão/recriação recebe 401. RA reutilizado com histórico anterior recebe 409 `RA_REUSE_HISTORY_CONFLICT` sem expor nem reassociar a presença antiga.
- Listagem da Secretaria usa snapshots, sem depender da existência atual de Student. O aluno recebe apenas a projeção mínima do Contrato V1.
- Agregação de resumo em uma única consulta, evitando métricas lidas em momentos diferentes.

## Concorrência e certificados

Cada scan ocorre em transação: lock compartilhado da conta, advisory lock transacional por evento/RA, locks compartilhados de checkpoint e evento, validação e gravação. O mesmo par é serializado inclusive quando ainda não existe Attendance; a chave única permanece como garantia estrutural. O checkpoint e a conta não podem mudar entre a validação e a gravação. A expiração é verificada novamente após a espera por locks.

As transações da #25 escrevem checkpoint antes de Event; o scan segue a mesma ordem para esses recursos. Os locks são liberados pelo PostgreSQL no commit/rollback. Referência: [documentação de locks do PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

Elegibilidade persistida: `Attendance.status = CONFIRMED` e `Event.certificateEnabled = true`. A emissão e o PDF pertencem à #27. Eventos com certificados desabilitados continuam aceitando presença; o scan não cria um Certificate nem promete emissão imediata.

## Configuração necessária

Configure **ambas** as variáveis, com valores fortes e diferentes:

```dotenv
JWT_SECRET=valor-do-segredo-de-login
ATTENDANCE_QR_SECRET=outro-valor-independente-para-presenca
```

Os valores acima são apenas placeholders. Use os segredos do seu ambiente. O fallback anterior do QR para `JWT_SECRET` foi removido; ausência ou igualdade agora impede a inicialização. A geração de QR já existente usa a mesma configuração do scan. Não é necessário trocar um JWT_SECRET existente; configure o segredo QR separado e gere novos QRs após reiniciar.

O backend continua usando `DIRECT_URL` para o PostgreSQL. Não há nova migration nesta entrega: as nove migrations existentes, incluindo a #23, fornecem todas as tabelas e índices necessários.

## Aplicar

Na mesma base do ZIP recebido, com as issues #23/#24/#25/#28 já integradas e sem alterações locais conflitantes:

```sh
git switch -c feature/attendance-scan-validation
git apply --check caminho/issue-26-attendance.patch
git apply caminho/issue-26-attendance.patch
npm ci
npm run build
npm run test:attendance
```

O ZIP completo e o patch são alternativas; não aplique os dois. O ZIP não inclui node_modules, segredos ou banco de testes.

## Testes

```sh
npm test -- --runInBand
npm run test:attendance
```

Os testes unitários/HTTP não precisam de banco real. A suíte de integração é ignorada nessa execução quando não há `ATTENDANCE_TEST_DATABASE_URL`.

Para repetir a integração real, crie um banco PostgreSQL **local, dedicado e vazio**, com nome iniciado por `issue26_`. Exemplo PowerShell (substitua as credenciais):

```powershell
$env:ATTENDANCE_TEST_DATABASE_URL='postgresql://usuario:senha@127.0.0.1:5432/issue26_test'
npm run test:attendance:integration
```

O runner valida host/nome, aplica as migrations nesse banco e executa os testes de integração. Nunca usa `DIRECT_URL` implicitamente e não aceita banco remoto. Ele cria e remove apenas suas fixtures; o banco de teste/migrations permanece. Não forneça um banco compartilhado ou de produção.

A suíte usa Nest/Supertest, guards reais, emissão de QR pela #25 e Prisma/PostgreSQL reais. Inclui check-in/check-out concorrentes, snapshots, consultas e resumo, QR expirado e de versão anterior, saída sem entrada, conta excluída/RA reutilizado, expiração durante espera por lock, fechamento concorrente e certificado desabilitado.

## Integração com o frontend

Use `VITE_USE_MOCK=false` e a URL deste backend em `VITE_API_URL`. O endpoint de scan recebe somente `{ qrToken }` com Bearer do aluno. Duplicidades seguem V1 (`success:false`, `code`, `message`, `timestamp`); horários originais são consultados em `/attendances/me`. O código `CHECK_IN_REQUIRED` está alinhado com o adaptador do scanner entregue.

Ainda é necessário validar a câmera física no Android/iOS e fazer deploy nos ambientes do projeto. Não foi aberto PR remoto nem realizado code review externo nesta entrega. Certificados reais dependem da #27.
