# Contrato V1 — Eventos, Presença, Checkpoints e Certificados

**Estado:** proposta canônica da issue [#22](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-backend/issues/22), aguardando revisão de Dev B e Dev C. **Repositório de origem:** backend. **Versão:** V1; não adiciona prefixo `/v1` às rotas. Esta entrega descreve o comportamento futuro e fornece tipos/fixtures; não cria tabelas, controllers nem proteção de rotas.

Os consumidores são os frontends Aluno e Secretaria e os módulos backend das issues #23–#28. Os tipos portáveis estão em `src/contracts/v1-events.types.ts`; as respostas completas de exemplo estão em `docs/contracts/fixtures/`. Os frontends, em repositórios separados, integrarão cópias/versões desses contratos nas próprias issues. Ainda não há consumo real deles. Interfaces TypeScript são apenas contrato estático: os endpoints NestJS deverão usar classes DTO com `class-validator`, conforme os módulos existentes e o `ValidationPipe` global.

## Decisões e alternativas

| Decisão V1                                                                  | Alternativa considerada                      | Motivo                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Markdown + interfaces TypeScript puras + três fixtures JSON no backend      | OpenAPI gerado ou apenas Markdown            | Entrega contratual isolada, compatível com o padrão atual e sem infraestrutura nova.                    |
| `GET /events` exige JWT de student ou secretary                             | Listagem anônima sugerida pelo título da #24 | O corpo da #22 e o contrato HTTP da #24 exigem Bearer; somente a verificação de certificado é pública.  |
| Resposta QR usa `qrToken`, validade 20 s, `expiresAt` e `checkpointVersion` | `token` ou validade 25–30 s                  | #26 recebe `qrToken`; 20 s cumpre a #25 e o polling de 15 s, com ocultação do QR vencido.               |
| RA/nome/curso históricos separados de FK opcional ao aluno                  | Exclusão em cascata ou FK obrigatória        | Presença e certificado devem continuar verificáveis depois de exclusão manual ou agendada de Student.   |
| Verificação pública revela nome do titular, evento e dados mínimos          | Exibir RA/curso ou omitir nome               | #27 requer identificação do titular; código de alta entropia e limite de tentativas mitigam enumeração. |
| Sem paginação no MVP; lista vazia é `[]`                                    | Envelope com cursor/total                    | A #24 prevê `Event[]`; volume baixo/moderado é premissa explícita, a rever antes de escalar.            |

## Convenções comuns

- Datas e horas: strings ISO 8601 em UTC, por exemplo `2026-10-05T19:00:00.000Z`; a interface converte para horário local. `eventDate` no certificado é `YYYY-MM-DD` derivado de `startsAt` no fuso institucional `America/Sao_Paulo`, não do relógio do navegador.
- IDs de Event, EventCheckpoint, Attendance e Certificate: UUID em string. RA é sempre string, inclusive quando contém zeros à esquerda. Secretaria usa `sub` numérico no JWT; aluno usa RA como `sub` e `accountId` imutável como claim adicional. O contrato de emissão e validação desses JWTs é implementado na #28.
- API retorna JSON `application/json`, exceto o PDF. Erro NestJS estável: `{ "statusCode": 400, "message": "Descrição legível", "error": "Bad Request", "code": "CODIGO_OPCIONAL" }`. `code` é estável quando declarado; textos podem ser traduzidos. `401`: sem JWT ou token inválido; `403`: JWT válido com papel errado; `404`: recurso inexistente ou certificado de outro aluno; `409`: transição incompatível/conflito de estado.
- Sem body em GET. `GET /events` sem resultados, `GET /attendances/me` e `GET /certificates/me` retornam `[]` com 200. Não há `total` nem cursor na V1.
- A documentação dos contratos não substitui a checagem de autorização no servidor. A implementação dos guards é dependência da #28; estes controles ainda não existem para os novos endpoints.
- O QR de presença é o **JWT bruto** retornado por `GET /events/:id/checkpoints/:type/qr`, renderizado pela Secretaria e enviado pelo scanner do Aluno em `POST /attendances/scan`. É diferente do QR atual da carteirinha de aluno, que contém uma URL `/valida/:qrcodeToken` e consulta `/estudantes/verificar/:qrcode`. Os dois fluxos não são intercambiáveis.
- O `qrToken` das fixtures é o marcador `JWT_PRESENCA_FICTICIO`, não um token assinado. `qrClaimsExample` ilustra o conteúdo temporal e não é campo da resposta HTTP. Nenhum exemplo pode autenticar requisições reais.
- QR e verificação pública devem responder com `Cache-Control: no-store`. O backend limita tentativas de verificação pública por código/origem na #27. O frontend só consulta QR enquanto a tela estiver visível e o checkpoint aberto; ao vencer `expiresAt`, oculta o QR até receber outro token, inclusive se a renovação falhar.

As fixtures retratam **momentos sucessivos do mesmo evento**, não uma fotografia única do banco: `events.mock.json#events[0]` é a resposta logo após a criação (SCHEDULED, checkpoints fechados); `checkpointOpenResponse` e `qrResponse` são da abertura em 05/10 às 18:55 UTC; `attendance.mock.json` retrata entrada às 18:55:10 e saída às 21:02; `certificates.mock.json` retrata emissão às 21:05. Um consumidor deve usar cada objeto como exemplo da sua rota e fase, sem combinar o estado inicial do evento com o histórico final na mesma leitura.

## Entidades e constraints para Prisma (#23)

Os tipos abaixo descrevem o schema futuro. `Student(ra)` e `Secretary(id)` já existem. A #23 adiciona a `Student` um `accountId String @unique @default(dbgenerated("(gen_random_uuid())::text"))`, preenchendo os alunos existentes na migração. O default fica no PostgreSQL para que o cadastro atual, que omite `accountId`, continue funcionando após a migration. Esse identificador é imutável por cadastro; uma nova conta com o mesmo RA recebe outro `accountId`. A #28 deve incluir `accountId` no JWT de aluno e, em **cada** rota nova protegida para aluno, consultar o cadastro ativo por RA e comparar `accountId`. JWT antigo sem esse claim ou emitido para cadastro excluído/recriado retorna 401. A migração invalida os JWTs legados para essas rotas e exige novo login. O guard atual apenas verifica a assinatura, portanto essa checagem é uma dependência explícita de implementação, não uma proteção já existente. Secretarias seguem a identidade numérica atual.

As colunas de snapshot acrescidas aqui são necessárias para a retenção confirmada; a #23 deve seguir este contrato, mesmo onde sua descrição inicial é mais curta.

A migration #23 protege `accountId` e os campos históricos de Attendance/Certificate contra alterações em nível de banco. Ela permite a desvinculação automática de `studentRefRa` na exclusão, a confirmação da presença, a saída e a revogação. As chaves únicas de checkpoint garantem no máximo um CHECK_IN e um CHECK_OUT por evento; criar ambos e impedir dois abertos exige as transações dos serviços #24/#25. A coerência entre Certificate e a Attendance vinculada, bem como as regras de emissão, pertencem aos serviços #26/#27. A migration não cria essas APIs nem altera os JWTs atuais.

### Enums

| Enum               | Valores                                              | Uso                              |
| ------------------ | ---------------------------------------------------- | -------------------------------- |
| `EventStatus`      | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | Ciclo do evento                  |
| `CheckpointType`   | `CHECK_IN`, `CHECK_OUT`                              | Exatamente um de cada por evento |
| `AttendanceStatus` | `CHECKED_IN`, `CONFIRMED`                            | Sem linha = não registrado       |

### Event

| Campo                    | Prisma                                             | Regra                                            |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------ |
| `id`                     | `String @id @default(uuid())`                      | UUID                                             |
| `title`                  | `String`                                           | 3–200 caracteres após trim                       |
| `description`            | `String?`                                          | Máximo 2000 caracteres                           |
| `speaker`, `location`    | `String`                                           | Não vazios                                       |
| `startsAt`, `endsAt`     | `DateTime`                                         | `endsAt > startsAt`                              |
| `workloadMinutes`        | `Int`                                              | Inteiro positivo                                 |
| `status`                 | `EventStatus @default(SCHEDULED)`                  | Estado                                           |
| `certificateEnabled`     | `Boolean @default(true)`                           | Elegibilidade                                    |
| `createdById`            | `Int?`                                             | FK opcional `Secretary(id)`, `onDelete: SetNull` |
| `createdAt`, `updatedAt` | `DateTime @default(now())`, `DateTime @updatedAt`  | Auditoria temporal                               |
| Relações                 | `checkpoints[]`, `attendances[]`, `certificates[]` | Evento não é apagado se possui histórico         |

A exclusão de Secretary não remove Event. A FK opcional zera `createdById`; este MVP não promete conservar nome da secretária excluída. Não há endpoint de exclusão de evento no contrato.

### EventCheckpoint

| Campo                    | Prisma                                            | Regra                                    |
| ------------------------ | ------------------------------------------------- | ---------------------------------------- |
| `id`                     | `String @id @default(uuid())`                     | UUID                                     |
| `eventId`                | `String`                                          | FK Event, `onDelete: Restrict`           |
| `type`                   | `CheckpointType`                                  | `@@unique([eventId, type])`              |
| `isOpen`                 | `Boolean @default(false)`                         | Nunca dois tipos abertos no mesmo evento |
| `openedAt`, `closedAt`   | `DateTime?`                                       | Tempo do servidor                        |
| `version`                | `Int @default(1)`                                 | Incremento atômico em transição válida   |
| `createdAt`, `updatedAt` | `DateTime @default(now())`, `DateTime @updatedAt` | Auditoria                                |

### Attendance

| Campo                          | Prisma                                            | Regra                                               |
| ------------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| `id`                           | `String @id @default(uuid())`                     | UUID                                                |
| `eventId`                      | `String`                                          | FK Event, `onDelete: Restrict`                      |
| `studentRa`                    | `String`                                          | Snapshot imutável; `@@unique([eventId, studentRa])` |
| `studentName`, `studentCourse` | `String`                                          | Snapshots imutáveis capturados no primeiro check-in |
| `studentAccountId`             | `String`                                          | Snapshot imutável de `Student.accountId`            |
| `studentRefRa`                 | `String?`                                         | FK opcional `Student(ra)`, `onDelete: SetNull`      |
| `checkInAt`, `checkOutAt`      | `DateTime?`                                       | Tempo do servidor                                   |
| `status`                       | `AttendanceStatus @default(CHECKED_IN)`           | `CONFIRMED` só após entrada e saída                 |
| `createdAt`, `updatedAt`       | `DateTime @default(now())`, `DateTime @updatedAt` | Auditoria                                           |

`studentRa` **não** é a FK. Quando Student é apagado manualmente ou por `StudentCleanupService.deleteMany`, apenas `studentRefRa` vira NULL. RA, nome, curso, `studentAccountId` e presença permanecem. Se outro cadastro usar o mesmo RA no futuro, o registro antigo não é religado automaticamente. A #23 precisa testar os dois caminhos de exclusão; atomicidade do log de limpeza é tarefa de implementação, não deste PR documental.

### Certificate

| Campo                   | Prisma                                  | Regra                                                                                                                                                      |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `String @id @default(uuid())`           | UUID                                                                                                                                                       |
| `eventId`               | `String`                                | FK Event, `onDelete: Restrict`                                                                                                                             |
| `studentRa`             | `String`                                | Snapshot imutável; `@@unique([eventId, studentRa])`                                                                                                        |
| `studentAccountId`      | `String`                                | Snapshot imutável copiado de Attendance; nunca fornecido pelo cliente                                                                                      |
| `studentRefRa`          | `String?`                               | FK opcional Student, `onDelete: SetNull`                                                                                                                   |
| `attendanceId`          | `String @unique`                        | FK Attendance, `onDelete: Restrict`                                                                                                                        |
| `verificationCode`      | `String @unique`                        | Prefixo `FATEC-EVT-` + no mínimo 16 caracteres aleatórios Crockford Base32 (ao menos 80 bits de entropia); gerador criptográfico, sem sequência previsível |
| `payloadSnapshot`       | `Json`                                  | Nome/RA/curso do aluno e título/data/carga/palestrante/instituição capturados na emissão; imutável                                                         |
| `issuedAt`, `revokedAt` | `DateTime @default(now())`, `DateTime?` | Revogado não é válido                                                                                                                                      |

Certificado só é emitido uma vez por `Attendance` confirmada e evento com `certificateEnabled=true`. Exclusão do Student não apaga ou revoga Certificate; a verificação pública continua possível. O download privado exige uma conta ativa com vínculo original e deixa de estar disponível após a exclusão; o histórico não é associado automaticamente a um novo cadastro com o mesmo RA. A política institucional de retenção/remoção de dados históricos deverá ser definida pelos responsáveis antes de produção.

## Estados e regras de negócio

1. Criar Event inicia `SCHEDULED` e cria CHECK_IN/CHECK_OUT fechados, versão 1, numa transação.
2. Abrir CHECK_IN (secretary): somente evento não cancelado, sem CHECK_OUT aberto. Define `isOpen=true`, `openedAt=now`, `closedAt=null`, incrementa versão e muda Event para `IN_PROGRESS`. Fechar faz `isOpen=false`, `closedAt=now` e incrementa versão.
3. Abrir CHECK_OUT requer CHECK_IN fechado e evento `IN_PROGRESS`. Fechar CHECK_OUT muda Event para `COMPLETED`. Repetir open em aberto ou close em fechado retorna 409 sem incrementar versão. Reabrir CHECK_IN só antes de CHECK_OUT; CHECK_OUT não pode ser reaberto após `COMPLETED`. Cada reabertura válida incrementa versão, invalidando tokens anteriores.
4. `PATCH /events/:id` altera dados cadastrais apenas antes de presença; `status: CANCELLED` é permitido somente antes da primeira presença e com checkpoints fechados. Evento cancelado não admite abertura, scan ou certificado. Edição/cancelamento tardio retorna 409.
5. `POST /attendances/scan` verifica assinatura com `ATTENDANCE_QR_SECRET`, `exp`, checkpoint aberto e versão atual; extrai RA e `accountId` do JWT de aluno validado contra a conta ativa, nunca do body. CHECK_IN cria registro `CHECKED_IN` com ambos os identificadores; leitura repetida **pela mesma conta** retorna 200 `success:false` + `ALREADY_CHECKED_IN`. CHECK_OUT exige entrada vinculada à mesma conta e muda para `CONFIRMED`; repetição pela mesma conta retorna `ALREADY_CHECKED_OUT`. Saída sem entrada: 400. Se já existe linha para `eventId + studentRa` de outro `studentAccountId` (RA reutilizado), retorna 409 `RA_REUSE_HISTORY_CONFLICT` sem ler ou alterar o histórico anterior; regularização depende da Secretaria. Concorrência usa a chave única para evitar duplicatas.
6. O JWT QR contém só `eventId`, `checkpoint`, `checkpointVersion`, `jti`, `iat` e `exp`. Não inclui RA, CPF, e-mail ou nome. O segredo QR é diferente do segredo JWT de login. Fechar/reabrir checkpoint invalida imediatamente versões anteriores, mesmo antes do `exp`.
7. Verificação de certificado: código válido e não revogado retorna 200 `valid:true` com nome do titular e dados mínimos; revogado retorna 200 `valid:false` sem nome; código desconhecido retorna 404. O nome permanece verificável após excluir o cadastro. A rota pública não retorna RA, curso, CPF, e-mail, token ou `payloadSnapshot` inteiro.
8. Consultas privadas de presença/certificado filtram `studentRefRa = Student.ra` **e** `studentAccountId = Student.accountId` do cadastro ativo validado. Um registro histórico com FK nula nunca é exposto a uma nova conta que reutilize o RA. A #26/#27 devem testar exclusão manual/agendada, reutilização de RA, scan duplicado e certificado; a #28 deve testar JWT antigo após exclusão e recriação.

## Índice das 15 rotas únicas

`GET /events` aparece para dois papéis na issue, mas é uma única rota. `:type` aceita `check-in` e `check-out` na URL e mapeia para os enums.

|  Nº | Método e rota                              | Papel              | Request                   | Sucesso                               | Erros específicos além de 401/403 |
| --: | ------------------------------------------ | ------------------ | ------------------------- | ------------------------------------- | --------------------------------- |
|   1 | `POST /events`                             | secretary          | `CreateEventRequest`      | 201 `EventView`                       | 400                               |
|   2 | `GET /events`                              | student, secretary | `?status=&date=` opcional | 200 `EventView[]`                     | 400                               |
|   3 | `GET /events/:id`                          | student, secretary | UUID                      | 200 `EventView`                       | 400, 404                          |
|   4 | `PATCH /events/:id`                        | secretary          | `UpdateEventRequest`      | 200 `EventView`                       | 400, 404, 409                     |
|   5 | `POST /events/:id/checkpoints/:type/open`  | secretary          | UUID + type               | 200 `CheckpointMutationResponse`      | 400, 404, 409                     |
|   6 | `POST /events/:id/checkpoints/:type/close` | secretary          | UUID + type               | 200 `CheckpointMutationResponse`      | 400, 404, 409                     |
|   7 | `GET /events/:id/checkpoints/:type/qr`     | secretary          | UUID + type               | 200 `AttendanceQrResponse`            | 400, 404                          |
|   8 | `GET /events/:id/attendances`              | secretary          | UUID                      | 200 `AttendanceView[]`                | 400, 404                          |
|   9 | `GET /events/:id/attendances/summary`      | secretary          | UUID                      | 200 `AttendanceSummary`               | 400, 404                          |
|  10 | `POST /attendances/scan`                   | student            | `AttendanceScanRequest`   | 200 `AttendanceScanResponse`          | 400, 404, 409                     |
|  11 | `GET /attendances/me`                      | student            | sem body                  | 200 `MyAttendanceView[]`              | —                                 |
|  12 | `GET /certificates/me`                     | student            | sem body                  | 200 `CertificateListItem[]`           | —                                 |
|  13 | `GET /certificates/:id`                    | student            | UUID                      | 200 `CertificateView`                 | 400, 404                          |
|  14 | `GET /certificates/:id/pdf`                | student            | UUID                      | 200 `application/pdf`                 | 400, 404, 409                     |
|  15 | `GET /certificates/verify/:code`           | público            | código                    | 200 `CertificateVerificationResponse` | 400, 404                          |

### 1. POST /events

**Request 201:** body completo em `events.mock.json#createRequest`. Exemplo: `{"title":"Arquitetura de Software na Prática","speaker":"Docente Exemplo","location":"Auditório Exemplo","startsAt":"2026-10-05T19:00:00.000Z","endsAt":"2026-10-05T21:00:00.000Z","workloadMinutes":120}`.

**Response 201:** `events.mock.json#events[0]`, incluindo os dois checkpoints fechados. 400 para título curto, data inválida, `endsAt <= startsAt` ou carga não positiva; 401 sem JWT; 403 para student.

### 2. GET /events

**Request:** `?status=SCHEDULED&date=2026-10-05` (ambos opcionais; `date` em `YYYY-MM-DD`). Secretary vê todos os estados, inclusive passados/cancelados; student vê somente SCHEDULED futuros ou IN_PROGRESS. Filtros não ampliam a visibilidade do aluno. Ordem: `startsAt desc` conforme #24. Sem paginação V1.

**Response 200:** `events.mock.json#events`; sem resultados `[]`. 400 para status/data inválidos; 401/403 conforme papel.

### 3. GET /events/:id

**Request:** ID UUID, sem body. Student ou secretary podem consultar evento existente; Student não acessa CANCELLED.

**Response 200:** `events.mock.json#events[0]`. 400 para UUID inválido, 404 para ausente ou CANCELLED invisível ao aluno, 401/403 para autenticação/papel.

### 4. PATCH /events/:id

**Request:** campos de `UpdateEventRequest`, por exemplo `{"title":"Título corrigido"}` ou `{"status":"CANCELLED"}`. Não aceita mudar ID, criador, timestamps nem status para outro valor.

**Response 200:** `EventView` atualizado, com formato de `events.mock.json#events[0]`. 400 para payload/datas inválidos; 404 ausente; 409 se presença já existe ou checkpoint aberto; 401/403 conforme papel.

### 5. POST /events/:id/checkpoints/:type/open

**Request:** UUID e `type=check-in|check-out`, sem body. CHECK_OUT só quando CHECK_IN estiver encerrado.

**Response 200:** `events.mock.json#checkpointOpenResponse`. 400 para type inválido; 404 para evento/checkpoint ausente; 409 para já aberto, cancelado ou transição proibida; 401/403.

### 6. POST /events/:id/checkpoints/:type/close

**Request:** UUID e type, sem body.

**Response 200:** `{"eventId":"11111111-1111-4111-8111-111111111111","type":"CHECK_IN","isOpen":false,"version":3,"openedAt":"2026-10-05T18:55:00.000Z","closedAt":"2026-10-05T19:10:00.000Z"}`. 400 type inválido; 404 ausente; 409 já fechado ou transição proibida; 401/403.

### 7. GET /events/:id/checkpoints/:type/qr

**Request:** UUID e type, sem body; checkpoint precisa estar aberto. A Secretaria faz nova requisição a cada 15 s enquanto a tela estiver visível.

**Response 200:** `events.mock.json#qrResponse`, `Cache-Control: no-store`. `expiresInSeconds=20`, `expiresAt` é UTC do servidor. O frontend nunca mostra token depois desse prazo; se renovação falhar, mostra estado de QR indisponível e tenta novamente. 400 para type inválido ou checkpoint fechado; 404 ausente; 401/403.

### 8. GET /events/:id/attendances

**Request:** UUID, sem body. Somente Secretary.

**Response 200:** `attendance.mock.json#attendances`, incluindo RA, nome e curso históricos necessários à gestão, entrada, saída e status; sem resultados `[]`. 400 UUID inválido; 404 evento ausente; 401/403. Nenhum CPF ou e-mail.

### 9. GET /events/:id/attendances/summary

**Request:** UUID, sem body. Contagens calculadas a partir da persistência.

**Response 200:** `attendance.mock.json#summary`, por exemplo `{"checkedInCount":1,"checkedOutCount":1,"confirmedCount":1}`; evento sem presenças retorna zeros. 400 UUID inválido; 404 evento ausente; 401/403.

### 10. POST /attendances/scan

**Request:** `attendance.mock.json#scanRequest`; apenas `{"qrToken":"<JWT de presença>"}`, sem RA. O JWT de login do aluno identifica RA e `accountId` validados contra Student ativo. Token da carteirinha não é aceito.

**Response 200:** `attendance.mock.json#scanSuccess`; duplicata da mesma conta retorna `attendance.mock.json#scanDuplicate` com `success:false` e código estável. 400 para token expirado/assinatura inválida/versão divergente/checkpoint fechado/check-out sem check-in; 404 evento ausente; 409 evento cancelado ou `RA_REUSE_HISTORY_CONFLICT`; 401 para JWT sem identidade de cadastro válida; 403 para papel errado. Hora registrada vem do servidor.

### 11. GET /attendances/me

**Request:** sem body; RA e `accountId` do JWT de student, validados contra Student ativo.

**Response 200:** `attendance.mock.json#myAttendances`, ou `[]`, filtrado por `studentRefRa` e `studentAccountId`. Não aceita RA arbitrário nem expõe histórico de conta anterior com RA reutilizado. 401/403.

### 12. GET /certificates/me

**Request:** sem body; student autenticado com `accountId` validado contra Student ativo.

**Response 200:** `certificates.mock.json#certificates`, ou `[]`, filtrado por `studentRefRa` e `studentAccountId`. Inclui resumo do certificado, sem snapshot interno. 401/403.

### 13. GET /certificates/:id

**Request:** ID UUID e student autenticado com `accountId` validado contra Student ativo.

**Response 200:** `certificates.mock.json#certificateDetails`, incluindo snapshot privado do próprio titular, condicionado a `studentRefRa` e `studentAccountId` atuais. 400 UUID inválido; 404 ausente, pertencente a outro aluno ou desvinculado por exclusão; 401/403.

### 14. GET /certificates/:id/pdf

**Request:** ID UUID e student autenticado com `accountId` validado contra Student ativo.

**Response 200:** corpo binário iniciando por `%PDF-`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="certificado-<codigo>.pdf"`. A posse é verificada pelos mesmos `studentRefRa` e `studentAccountId` do detalhe. O QR dentro do PDF aponta para `GET /certificates/verify/:code` em URL pública configurada; não carrega RA/CPF. 400 UUID inválido; 404 ausente/de outro aluno/desvinculado; 409 revogado; 401/403.

### 15. GET /certificates/verify/:code

**Request:** código opaco `FATEC-EVT-...`; sem JWT.

**Response 200 válido:** `certificates.mock.json#verificationValid`; nome do titular, evento, data, carga, emissão e instituição. **Response 200 revogado:** `certificates.mock.json#verificationRevoked` sem nome. Código desconhecido retorna 404 `{"statusCode":404,"message":"Certificado não encontrado","error":"Not Found","code":"CERTIFICATE_NOT_FOUND"}`. Código malformado: 400. Nunca retorna RA, curso, CPF, e-mail ou snapshot completo. `Cache-Control: no-store`; limitar tentativas no servidor na #27.

## Mapa de consumo e testes locais

| Consumidor                                              | Contrato usado                           | Responsável pela integração                         |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Secretaria: criar/listar/gerenciar evento e projetar QR | Event, Checkpoint, QR, presenças/summary | Issues da Secretaria após #22; #24/#25 fornecem API |
| Aluno: lista, scan, participações, certificados         | Event, Attendance, Certificate           | Issues do Aluno após #22; #26/#27 fornecem API      |
| Backend: banco, auth, controllers                       | Modelo acima e rotas                     | #23, #28, #24, #25, #26, #27                        |

O teste local da #22 valida parse e estrutura das três fixtures, invariantes entre IDs/status/checkpoints, ausência de PII no QR e no retorno público, unicidade das 15 rotas e compilação dos tipos TypeScript. Isto prova coerência interna do contrato; não prova integração real com os frontends, que ainda não consomem as novas APIs. Dev B e Dev C devem revisar a especificação e registrar aprovação no PR antes de tratá-la como congelada. Mudança posterior exige revisão explícita dos consumidores.


## Implementação Attendance — issue #26

As quatro rotas de presença foram implementadas em `src/attendance/`. O scan usa `checkpoint` do JWT QR e autentica a conta por `sub` + `accountId`, com Student existente e status `Ativo` ou `Em curso` (sem distinção de maiúsculas/espaços nas extremidades). O corpo aceita somente `qrToken`.

Códigos estáveis de erro do scan: `QR_EXPIRED` (400), `INVALID_QR_TOKEN` (400), `QR_VERSION_MISMATCH` (400), `CHECKPOINT_CLOSED` (400), `CHECK_IN_REQUIRED` (400), `EVENT_CANCELLED` (409), `RA_REUSE_HISTORY_CONFLICT` (409). Conta ausente, inativa ou com outro accountId retorna 401. Evento ausente retorna 404. As respostas de sucesso/duplicidade mantêm a união `AttendanceScanResponse` canônica acima; o `timestamp` da duplicidade é da tentativa, não substitui os horários originais consultados em `/attendances/me`.

`JWT_SECRET` e `ATTENDANCE_QR_SECRET` devem ser configurados, não vazios e distintos. O fallback anterior do segredo QR para o segredo de login foi removido. O emissor existente e o validador usam a mesma configuração. Algoritmo do QR: HS256.

Elegibilidade para a #27 é persistida por `Attendance.status = CONFIRMED` e `Event.certificateEnabled = true`. Não há emissão nem geração de PDF no scan; desabilitar certificados não impede a presença. As consultas da Secretaria usam snapshots históricos `studentRa`, `studentName`, `studentCourse`, conforme V1, mesmo após exclusão do aluno.

A transação bloqueia a conta, serializa o par evento/RA com advisory lock transacional e mantém locks compartilhados de checkpoint/evento até gravar. A expiração é conferida novamente após a espera. A chave única `(eventId, studentRa)` continua sendo a restrição persistente; duplicatas do módulo não sobrescrevem os horários originais.
