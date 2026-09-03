// src/ui/modal.ts
interface ModalButton {
  label: string;
  class?: string;
  isPrimary?: boolean;
  action?: ((val: string) => void) | null;
}

export const modalSystem = {
  overlay: null as HTMLElement | null,
  titleEl: null as HTMLElement | null,
  bodyEl: null as HTMLElement | null,
  inputWrap: null as HTMLElement | null,
  inputEl: null as HTMLInputElement | null,
  footerEl: null as HTMLElement | null,
  onConfirmCb: null as ((val: string) => void) | null,

  init() {
    this.overlay = document.getElementById("customModalOverlay");
    this.titleEl = document.getElementById("modalTitle");
    this.bodyEl = document.getElementById("modalBody");
    this.inputWrap = document.getElementById("modalInputWrap");
    this.inputEl = document.getElementById("modalInput") as HTMLInputElement;
    this.footerEl = document.getElementById("modalFooter");

    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.onConfirmCb) {
        e.preventDefault();
        const val = this.inputEl!.value;
        this.hide();
        this.onConfirmCb(val);
      }
      if (e.key === "Escape") this.hide();
    });
  },

  show(title: string, bodyHtml: string, hasInput: boolean, inputValue: string, buttons: ModalButton[]) {
    if (!this.overlay || !this.titleEl || !this.bodyEl || !this.inputWrap || !this.inputEl || !this.footerEl) return;

    this.titleEl.innerHTML = title;
    this.bodyEl.innerHTML = bodyHtml;
    this.inputWrap.style.display = hasInput ? "block" : "none";
    this.inputEl.value = inputValue || "";
    this.footerEl.innerHTML = "";
    this.onConfirmCb = null;

    buttons.forEach(btnConfig => {
      const btn = document.createElement("button");
      btn.className = `btn ${btnConfig.class || 'btn-secondary'}`;
      btn.textContent = btnConfig.label;
      btn.onclick = () => {
        const val = this.inputEl!.value;
        this.hide();
        if (btnConfig.action) btnConfig.action(val);
      };
      if (btnConfig.isPrimary) this.onConfirmCb = btnConfig.action || null;
      this.footerEl!.appendChild(btn);
    });

    this.overlay.classList.add("active");
    if (hasInput) {
      setTimeout(() => { this.inputEl?.focus(); this.inputEl?.select(); }, 50);
    }
  },

  hide() {
    this.overlay?.classList.remove("active");
  },

  alert(title: string, message: string) {
    this.show(`<svg class="icon"><use href="#icon-info"></use></svg> ${title}`, message, false, "", [
      { label: "Понятно", class: "btn-primary", isPrimary: true }
    ]);
  },

  confirm(title: string, message: string, onConfirm: () => void) {
    this.show(`<svg class="icon" style="color:var(--danger)"><use href="#icon-alert-triangle"></use></svg> ${title}`, message, false, "", [
      { label: "Отмена", class: "btn-secondary" },
      { label: "Подтвердить", class: "btn-danger", isPrimary: true, action: () => onConfirm() }
    ]);
  },

  prompt(title: string, message: string, defaultValue: string, onConfirm: (val: string) => void) {
    this.show(`<svg class="icon"><use href="#icon-plus"></use></svg> ${title}`, message, true, defaultValue, [
      { label: "Отмена", class: "btn-secondary" },
      { label: "Сохранить", class: "btn-primary", isPrimary: true, action: onConfirm }
    ]);
  }
};