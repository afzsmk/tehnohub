import type { SupabaseClient } from '@supabase/supabase-js';

const MIN_PASSWORD_LENGTH = 8;

export function mountMesRegistration(client: SupabaseClient): void {
  const root = document.querySelector<HTMLElement>('#app');
  const form = root?.querySelector<HTMLFormElement>('#login-form');
  if (!form || root?.querySelector('#mes-register')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tiny';
  button.id = 'mes-register';
  button.textContent = 'Зарегистрироваться';
  button.addEventListener('click', async () => {
    const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]');
    const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]');
    const email = emailInput?.value.trim() ?? '';
    const password = passwordInput?.value ?? '';

    if (!email) {
      window.alert('Укажите Email.');
      emailInput?.focus();
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      window.alert(`Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`);
      passwordInput?.focus();
      return;
    }

    button.disabled = true;
    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;

      if (data.session) {
        window.alert('Аккаунт создан. Доступ к MES будет открыт после назначения роли ADMIN.');
      } else {
        window.alert('Аккаунт создан. Проверьте Email, затем войдите в MES. После регистрации ADMIN назначит роль и при необходимости сотрудника.');
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось зарегистрировать пользователя');
    } finally {
      button.disabled = false;
    }
  });

  form.appendChild(button);
}
