# Central de Licenças ED SYSTEMS

Painel web estático e responsivo para GitHub Pages. A autenticação, autorização, dados e emissão de licenças permanecem no Supabase.

## Segurança

- O repositório contém apenas a chave publicável do Supabase.
- Não contém `service_role`, senha ou chave privada de assinatura.
- O painel não oferece cadastro público.
- Toda operação exige uma sessão Supabase e associação em `public.license_admins`.
- A sessão é mantida somente na aba atual por `sessionStorage`.

O site é publicado automaticamente pelo workflow de GitHub Pages.
