// src/ui/dnd.ts
export function initTableDragAndDrop(tbodyId: string, onReorder: (fromIdx: number, toIdx: number) => void): void {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  let draggedRow: HTMLElement | null = null;
  let insertAfter = false;

  tbody.querySelectorAll("tr").forEach(row => {
    const handle = row.querySelector(".drag-handle");
    if (!handle) return;

    handle.addEventListener("mousedown", () => row.setAttribute("draggable", "true"));
    
    row.addEventListener("dragstart", (e: DragEvent) => {
      draggedRow = row as HTMLElement;
      draggedRow.classList.add("row-dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      row.removeAttribute("draggable");
      row.classList.remove("row-dragging");
      tbody.querySelectorAll("tr").forEach(r => {
        r.classList.remove("row-drag-over-top", "row-drag-over-bottom");
      });
    });

    row.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const rect = row.getBoundingClientRect();
      insertAfter = e.clientY > (rect.top + rect.height / 2);
      tbody.querySelectorAll("tr").forEach(r => {
        r.classList.remove("row-drag-over-top", "row-drag-over-bottom");
      });
      row.classList.add(insertAfter ? "row-drag-over-bottom" : "row-drag-over-top");
    });

    row.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const fromIdx = parseInt(draggedRow.getAttribute("data-index") || "0");
      let toIdx = parseInt(row.getAttribute("data-index") || "0");
      if (insertAfter && fromIdx > toIdx) toIdx += 1;
      else if (!insertAfter && fromIdx < toIdx) toIdx -= 1;
      onReorder(fromIdx, toIdx);
    });
  });
}
