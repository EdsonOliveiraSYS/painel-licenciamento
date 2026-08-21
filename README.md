# Central de Licenças FitNexus

Painel web responsivo, com prioridade para celular, publicado no GitHub Pages. A autenticação, autorização, dados e emissão de licenças permanecem no Supabase.

## Segurança

- O repositório contém apenas a chave publicável do Supabase.
- Não contém `service_role`, senha ou chave privada de assinatura.
- O painel não oferece cadastro público.
- Toda operação exige uma sessão Supabase e associação em `public.license_admins`.
- A sessão é mantida somente na aba atual por `sessionStorage`.

O site é publicado automaticamente pelo workflow de GitHub Pages.

## Financeiro do licenciamento

- Cada nova licença pode ser cortesia ou receber valor e data de vencimento.
- Cobranças vencidas aparecem na área de inadimplências do painel.
- A exportação CSV inclui nome, CNPJ, razão social, WhatsApp, e-mail, vencimento e valor.
- O recebimento pode ser marcado no painel e fica registrado no histórico de eventos.
- O plano comercial pode ser mensal, anual, personalizado ou sem vencimento.
- Licenças mensais avisam o cliente automaticamente nos três dias anteriores ao vencimento.
- O botão **Plano e cobrança** atualiza os dados comerciais da licença ativa sem emitir outra contrassenha.
