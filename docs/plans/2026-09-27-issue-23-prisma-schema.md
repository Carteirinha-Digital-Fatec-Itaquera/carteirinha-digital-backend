# Issue #23 — schema e migration de eventos

## Escopo aceito

Uma branch e um PR exclusivos da #23, criados da `main` após o merge da #22. Entregar os enums `EventStatus`, `CheckpointType` e `AttendanceStatus`, os models `Event`, `EventCheckpoint`, `Attendance` e `Certificate`, `Student.accountId`, migration versionada e prova local de persistência. As APIs, JWTs e frontends são entregas das issues seguintes.

O usuário confirmou: histórico de presença e certificado permanece após exclusão manual ou agendada de Student; a migration precisa funcionar com alunos preexistentes; os testes usam somente PostgreSQL 18 local descartável e dados fictícios; não há alteração de banco remoto ou produção neste PR.

## Decisões

| Decisão | Alternativa examinada | Motivo |
| --- | --- | --- |
| `Student.accountId` tem default PostgreSQL `(gen_random_uuid())::text` | `@default(uuid())` só no cliente Prisma | O repositório atual cria Student sem informar o campo; o default no banco mantém esse caminho funcional. O contrato #22 é atualizado nesta PR. A forma com parênteses acompanha a normalização do PostgreSQL e evita diff permanente no Prisma. |
| Migração Prisma com SQL ajustado para coluna opcional, backfill e depois `NOT NULL` | `db push` ou coluna obrigatória em uma operação | Preserva alunos existentes e registra a mudança no histórico. O ambiente não interativo recusou `migrate dev --create-only`; `prisma migrate diff` gerou o SQL base, aplicado por `migrate deploy`. |
| Snapshots de RA/conta/nome/curso e FK opcional ao Student | FK obrigatória ou exclusão em cascata | `ON DELETE SET NULL` preserva o histórico e não religa uma nova conta que reutilize o RA. |
| Triggers impedem edição de identidade e snapshots | Confiar apenas nos futuros services | A #23 entrega a imutabilidade descrita no contrato mesmo para escritas diretas. `studentRefRa`, saída, estado, revogação e `updatedAt` continuam mutáveis. |
| Índices nas FKs opcionais e `CHECK` de RA coincidente | Só FKs e índices únicos | Apoiam exclusões e consultas privadas e impedem vínculo com RA divergente do snapshot. |

## Limite das garantias

O banco garante FKs, unicidades, snapshots imutáveis, retenção após exclusão e default/imutabilidade de `accountId`. A #24 cria Event e ambos os checkpoints numa transação; #25 controla abertura/fechamento e horários; #26 valida identidade e presença; #27 valida emissão e coerência de Certificate com Attendance; #28 atualiza JWT e guards. A unicidade `(eventId, type)` por si só não exige que ambos os checkpoints existam. O schema tampouco impede, isoladamente, dois checkpoints abertos ou um certificado vinculado a uma presença de outro evento.

Os históricos mantêm dados pessoais. Os responsáveis institucionais precisam definir a política de retenção e remoção antes de produção. A migration faz backfill, `SET NOT NULL` e índice único, que podem bloquear operações; os testes locais não demonstram implantação sem interrupção. A janela e a estratégia operacional devem ser avaliadas com volume e ambiente reais antes de aplicar em produção.

## Prova local

1. Em um banco descartável, aplicar as oito migrations antigas em banco vazio, inserir Student legado sem `accountId` e aplicar a migration #23.
2. Em outro banco descartável vazio, aplicar as nove migrations do zero.
3. Em cada banco, com `DIRECT_URL` local, porta 55432 e `ISSUE23_LOCAL_TEST=1`, executar `npm run test:issue23`. O script recusa qualquer outro destino.
4. Verificar criação de Event com CHECK_IN/CHECK_OUT, unicidades, FKs/índices, default para novos Student via Prisma e SQL, atualização permitida de presença/revogação, bloqueio de edição dos snapshots, exclusão manual e `StudentCleanupService`, preservação do histórico, RA reutilizado sem religação e `Secretary` com `SetNull`.
5. Executar `prisma validate`, `prisma generate`, build e Jest. Não executar o seed comum, pois ele usa emails de ambiente e não demonstra o cenário histórico.

## Revisão do desenho

Skeptic apontou default apenas no cliente, lock de migration, ausência de política de retenção, regras que dependem dos services e risco de snapshots editáveis. Constraint Guardian confirmou compatibilidade com Prisma 7, `PrismaService`, cadastro atual e cleanup; User Advocate exigiu prova de inserção antiga, exclusões e comunicação clara aos frontends. Arbiter: **APPROVED**, com default no PostgreSQL, triggers delimitados e comunicação dos limites acima.
