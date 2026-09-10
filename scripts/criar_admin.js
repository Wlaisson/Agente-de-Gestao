import { supabaseAdmin } from '../supabaseClient.js';

async function criarOuAtualizarAdmin() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@report.com';
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || 'Admin@123456';
  const nome = process.argv[4] || 'Administrador';

  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error('Erro ao listar usuarios no Auth:', listError.message);
    process.exit(1);
  }

  let authUser = usersData.users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!authUser) {
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome }
    });

    if (createError) {
      console.error('Erro ao criar usuario admin no Auth:', createError.message);
      process.exit(1);
    }
    authUser = createData.user;
    console.log('Usuario criado no Auth:', authUser.id);
  } else {
    await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: { nome }
    });
    console.log('Usuario atualizado no Auth:', authUser.id);
  }

  const permissoesAdmin = {
    kanban: true,
    relatorios: true,
    transcricao: true,
    reunioes: true,
    opcoes: true,
    admin: true
  };

  const { error: dbError } = await supabaseAdmin
    .from('usuarios')
    .upsert({
      id: authUser.id,
      email: authUser.email,
      nome,
      is_admin: true,
      permissoes: permissoesAdmin,
      updated_at: new Date().toISOString()
    });

  if (dbError) {
    console.error('Erro ao salvar usuario na tabela usuarios:', dbError.message);
    process.exit(1);
  }

  console.log('Admin configurado com sucesso!');
  console.log('Email:', email);
  console.log('ID:', authUser.id);
  console.log('is_admin: true');
}

criarOuAtualizarAdmin().catch(console.error);
