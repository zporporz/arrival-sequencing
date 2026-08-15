type EditableControl = HTMLInputElement | HTMLSelectElement

const EDITABLE_SELECTOR = 'tbody input.cell-input, tbody select.cell-select, tbody select.status-select'
const ROW_SELECTOR = 'tbody tr'

function isEditableControl(element: EventTarget | null): element is EditableControl {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
}

function controlsInRow(row: HTMLTableRowElement) {
  return Array.from(row.querySelectorAll<EditableControl>('input.cell-input, select.cell-select, select.status-select'))
    .filter((control) => !control.disabled)
}

function editableRows(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLTableRowElement>(ROW_SELECTOR))
    .filter((row) => controlsInRow(row).length > 0)
}

function tableRows(table: HTMLTableElement) {
  return editableRows(table)
}

function controlPosition(control: EditableControl) {
  const row = control.closest('tr') as HTMLTableRowElement | null
  const table = control.closest('table') as HTMLTableElement | null
  if (!row || !table) return null

  const rows = tableRows(table)
  const rowIndex = rows.indexOf(row)
  const controls = controlsInRow(row)
  const columnIndex = controls.indexOf(control)
  if (rowIndex < 0 || columnIndex < 0) return null

  return { rows, rowIndex, columnIndex }
}

function focusControl(control: EditableControl | undefined) {
  if (!control) return
  window.requestAnimationFrame(() => {
    control.focus()
    if (control instanceof HTMLInputElement) control.select()
  })
}

function moveVertical(control: EditableControl, delta: number) {
  const position = controlPosition(control)
  if (!position) return false

  const targetRow = position.rows[position.rowIndex + delta]
  if (!targetRow) return false

  const controls = controlsInRow(targetRow)
  focusControl(controls[Math.min(position.columnIndex, controls.length - 1)])
  return true
}

function moveHorizontal(control: EditableControl, delta: number) {
  const position = controlPosition(control)
  if (!position) return false

  const currentControls = controlsInRow(position.rows[position.rowIndex])
  const targetInRow = currentControls[position.columnIndex + delta]
  if (targetInRow) {
    focusControl(targetInRow)
    return true
  }

  const targetRow = position.rows[position.rowIndex + (delta > 0 ? 1 : -1)]
  if (!targetRow) return false

  const targetControls = controlsInRow(targetRow)
  focusControl(delta > 0 ? targetControls[0] : targetControls[targetControls.length - 1])
  return true
}

function caretAllowsHorizontalMove(input: HTMLInputElement, direction: -1 | 1) {
  const start = input.selectionStart ?? 0
  const end = input.selectionEnd ?? 0
  if (start !== end) return false
  return direction < 0 ? start === 0 : end === input.value.length
}

export function installSpreadsheetNavigation() {
  let focusNewRowUntil = 0
  let previousRowCount = 0

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.primary-button')) {
      previousRowCount = editableRows().length
      focusNewRowUntil = Date.now() + 4000
    }
  }, true)

  document.addEventListener('keydown', (event) => {
    const control = event.target
    if (!isEditableControl(control) || !control.matches(EDITABLE_SELECTOR)) return
    if (event.ctrlKey || event.metaKey || event.altKey) return

    if (event.key === 'Enter') {
      event.preventDefault()
      const direction = event.shiftKey ? -1 : 1
      control.blur()
      if (!moveVertical(control, direction)) moveHorizontal(control, direction)
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (control instanceof HTMLSelectElement) {
        event.preventDefault()
        moveVertical(control, event.key === 'ArrowUp' ? -1 : 1)
        return
      }
      if (control instanceof HTMLInputElement && control.selectionStart === control.selectionEnd) {
        event.preventDefault()
        moveVertical(control, event.key === 'ArrowUp' ? -1 : 1)
      }
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (control instanceof HTMLSelectElement) return
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      if (!caretAllowsHorizontalMove(control, direction)) return
      event.preventDefault()
      moveHorizontal(control, direction)
    }
  }, true)

  const observer = new MutationObserver(() => {
    if (Date.now() > focusNewRowUntil) return

    const rows = editableRows()
    if (rows.length <= previousRowCount) return

    const newest = rows[rows.length - 1]
    const firstInput = newest.querySelector<HTMLInputElement>('input.cell-input')
    if (!firstInput) return

    focusNewRowUntil = 0
    focusControl(firstInput)
  })

  const startObserver = () => {
    if (!document.body) return
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true })
  } else {
    startObserver()
  }
}
