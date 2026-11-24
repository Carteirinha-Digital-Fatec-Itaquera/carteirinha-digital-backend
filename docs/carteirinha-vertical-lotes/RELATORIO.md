# Entrega em Draft — 24/11/2026

Novas issues: Backend #104, Secretaria #88, Portal #10. Novas branches a partir das mains atualizadas; branches anteriores não reutilizadas. Sem merge, publicação de produção ou alterações em dados reais.

## Portal

Layout vertical real por reflow em até 540 px: foto acima dos dados, rótulos e dados em maiúsculas, frente e verso ajustados, QR e controles sem cortes. A partir de tablet permanece horizontal. A referência do aluno foi consultada, sem copiar rotação, código de barras ou fotos offline. Mensagens sem motivo já eram condicionais: foram acrescentados testes, sem refatorar esse comportamento.

Build TypeScript/Vite passou. Lint global passou (0 erros/avisos). Cache: 9/9. Playwright existente: 390/768/1440; UX: 390/1440; novo responsivo: 320/375/390/430/768/1440. Foram verificados orientação, ausência de transform e overflow, frente/verso, foto, nomes e funções longos, QR elegível e bloqueado e rejeição com/sem motivo. Testes de navegador usam API simulada, não representam homologação em produção.

## Secretaria

Toolbar reutiliza ButtonComp e o CSS da fila de alunos. Botões individuais lado a lado. Checkbox por employeeId/photoId; selecionar todos apenas nas páginas carregadas, escopo expresso na tela. Carregar página mantém seleção; refresh relê páginas carregadas e remove seleções de fotos ausentes ou com versão alterada.

Lotes confirmados executam chamadas sequenciais no endpoint existente, com expectedVersion por foto; não há endpoint em lote ou retry automático. Guarda contra submit duplicado, resultados parciais e por pessoa, conflitos 409 e interrupção após 401/403. Reprovação individual/lote permite motivo vazio com backend compatível; texto informado é aparado. Sucesso integral utiliza as mensagens solicitadas e botão OK.

Build TypeScript/Vite passou. Vitest completo: 397/397, 64 arquivos. Lint dos arquivos alterados: 0 erros/avisos; há 6 erros preexistentes no lint global da main, fora do escopo. Playwright novo: 320/390/1440; regressão de prévias/modais: 390/1440, com API simulada. Validados seleção, paginação, confirmações/cancelamento, lote aprovado/reprovado com/sem motivo, resultados parciais/409, resposta inválida/rede e sessão expirada.

## Contrato e publicação futura

Backend normaliza reason ausente/null/vazio/branco para null somente na avaliação da foto de funcionário; valida texto significativo (3–500 e controles), preservando autenticação, autorização, versão, auditoria e foto aprovada anterior. Nenhuma migration adicionada. Contratos versionados atualizados.

VITE_EMPLOYEE_PHOTO_OPTIONAL_REASON=false por padrão impede que a Secretaria envie reprovação vazia ao backend antigo. Após integrar/publicar Backend #104, habilitar true no próximo build da Secretaria. Nenhum ambiente de produção foi configurado nesta tarefa. Ordem futura: Backend → Secretaria → Portal. A validação final visual e funcional continua pendente do responsável; os PRs permanecem Draft e as issues abertas.

## Evidências

Capturas sintéticas anexadas em evidencias/. Veja GUIA-LOCAL.md para comandos no VS Code. Os screenshots não contêm a fotografia real fornecida como referência. O comportamento da fila de alunos foi preservado; testes de aprovação de aluno continuam passando na suíte existente.

## Validação específica do backend

Build Nest aprovado. Suíte unitária configurada com segredos efêmeros de teste: 390 testes aprovados, 50 suítes. Inclui 12 casos novos de DTO. O lint dos arquivos novos/alterados de produção e da nova suíte HTTP passou com 0 erros/avisos; o arquivo legado employee.integration.spec.ts mantém 81 erros/56 avisos históricos. O lint de src completo registra 841 erros/112 avisos preexistentes fora das alterações desta entrega. Não foram executados autofixes globais.

A suíte HTTP nova (7 casos) foi escrita para PostgreSQL real descartável, com guards para DATABASE_URL e DIRECT_URL e armazenamento/e-mail substituídos. Neste momento a execução está pendente de preparação do ambiente local: o Prisma migration engine apresentou falha de conexão. Não considerar HTTP/PostgreSQL ou o fluxo completo homologados até concluir essa execução. Nenhuma migration foi adicionada pela implementação.
