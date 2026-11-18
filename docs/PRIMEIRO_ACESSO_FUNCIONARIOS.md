# Primeiro acesso com matrícula e posse do e-mail

O cadastro manual em POST /funcionarios exige registrationNumber de 1 a 40 caracteres depois de retirar espaços nas extremidades. O login continua a usar o e-mail cadastrado. O esquema Prisma permanece inalterado; registros antigos e importados existentes podem ter matrícula nula.

1. No login, abra Primeiro acesso e informe e-mail e matrícula. POST /autenticacao/funcionarios/solicitar-acesso recebe esses dados e devolve 202 genérico para pedidos válidos. A ausência de matrícula no pedido é reservada ao fluxo legado de contas sem matrícula.
2. A conta ativa, sem senha, com dados correspondentes, recebe link no e-mail cadastrado. O pedido usa o limite persistido existente por e-mail e IP. A autorização numerada vence em 30 minutos. O token tem uso único, hash em banco, finalidade ACTIVATE e authVersion.
3. POST /autenticacao/funcionarios/ativar recebe apenas o token e a nova senha. A transação verifica estado e versão, consome a autorização e atualiza o hash e authVersion. O token de ativação não é um Bearer e não abre rotas privadas.
4. O titular entra em POST /autenticacao/funcionarios/login com a senha pessoal. A matrícula atual é rejeitada no login, ativação, redefinição e troca de senha. Alterar matrícula ou e-mail invalida autorizações emitidas antes da alteração e nunca restaura o primeiro acesso de quem já tem senha.
5. POST /autenticacao/funcionarios/forgot-password continua genérico e envia redefinição apenas para contas ativas com senha definida. Contas legadas sem senha usam ativação. Convites legados foram preservados para consumidores administrativos existentes.

## Segurança e operação

A matrícula pode ser pública e não prova identidade. A posse do e-mail cadastrado é necessária para ativar. O serviço não devolve token ou status de elegibilidade em 202, e o login usa 401 com mensagem genérica para conta ausente, pendente, arquivada ou bloqueada. Há diferenças de tempo de processamento devido à verificação de senha e ao envio de e-mail; para resistência adicional a inferências temporais, usar fila durável separando a aceitação HTTP da entrega. Configurar CORS, EMPLOYEE_APP_URL, PostgreSQL e provedor de e-mail no ambiente de teste. A fase de entrega do primeiro acesso depende do e-mail, sem convite manual obrigatório.

## Testes

Execute os testes de integração existentes com banco PostgreSQL descartável, incluindo comparação das respostas 202, matrícula incorreta, consumo concorrente, token rejeitado como Bearer, senha igual à matrícula e autenticação posterior. Testar com caixa de e-mail e credenciais sintéticas antes de liberar. Nenhuma migração de esquema é necessária nesta etapa.
