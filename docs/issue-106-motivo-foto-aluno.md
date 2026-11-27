# Motivo de reprovação no próprio perfil do aluno

Issue #106. Base main fe2ac8f494314cf1b57340f3d55e52425c70aa48. Dependência da issue #53 do Portal de Alunos. Entrega exclusivamente em Draft, sem merge/deploy/migração.

## Causa e alteração mínima

A Secretaria envia rejectionReason ao avaliar a fotografia. StudentService.approvePhoto já grava esse campo em Student. O Portal consulta GET /estudantes/encontrar-por-ra/:ra, mas StudentMapper/ViewStudentDTO não incluíam a justificativa.

Foi acrescentado o campo opcional rejectionReason à tipagem de StudentEntity e ViewStudentDTO, sem emissão automática do campo no DTO compartilhado. Apenas StudentController.getStudentByRa o preenche no ramo do próprio aluno autenticado, depois das verificações existentes de role, RA e accountId. Em REJECTED, retorna o texto armazenado se não vazio; nos demais estados e motivo ausente retorna null. Preserva-se o texto original, sem interpretar HTML.

Não há mudança de banco/schema, migrações, endpoints novos, aprovação, upload, carteirinha ou regras do QR. Mapper e projeção pública do QR não foram alterados. A Secretaria não recebe este campo adicional nessa consulta. A rota legado foto-status já retorna rejectionReason publicamente; a nova UI não a utiliza. Esse comportamento legado fica fora deste ajuste mínimo.

O upload legado mantém o motivo anterior no banco ao marcar PENDING. Não foi necessário alterar a escrita: a nova projeção devolve null enquanto não houver rejeição atual. Uma nova decisão de reprovação substitui o campo pelo motivo atual ou null. O modelo de aluno continua sendo o modelo existente de fotografia única, sem implementar o ciclo de substituições de funcionários.

## Arquivos

- src/student/student.controller.ts
- src/student/entities/student.entity.ts
- src/student/dto/view-student.dto.ts
- src/student/student-photo-feedback.spec.ts

## Validação e limites

13 testes novos cobrem motivo real, ausente/vazio, estados PENDING/APPROVED/sem status, texto longo, projeções de Secretaria e QR, RA diferente e accountId diferente. A regressão pertinente inclui AuthGuard, RolesGuard e autorização HTTP: 28 testes em 4 suítes. São testes locais com serviços/dados fictícios, não homologação em produção.

TypeScript de build aprovado. O lint do teste novo tem zero erros/avisos; nas três fontes existentes há 56 erros e 1 aviso herdados, contra 57 erros e 1 aviso na base, sem novos erros nas linhas implementadas. Não houve reformatação ampla ou ocultação dessas falhas.

Para reproduzir no VS Code, clone o backend, mude para fix/issue-106-motivo-foto-perfil-aluno e execute npm ci. Execute npx jest --runInBand src/student/student-photo-feedback.spec.ts src/auth/auth.guard.spec.ts src/auth/roles.guard.spec.ts src/auth/authorization.http.spec.ts. npm run build gera o Prisma Client e compila Nest; não execute migrate, db push ou seed para validar este ajuste. Use somente configuração e dados de desenvolvimento isolados.

A integração real com o frontend depende de revisão dos dois PRs. Nenhum merge, deploy, chamada de escrita em produção ou alteração manual em dados reais foi realizada.

Prisma Client gerado e build Nest aprovados, sem conexão com banco, migração, db push ou seed.
