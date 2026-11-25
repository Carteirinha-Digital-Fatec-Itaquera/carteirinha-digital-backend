# Entrega em Draft — 25/11/2026

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

Capturas sintéticas anexadas em docs/carteirinha-vertical-lotes/evidencias/ nos PRs dos frontends. Veja GUIA-LOCAL.md para comandos no VS Code. Os screenshots não contêm a fotografia real fornecida como referência. O comportamento da fila de alunos foi preservado; testes de aprovação de aluno continuam passando na suíte existente.


## Organização no GitHub

- backend: [PR Draft](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-backend/pull/105) · [Issue aberta](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-backend/issues/104) · branch feature/issue-104-foto-motivo-opcional
- secretaria: [PR Draft](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-front-end-secretaria/pull/89) · [Issue aberta](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-front-end-secretaria/issues/88) · branch feature/issue-88-fotos-selecao-lote
- funcionarios: [PR Draft](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-front-end-funcionarios/pull/11) · [Issue aberta](https://github.com/Carteirinha-Digital-Fatec-Itaquera/carteirinha-digital-front-end-funcionarios/issues/10) · branch feature/issue-10-carteirinha-mobile-vertical

As três main foram preservadas. Sem merge, deploy de produção, hospedagem nova do Portal ou dados reais.

## Validação específica do backend

Build Nest aprovado. Suíte unitária: 390 testes aprovados em 50 suítes, incluindo 12 novos casos do DTO. Segredos usados nos testes foram gerados apenas para a sessão.

Os 7 novos cenários HTTP passaram em PostgreSQL real descartável: 5 na execução isolada e os 2 casos inicialmente limitados a 30 segundos na repetição com o prazo original de 180 segundos. Os 5 outros casos foram filtrados nessa repetição, sem serem contados novamente. Armazenamento e e-mail são substituídos por fixtures; não é homologação de produção. As 28 migrations existentes foram aplicadas apenas no banco local. Nenhuma migration nova foi adicionada.

Verificados: reason ausente, null, vazio, espaços e tabulação/quebra de linha; texto aparado; tamanho/tipo/conteúdo inválido sem decisão; auditoria e status; 401/403; versão obsoleta e disputa concorrente com uma única decisão; foto aprovada anterior preservada; credencial e QR real válidos após rejeitar a substituta.

A regressão HTTP existente de funcionários registrou 9 casos aprovados e 2 reprovados, inclusive após aquecimento das conexões das fixtures:

- Disputa de ativação: resultado esperado [200,400], observado [200,500], com erro Prisma P2028 ao iniciar transação.
- Disputa de upload: duas chamadas de armazenamento esperadas na janela de 15 segundos, observadas zero; ocorreram requisições tardias durante a limpeza.

Essas duas falhas requerem investigação/revalidação em ambiente estável. Não foram reproduzidas na main nesta etapa e não são classificadas aqui como preexistentes ou regressões novas. Não foram alterados os limites de transação ou as asserções para fazê-las passar. A suíte de regressão de vínculo/presença de funcionário passou em sua execução anterior (1 caso). A execução acoplada que ficou presa foi interrompida, sem contá-la como aprovação.

O lint dos arquivos novos/alterados de produção e da nova suíte HTTP passou com 0 erros/avisos. O arquivo legado employee.integration.spec.ts conserva 81 erros/56 avisos de lint históricos. O lint de src completo registra 841 erros/112 avisos herdados, fora das alterações de produção desta entrega. Sem autofix global.

## Pendências e próxima integração

- Investigar as duas falhas HTTP existentes antes de considerar toda a regressão do backend aprovada.
- Validação visual e funcional final pelo responsável; as três issues permanecem abertas e os PRs em Draft.
- Resolver a dívida de lint global em trabalho separado.
- Publicação futura: Backend PR #105 → Secretaria PR #89 → Portal PR #11, somente após autorização. Habilitar VITE_EMPLOYEE_PHOTO_OPTIONAL_REASON=true no build da Secretaria apenas após o backend compatível estar publicado.

Capturas e testes dos frontends utilizam API simulada. Os testes HTTP de fotografias usam domínio/controllers/JWT/PostgreSQL reais, com armazenamento e e-mail isolados. Não declarar homologação completa com base nessas camadas de teste.
