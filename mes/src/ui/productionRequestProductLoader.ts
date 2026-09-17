import type { SupabaseClient } from '@supabase/supabase-js';

type Product = { id:string; code:string; name:string; unit:string };

let bound = false;

const esc = (value:unknown):string => String(value ?? '').replace(/[&<>\\"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[char] ?? char));

export function bindProductionRequestProductLoader(client:SupabaseClient):void {
  if (bound) return;
  bound = true;

  const fillEmptyProductSelects = async ():Promise<void> => {
    const selects = [...document.querySelectorAll<HTMLSelectElement>('.production-requests-page select[name="product_id"]')]
      .filter(select => select.options.length <= 1);
    if (!selects.length) return;

    const { data, error } = await client
      .from('products')
      .select('id,code,name,unit')
      .order('code', { ascending:true });
    if (error) {
      console.error('MES production request product loader failed', error);
      return;
    }

    const products = (data ?? []) as Product[];
    const options = products.map(product => `<option value="${esc(product.id)}">${esc(product.code)} — ${esc(product.name)} (${esc(product.unit)})</option>`).join('');
    selects.forEach(select => {
      const current = select.value;
      select.innerHTML = `<option value="">Номенклатура</option>${options}`;
      if (current) select.value = current;
    });
  };

  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-new-request], [data-add-request-item]')) return;
    window.setTimeout(() => { void fillEmptyProductSelects(); }, 0);
  });
}
