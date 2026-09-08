import { storageService } from '../../services/storage/storageService';
import { modalSystem } from '../../ui/modal';
import { MesApiClient } from './apiClient';
import { preparePublication } from './publicationService';

const MES_URL_STORAGE_KEY = 'workforce_mes_api_base_url_v1';
const BUTTON_ID = 'btnPublishToMes';

function getStoredMesUrl(): string {
  try {
    return localStorage.getItem(MES_URL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredMesUrl(url: string): void {
  try {
    localStorage.setItem(MES_URL_STORAGE_KEY, url);
  } catch {
    // Local storage can be unavailable in hardened/private browser modes.
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = BUTTON_ID;
  button.className = 'btn btn-level btn-sm';
  button.title = 'Опубликовать текущий месячный план в MES';
  button.innerHTML = '<svg class="icon"><use href="#icon-upload"></use></svg> Опубликовать в MES';
  return button;
}

function getCurrentUserLabel(): string | undefined {
  const badge = document.getElementById('userEmailBadge');
  const text = badge?.textContent?.replace(/^👤\s*/, '').trim();
  return text || undefined;
}

function showMesConfiguration(onConfigured: (baseUrl: string) => void): void {
  const current = getStoredMesUrl();
  const body = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <p style="font-size:12.5px; color:var(--text-secondary); margin:0;">
        Укажите базовый URL MES API. Адрес сохраняется только в браузере и затем используется для публикации плана.
      </p>
      <div>
        <label style="font-size:11.5px; font-weight:600; color:var(--text-muted);">MES API:</label>
        <input type="url" id="mesApiUrlInput" class="input-control" placeholder="https://mes.zsmk.ru" value="${current.replace(/"/g, '&quot;')}" style="margin-top:2px;">
      </div>
    </div>
  `;

  modalSystem.show(
    '<svg class="icon"><use href="#icon-cpu"></use></svg> Настройка MES',
    body,
    false,
    '',
    [
      { label: 'Отмена', class: 'btn-secondary' },
      {
        label: 'Сохранить',
        class: 'btn-primary',
        isPrimary: true,
        action: () => {
          const input = document.getElementById('mesApiUrlInput') as HTMLInputElement | null;
          const url = normalizeBaseUrl(input?.value || '');
          if (!url) {
            modalSystem.alert('Ошибка', 'Укажите URL MES API.');
            return;
          }
          try {
            new URL(url);
          } catch {
            modalSystem.alert('Ошибка', 'URL MES API имеет неверный формат.');
            return;
          }
          setStoredMesUrl(url);
          onConfigured(url);
        },
      },
    ]
  );
}

function publishCurrentPlan(baseUrl: string): void {
  void (async () => {
    try {
      const state = await storageService.loadState();
      const scenarioId = state.scenarios[state.currentScenario]?.publication?.planId || state.currentScenario;
      const data = state.scenarios[state.currentScenario];
      if (!data) throw new Error('Не найден активный сценарий.');

      const prepared = preparePublication(data, {
        scenarioId,
        scenarioName: state.currentScenario,
        applicationVersion: '2.0.0',
        publishedBy: getCurrentUserLabel(),
      });

      modalSystem.confirm(
        'Публикация в MES',
        `Опубликовать версию <strong>${prepared.publication.version}</strong> плана <strong>«${state.currentScenario}»</strong> в MES?<br><br>` +
          `Заказы: <strong>${prepared.payload.orders.length}</strong><br>` +
          `Период: <strong>${prepared.payload.period.from} — ${prepared.payload.period.to}</strong><br>` +
          `Ключ идемпотентности: <strong>${prepared.payload.idempotencyKey}</strong>`,
        async () => {
          try {
            const client = new MesApiClient({ baseUrl });
            const result = await client.publishPlan(prepared.payload);
            if (!result.accepted) {
              const details = result.errors?.map(error => error.message).join('<br>') || 'MES отклонила публикацию без подробностей.';
              modalSystem.alert('MES отклонила план', details);
              return;
            }

            data.publication = prepared.publication;
            state.scenarios[state.currentScenario] = data;
            await storageService.saveState(state);
            modalSystem.alert(
              'План опубликован',
              `MES приняла версию <strong>${prepared.publication.version}</strong> плана.<br><br>` +
                `ID плана: <strong>${prepared.publication.planId}</strong>${result.mesPlanId ? `<br>ID плана MES: <strong>${result.mesPlanId}</strong>` : ''}`,
            );
          } catch (err: any) {
            modalSystem.alert('Ошибка публикации в MES', err?.message || 'Не удалось отправить план.');
          }
        },
      );
    } catch (err: any) {
      modalSystem.alert('Ошибка подготовки', err?.message || 'Не удалось подготовить план к публикации.');
    }
  })();
}

function setupMesUi(): void {
  if (document.getElementById(BUTTON_ID)) return;

  const parent = document.getElementById('userAuthWrap');
  if (!parent) return;

  const button = createButton();
  parent.insertBefore(button, parent.querySelector('.auth-badge'));

  button.addEventListener('click', () => {
    const baseUrl = getStoredMesUrl();
    if (!baseUrl) {
      showMesConfiguration(publishCurrentPlan);
      return;
    }
    publishCurrentPlan(baseUrl);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMesUi, { once: true });
  } else {
    setupMesUi();
  }
}
