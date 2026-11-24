# Relatório técnico — Fotografias de funcionários

Data: 24/11/2026 (America/Sao_Paulo). Entrega em Draft. A homologação visual e funcional do responsável permanece pendente. Nenhum merge, deploy de produção, migração ou dado de produção foi executado ou alterado.

## Organização

- Backend: issue #102, branch feature/issue-102-fotos-funcionarios, PR Draft #103.
- Secretaria: issue #84, branch feature/issue-84-fotos-funcionarios, PR Draft #85.
- Portal: issue #6, branch feature/issue-6-fotos-funcionarios, PR Draft #7.
- Ordem proposta: Backend → Secretaria → Portal. Não integrar antes da homologação e de nova autorização.
- A main do Portal contém o PR visual #5 (555ec39e290f1bd03b8296350fcfd1f39d88795f), preservado como ancestral desta entrega.
- O PR #101 e a issue #100 do domínio secundário permanecem separados.

## Implementação e contratos

A tela de fotografias da Secretaria mantém a categoria Alunos e acrescenta Funcionários, com quantidades individuais e total no menu. A fila utiliza GET /funcionarios/fotos/pendentes e /funcionarios/fotos/resumo, paginação por cursor e identificação por nome, matrícula funcional e data. A ampliação reutiliza o componente existente com um blob autenticado, revogado ao desmontar. A rota privada é derivada dos identificadores na própria API, sem confiar em uma URL externa fornecida no payload.

A aprovação e a rejeição utilizam o modal padronizado. A rejeição exige motivo. O PATCH envia employeeId e photoId no caminho e expectedVersion, approved e reason no corpo. A interface impede duplicidade, bloqueia ações durante a operação e recarrega a fila depois de um 409 para exigir uma nova decisão. Erros de sessão são tratados pelo cliente privado existente.

Foi confirmada a inconsistência da última foto rejeitada: ao sair de READY para DELETE_PENDING, a consulta anterior deixava de recuperar a rejeição. A correção utiliza a auditoria existente e acrescenta latestAttempt opcional nos contratos. Somente photoId, reviewStatus, reviewReason e reviewedAt são expostos nesse campo. O motivo permanece disponível após a limpeza dos bytes rejeitados. A remoção da fotografia limpa a situação apresentada. Não existe migração nova.

O Portal apresenta rejeição e motivo mesmo quando existe uma foto anterior aprovada. Também explica a substituição pendente. A foto aprovada permanece na carteirinha enquanto a substituta aguarda decisão ou é rejeitada. Não foram redesenhadas a carteirinha ou a tela de QR.

O teste de concorrência identificou dois problemas no upload: uma reserva em processamento podia ser reutilizada simultaneamente, e a marcação de limpeza feita dentro de uma transação abortada era revertida. A reserva agora é exclusiva, a retomada de FAILED usa atualização condicional, uma chave em processamento retorna 409 e o marcador de limpeza é gravado após o rollback. Reenvio concluído com a mesma chave continua idempotente.

## QR e elegibilidade

O ensaio usa QR realmente emitido pela API local, sem substituir a resposta por um QR fictício. Com a primeira imagem pendente, PHOTO_PENDING bloqueia a credencial e a interface exibe Foto em análise. Após a aprovação, a conta ativa com admissão iniciada e função vigente recebe credencial válida e o QR é exibido. A URL pública foi aberta no navegador e validou a identificação. A projeção pública não expõe e-mail. Renovar o QR invalida o anterior com HTTP 404.

A substituta pendente/rejeitada mantém válida a credencial quando existe uma imagem aprovada anterior. Uma rejeição sem foto aprovada resulta em PHOTO_REJECTED. Admissão futura, conta bloqueada, arquivamento e função futura, encerrada, arquivada ou vencida continuam impedindo a emissão. A matrícula foi verificada no primeiro acesso e não foi adicionada como requisito artificial de elegibilidade.

## Validações

- Build/TypeScript dos três projetos concluídos.
- Portal: lint aprovado e Playwright com API simulada aprovado em 390×844, 768×1024 e 1440×900.
- Backend: suíte unitária executada, com revalidação apenas das falhas de configuração de segredo local e dos novos casos de elegibilidade. As 49 suítes têm resultados finais aprovados, totalizando 378 casos distintos. A primeira execução apresentou 9 falhas por JWT_SECRET ausente e uma suíte não inicializada. Com segredos locais configurados, as três suítes revalidadas passaram em 42 casos, incluindo os 6 novos cenários de vínculo. Os demais resultados foram preservados.
- Backend HTTP/PostgreSQL: 12/12 aprovados em duas suítes. O novo ciclo de fotos foi novamente aprovado isoladamente após a tipagem das respostas do teste. Inclui 401, 403, token expirado, imagem inválida 415, armazenamento 503, retomada, paginação, prévia autenticada, conflito 409, avaliações simultâneas, uploads simultâneos, mesma chave concorrente, rejeição com motivo, limpeza de bytes, remoção, QR válido e revogado.
- A disputa no teste de importação CSV foi corrigida no próprio teste: o acionamento agendado do worker fica simulado durante a confirmação e o worker real é executado uma vez de forma determinística. O comportamento de produção não foi alterado.
- Ensaio Playwright entre as duas interfaces e o AppModule real: aprovado em 390×844 e 1440×900, incluindo primeiro login com matrícula, criação da senha pessoal, upload pela interface, persistência, separação de alunos/funcionários, contagens, ampliação privada, modais, aprovação, rejeição e QR real. As requisições da API não foram simuladas nesse ensaio. Foi verificada ausência de rolagem horizontal.
- PostgreSQL 18.4 descartável em 127.0.0.1:55451, com bancos separados para HTTP e navegador. As 28 migrações existentes foram verificadas no banco isolado. Armazenamento privado em memória e função de e-mail que falha se acionada. Imagens geométricas e identidades sintéticas.

## Lint e limites

Os arquivos de produção alterados do backend passam no lint direcionado. O lint global do backend continua reprovado por dívida anterior, inclusive no teste de integração já existente. A comparação do teste original da main apresenta 82 erros e 56 avisos. Os novos acessos às respostas HTTP receberam tipagem, sem desativar regras de segurança ou lint.

O lint global da Secretaria retorna seis erros anteriores em DatePickerComp, PhotosScreen (efeito e expressão de seleção), UploadStudentsScreen e decodeToken. Os três arquivos fora da tela de fotos foram comparados e permanecem idênticos à main. Os trechos apontados da tela de fotos já existiam. A nova API, a fila, a prévia, seus testes e o menu passam no lint direcionado. Não se declara lint global aprovado.

Não foi repetida a auditoria das 33 falhas históricas de integração de outros módulos do backend, já registrada anteriormente. Os resultados desta etapa abrangem a suíte unitária e as integrações HTTP de funcionários/presença, além do ensaio entre os portais. Não se declara aprovação de toda a integração histórica do backend.

Os builds dos frontends emitem avisos de tamanho de bundle/dados Browserslist anteriores. Há avisos de act em testes legados da Secretaria e uma depreciação do adaptador pg nos testes HTTP. Esses avisos foram registrados, sem refatoração fora do escopo.

A validação local com armazenamento simulado não homologa Cloudinary, e-mail, publicação ou contas reais. A aprovação visual final continua com o responsável. Os lints globais permanecem uma pendência separada.

## Evidências e execução

Foram geradas 14 capturas nos dois tamanhos. As imagens principais estão em docs/evidencias/fotos-funcionarios nos PRs dos frontends. As capturas completas estão na pasta de entrega local. Consulte docs/INTEGRACAO_FOTOS_FUNCIONARIOS.md para os comandos de execução no VS Code, variáveis locais e o ensaio integrado.

## Resultado consolidado da Secretaria e do lint comparativo

A execução completa da Secretaria terminou com 378/379 testes aprovados, em 63 arquivos. A única falha veio da fixture que contabilizava a nova consulta de resumo como operação do cadastro. Essa fixture foi corrigida e seu arquivo foi revalidado com 10/10 casos aprovados. O conjunto final dos 379 casos possui resultado aprovado, preservando as outras 62 suítes sem repetição. Os sete testes novos da API/fila estão incluídos nesse total.

A comparação final do teste HTTP do backend registra 81 erros e 56 avisos legados, frente a 82 erros e 56 avisos no original da main. O trecho novo não adiciona diagnósticos. As regras de lint não foram desabilitadas. O lint global continua reprovado pela dívida anterior.

## Arquivos modificados

Backend
- docs/INTEGRACAO_FOTOS_FUNCIONARIOS.md
- docs/RELATORIO_FOTOS_FUNCIONARIOS.md
- scripts/test-employee-photo-portals.cjs
- src/contracts/v1-employees.openapi.json
- src/contracts/v1-employees.types.ts
- src/employee/employee-eligibility.service.spec.ts
- src/employee/employee-eligibility.service.ts
- src/employee/employee-photo-status.spec.ts
- src/employee/employee-photo-status.ts
- src/employee/employee-photo.service.ts
- src/employee/employee.integration.spec.ts
- src/employee/entities/employee.entity.ts
- src/employee/mapper/employee.mapper.ts
- src/employee/repository/prisma/prisma.employee.repository.ts

Secretaria
- docs/INTEGRACAO_FOTOS_FUNCIONARIOS.md
- docs/RELATORIO_FOTOS_FUNCIONARIOS.md
- src/api/employee/employeePhotos.test.ts
- src/api/employee/employeePhotos.ts
- src/components/menuLateral/MenuLateral.pendingPhotos.test.tsx
- src/components/menuLateral/MenuLateral.tsx
- src/screens/employees/employees.test.tsx
- src/screens/secretary/photos/EmployeePhotoPreview.tsx
- src/screens/secretary/photos/EmployeePhotoQueue.test.tsx
- src/screens/secretary/photos/EmployeePhotoQueue.tsx
- src/screens/secretary/photos/PhotosScreen.test.tsx
- src/screens/secretary/photos/PhotosScreen.tsx
- src/screens/secretary/photos/employeePhotos.module.css

Portal
- docs/INTEGRACAO_FOTOS_FUNCIONARIOS.md
- docs/RELATORIO_FOTOS_FUNCIONARIOS.md
- docs/contracts/v1-employees.openapi.json
- docs/contracts/v1-employees.types.ts
- src/ui/screens/uploadimage/PhotoScreen.tsx
- tests/portal.browser.mjs

